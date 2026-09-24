-- Preserve CFBD kickoff timestamps and one authoritative, nullable pregame rank per participant.

alter table public.cfb_games add column start_at timestamptz;

alter table public.team_ranking_snapshots alter column rank drop not null;
drop index public.team_ranking_snapshots_game_team_source_key;
create unique index team_ranking_snapshots_game_team_key
on public.team_ranking_snapshots (game_id, team_id)
where game_id is not null;

create or replace function public.apply_cfb_ranking_snapshot_sync(
  target_sync_run_id uuid,
  target_snapshots jsonb,
  target_missing_count integer
)
returns public.external_sync_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.external_sync_runs;
  v_item jsonb;
  v_game public.cfb_games;
  v_team_id uuid;
  v_rank integer;
  v_source text;
  v_start_at timestamptz;
  v_applied integer := 0;
  v_frozen integer := 0;
begin
  select sync_run.* into v_run
  from public.external_sync_runs sync_run
  join public.leagues league on league.id = sync_run.league_id
  where sync_run.id = target_sync_run_id
    and sync_run.provider = 'cfbd'
    and sync_run.sync_type = 'schedule'
    and sync_run.status in ('succeeded', 'partial')
    and league.commissioner_id = auth.uid()
  for update of sync_run;

  if v_run.id is null then
    raise exception 'Sync run not found or access denied' using errcode = '42501';
  end if;
  if jsonb_typeof(target_snapshots) <> 'array' or target_missing_count < 0 then
    raise exception 'Invalid ranking snapshot payload' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(target_snapshots) loop
    v_source := v_item->>'ranking_source';
    v_start_at := (v_item->>'start_at')::timestamptz;
    if v_source not in ('AP Top 25', 'CFP') or v_start_at is null then
      raise exception 'Invalid authoritative ranking context' using errcode = '22023';
    end if;

    select game.* into v_game
    from public.cfb_games game
    where game.league_id = v_run.league_id
      and game.external_provider = 'cfbd'
      and game.external_id = v_item->>'external_id'
    for update of game;

    if v_game.id is null then
      continue;
    end if;

    -- A null kickoff may be backfilled once. Thereafter automation may only adjust future, unscored games.
    if v_game.start_at is null or (v_game.start_at > now() and v_game.scoring_fingerprint is null) then
      update public.cfb_games set start_at = v_start_at where id = v_game.id;
      v_game.start_at := v_start_at;
    end if;

    if v_game.start_at <= now() or v_game.scoring_fingerprint is not null then
      v_frozen := v_frozen + 1;
      continue;
    end if;

    for v_team_id, v_rank in
      select (v_item->>'home_team_id')::uuid, (v_item->>'home_rank')::integer
      where v_item->>'home_team_id' is not null
      union all
      select (v_item->>'away_team_id')::uuid, (v_item->>'away_rank')::integer
      where v_item->>'away_team_id' is not null
    loop
      if v_team_id is distinct from v_game.home_team_id and v_team_id is distinct from v_game.away_team_id then
        raise exception 'Ranking snapshot team is not a game participant' using errcode = '22023';
      end if;
      if v_rank is not null and (v_rank < 1 or v_rank > 999) then
        raise exception 'Invalid authoritative rank' using errcode = '22023';
      end if;
      insert into public.team_ranking_snapshots
        (league_id, game_id, team_id, season, week, ranking_source, rank, captured_at)
      values
        (v_game.league_id, v_game.id, v_team_id, v_game.season, v_game.week, v_source, v_rank, now())
      on conflict (game_id, team_id) where game_id is not null do update
      set season = excluded.season,
          week = excluded.week,
          ranking_source = excluded.ranking_source,
          rank = excluded.rank,
          captured_at = excluded.captured_at
      where (team_ranking_snapshots.season, team_ranking_snapshots.week,
             team_ranking_snapshots.ranking_source, team_ranking_snapshots.rank)
        is distinct from (excluded.season, excluded.week,
                          excluded.ranking_source, excluded.rank);
      v_applied := v_applied + 1;
    end loop;
  end loop;

  update public.external_sync_runs sync_run
  set summary = sync_run.summary || jsonb_build_object(
    'ranking_snapshots_applied', v_applied,
    'ranking_games_frozen', v_frozen,
    'ranking_context_unavailable_count', target_missing_count
  )
  where sync_run.id = v_run.id
  returning sync_run.* into v_run;

  return v_run;
end;
$$;

revoke all on function public.apply_cfb_ranking_snapshot_sync(uuid, jsonb, integer) from public, anon;
grant execute on function public.apply_cfb_ranking_snapshot_sync(uuid, jsonb, integer) to authenticated;

-- Ranking application follows the schedule import in the same server action. Permit that second
-- stage to convert the completed audit to failed if its transaction cannot be applied.
create or replace function public.fail_external_sync(target_sync_run_id uuid, target_summary jsonb)
returns public.external_sync_runs language plpgsql security definer set search_path = '' as $$
declare run public.external_sync_runs;
begin
  update public.external_sync_runs sync_run set status = 'failed', completed_at = now(), error_count = 1,
    summary = coalesce(target_summary, '{}'::jsonb)
  from public.leagues league where sync_run.id = target_sync_run_id and league.id = sync_run.league_id
    and league.commissioner_id = auth.uid() and sync_run.status in ('running', 'succeeded', 'partial')
  returning sync_run.* into run;
  if run.id is null then raise exception 'Sync run not found or access denied' using errcode = '42501'; end if;
  return run;
end;
$$;

revoke all on function public.fail_external_sync(uuid, jsonb) from public, anon;
grant execute on function public.fail_external_sync(uuid, jsonb) to authenticated;

create or replace function public.save_cfb_game(
  target_game_id uuid, target_league_id uuid, target_season text, target_week integer,
  target_game_date date, target_home_team_id uuid, target_away_team_id uuid,
  target_home_score integer, target_away_score integer, target_status text,
  target_neutral_site boolean, target_postseason boolean, target_ranking_source text,
  target_home_rank integer, target_away_rank integer
)
returns public.cfb_games language plpgsql security definer set search_path = '' as $$
declare
  saved_game public.cfb_games;
  existing_game public.cfb_games;
  league_season text;
  existing_home_rank integer;
  existing_away_rank integer;
  existing_source text;
  ranking_changed boolean := false;
begin
  select season into league_season from public.leagues
  where id = target_league_id and commissioner_id = auth.uid();
  if league_season is null then raise exception 'League not found or access denied' using errcode = '42501'; end if;
  if target_season is distinct from league_season then raise exception 'Game season must match league season' using errcode = '22023'; end if;
  if target_home_team_id = target_away_team_id then raise exception 'A team cannot play itself' using errcode = '22023'; end if;
  if target_week is null or target_week < 1 then raise exception 'Week must be positive' using errcode = '22023'; end if;
  if target_status not in ('scheduled', 'in_progress', 'final', 'postponed', 'canceled') then raise exception 'Invalid game status' using errcode = '22023'; end if;
  if target_status = 'final' and (target_home_score is null or target_away_score is null or target_home_score = target_away_score) then
    raise exception 'Final games require two different nonnegative scores' using errcode = '22023';
  end if;
  if target_ranking_source is not null and char_length(trim(target_ranking_source)) < 2 then raise exception 'Ranking source must contain at least two characters' using errcode = '22023'; end if;
  if (target_home_rank is not null or target_away_rank is not null) and target_ranking_source is null then raise exception 'A ranking source is required when a rank is supplied' using errcode = '22023'; end if;

  if target_game_id is not null then
    select game.* into existing_game from public.cfb_games game
    where game.id = target_game_id and game.league_id = target_league_id for update of game;
    if existing_game.id is null then raise exception 'Game not found or access denied' using errcode = '42501'; end if;
    select max(snapshot.ranking_source),
      max(snapshot.rank) filter (where snapshot.team_id = existing_game.home_team_id),
      max(snapshot.rank) filter (where snapshot.team_id = existing_game.away_team_id)
    into existing_source, existing_home_rank, existing_away_rank
    from public.team_ranking_snapshots snapshot where snapshot.game_id = existing_game.id;
    ranking_changed := (existing_source, existing_home_rank, existing_away_rank)
      is distinct from (nullif(trim(target_ranking_source), ''), target_home_rank, target_away_rank);
  end if;

  if target_game_id is null then
    insert into public.cfb_games (league_id, season, week, game_date, home_team_id, away_team_id,
      home_score, away_score, status, neutral_site, postseason, data_source)
    values (target_league_id, target_season, target_week, target_game_date, target_home_team_id,
      target_away_team_id, target_home_score, target_away_score, target_status,
      target_neutral_site, target_postseason, 'manual') returning * into saved_game;
  else
    update public.cfb_games game set
      season = target_season, week = target_week, game_date = target_game_date,
      home_team_id = target_home_team_id, away_team_id = target_away_team_id,
      home_score = target_home_score, away_score = target_away_score, status = target_status,
      neutral_site = target_neutral_site, postseason = target_postseason,
      manual_override = game.external_provider is not null or game.manual_override,
      scoring_fingerprint = case when ranking_changed or
        (game.home_team_id, game.away_team_id, game.home_score, game.away_score, game.status, game.season, game.week)
        is distinct from (target_home_team_id, target_away_team_id, target_home_score,
          target_away_score, target_status, target_season, target_week)
        then null else game.scoring_fingerprint end
    where game.id = target_game_id and game.league_id = target_league_id returning * into saved_game;
  end if;

  if existing_game.status = 'final' and target_status <> 'final' then
    update public.scoring_events event
    set voided_at = now(),
        voided_by = auth.uid(),
        void_reason = 'Game is no longer final; prior result was invalidated',
        -- Retire the deterministic active key so the same result can be scored again if re-finalized.
        idempotency_key = event.idempotency_key || ':void:' || event.id::text
    where event.league_id = target_league_id
      and event.source_type = 'game'
      and event.source_identifier = saved_game.id::text
      and event.voided_at is null;
  end if;

  delete from public.team_ranking_snapshots where game_id = saved_game.id;
  if target_ranking_source is not null then
    insert into public.team_ranking_snapshots (league_id, game_id, team_id, season, week, ranking_source, rank)
    values
      (target_league_id, saved_game.id, target_home_team_id, target_season, target_week, trim(target_ranking_source), target_home_rank),
      (target_league_id, saved_game.id, target_away_team_id, target_season, target_week, trim(target_ranking_source), target_away_rank);
  end if;
  return saved_game;
end;
$$;

revoke all on function public.save_cfb_game(uuid, uuid, text, integer, date, uuid, uuid, integer, integer, text, boolean, boolean, text, integer, integer) from public, anon;
grant execute on function public.save_cfb_game(uuid, uuid, text, integer, date, uuid, uuid, integer, integer, text, boolean, boolean, text, integer, integer) to authenticated;
