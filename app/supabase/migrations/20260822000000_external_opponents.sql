-- Milestone 3B: lightweight non-draftable opponents and one-internal-team games.

create table public.external_opponents (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider ~ '^[a-z0-9_]+$'),
  external_id text not null check (char_length(trim(external_id)) > 0),
  display_name text not null check (char_length(trim(display_name)) > 0),
  classification text not null check (classification in ('fcs', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_id)
);

create trigger external_opponents_set_updated_at before update on public.external_opponents
for each row execute function public.set_updated_at();

alter table public.external_opponents enable row level security;
grant select on public.external_opponents to authenticated;

alter table public.cfb_games
  alter column home_team_id drop not null,
  alter column away_team_id drop not null,
  add column home_external_opponent_id uuid references public.external_opponents(id) on delete restrict,
  add column away_external_opponent_id uuid references public.external_opponents(id) on delete restrict,
  add constraint cfb_games_home_participant_exactly_one check (
    (home_team_id is not null)::integer + (home_external_opponent_id is not null)::integer = 1
  ),
  add constraint cfb_games_away_participant_exactly_one check (
    (away_team_id is not null)::integer + (away_external_opponent_id is not null)::integer = 1
  ),
  add constraint cfb_games_provider_has_internal_participant check (
    data_source <> 'provider' or home_team_id is not null or away_team_id is not null
  );

create index cfb_games_home_external_opponent_idx on public.cfb_games (home_external_opponent_id);
create index cfb_games_away_external_opponent_idx on public.cfb_games (away_external_opponent_id);

create policy "League members can read referenced external opponents"
on public.external_opponents for select to authenticated using (
  exists (
    select 1 from public.cfb_games game
    where (game.home_external_opponent_id = external_opponents.id or game.away_external_opponent_id = external_opponents.id)
      and private.is_league_member(game.league_id)
  )
);

drop function public.apply_external_game_sync(uuid, jsonb, jsonb);
create function public.apply_external_game_sync(
  target_sync_run_id uuid, target_games jsonb, target_external_opponents jsonb, target_mapping_summary jsonb
)
returns public.external_sync_runs language plpgsql security definer set search_path = '' as $$
declare
  v_run public.external_sync_runs; v_item jsonb; v_opponent jsonb; v_existing public.cfb_games;
  v_created_count integer := 0; v_updated_count integer := 0; v_unchanged_count integer := 0;
  v_skipped_count integer := 0; v_error_count integer := 0; v_newly_final_count integer := 0;
  v_incoming_hash text; v_changed_result boolean;
  v_home_external_id uuid; v_away_external_id uuid;
begin
  select sync_run.* into v_run from public.external_sync_runs sync_run
  join public.leagues league on league.id = sync_run.league_id
  where sync_run.id = target_sync_run_id and sync_run.provider = 'cfbd'
    and sync_run.sync_type = 'schedule' and sync_run.status = 'running'
    and league.commissioner_id = auth.uid() for update of sync_run;
  if v_run.id is null then raise exception 'Sync run not found or access denied' using errcode = '42501'; end if;
  if jsonb_typeof(target_games) <> 'array' or jsonb_typeof(target_external_opponents) <> 'array' then
    raise exception 'Invalid sync payload' using errcode = '22023';
  end if;

  for v_opponent in select value from jsonb_array_elements(target_external_opponents) loop
    if v_opponent->>'provider' <> 'cfbd' then raise exception 'Unsupported opponent provider' using errcode = '22023'; end if;
    insert into public.external_opponents (provider, external_id, display_name, classification)
    values ('cfbd', trim(v_opponent->>'external_id'), trim(v_opponent->>'display_name'), v_opponent->>'classification')
    on conflict (provider, external_id) do update
      set display_name = excluded.display_name, classification = excluded.classification
      where (external_opponents.display_name, external_opponents.classification)
        is distinct from (excluded.display_name, excluded.classification);
  end loop;

  for v_item in select value from jsonb_array_elements(target_games) loop
    begin
      v_home_external_id := null; v_away_external_id := null;
      if v_item->>'home_external_opponent_external_id' is not null then
        select id into v_home_external_id from public.external_opponents
        where provider = 'cfbd' and external_id = v_item->>'home_external_opponent_external_id';
      end if;
      if v_item->>'away_external_opponent_external_id' is not null then
        select id into v_away_external_id from public.external_opponents
        where provider = 'cfbd' and external_id = v_item->>'away_external_opponent_external_id';
      end if;
      v_incoming_hash := md5(v_item::text);
      select game.* into v_existing from public.cfb_games game
      where game.league_id = v_run.league_id and game.external_provider = 'cfbd'
        and game.external_id = v_item->>'external_id' for update of game;
      if v_existing.id is null then
        insert into public.cfb_games (league_id, external_provider, external_id, data_source, season, week,
          game_date, home_team_id, home_external_opponent_id, away_team_id, away_external_opponent_id,
          home_score, away_score, status, neutral_site, postseason, provider_payload_hash, provider_synced_at)
        values (v_run.league_id, 'cfbd', v_item->>'external_id', 'provider', v_item->>'season',
          (v_item->>'week')::integer, (v_item->>'game_date')::date, (v_item->>'home_team_id')::uuid,
          v_home_external_id, (v_item->>'away_team_id')::uuid, v_away_external_id,
          (v_item->>'home_score')::integer, (v_item->>'away_score')::integer, v_item->>'status',
          (v_item->>'neutral_site')::boolean, (v_item->>'postseason')::boolean, v_incoming_hash, now());
        v_created_count := v_created_count + 1;
        if v_item->>'status' = 'final' then v_newly_final_count := v_newly_final_count + 1; end if;
      elsif v_existing.manual_override then v_skipped_count := v_skipped_count + 1;
      elsif v_existing.provider_payload_hash = v_incoming_hash then
        update public.cfb_games set provider_synced_at = now() where id = v_existing.id;
        v_unchanged_count := v_unchanged_count + 1;
      else
        if v_existing.status <> 'final' and v_item->>'status' = 'final' then v_newly_final_count := v_newly_final_count + 1; end if;
        v_changed_result := (v_existing.home_team_id, v_existing.home_external_opponent_id,
          v_existing.away_team_id, v_existing.away_external_opponent_id, v_existing.home_score,
          v_existing.away_score, v_existing.status, v_existing.season, v_existing.week) is distinct from
          ((v_item->>'home_team_id')::uuid, v_home_external_id, (v_item->>'away_team_id')::uuid,
          v_away_external_id, (v_item->>'home_score')::integer, (v_item->>'away_score')::integer,
          v_item->>'status', v_item->>'season', (v_item->>'week')::integer);
        update public.cfb_games game set season = v_item->>'season', week = (v_item->>'week')::integer,
          game_date = (v_item->>'game_date')::date, home_team_id = (v_item->>'home_team_id')::uuid,
          home_external_opponent_id = v_home_external_id, away_team_id = (v_item->>'away_team_id')::uuid,
          away_external_opponent_id = v_away_external_id, home_score = (v_item->>'home_score')::integer,
          away_score = (v_item->>'away_score')::integer, status = v_item->>'status',
          neutral_site = (v_item->>'neutral_site')::boolean, postseason = (v_item->>'postseason')::boolean,
          provider_payload_hash = v_incoming_hash, provider_synced_at = now(),
          scoring_fingerprint = case when v_changed_result then null else game.scoring_fingerprint end
        where id = v_existing.id;
        v_updated_count := v_updated_count + 1;
      end if;
    exception when others then v_error_count := v_error_count + 1; v_skipped_count := v_skipped_count + 1;
    end;
  end loop;
  update public.external_sync_runs sync_run set completed_at = now(),
    status = case when v_error_count > 0 or coalesce(jsonb_array_length(target_mapping_summary->'unmapped_games'), 0) > 0 then 'partial' else 'succeeded' end,
    fetched_count = jsonb_array_length(target_games) + coalesce(jsonb_array_length(target_mapping_summary->'unmapped_games'), 0),
    created_count = v_created_count, updated_count = v_updated_count, unchanged_count = v_unchanged_count,
    skipped_count = v_skipped_count + coalesce(jsonb_array_length(target_mapping_summary->'unmapped_games'), 0),
    error_count = v_error_count, summary = coalesce(target_mapping_summary, '{}'::jsonb)
      || jsonb_build_object('newly_final_count', v_newly_final_count)
  where sync_run.id = v_run.id returning sync_run.* into v_run;
  return v_run;
end; $$;

revoke all on function public.apply_external_game_sync(uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.apply_external_game_sync(uuid, jsonb, jsonb, jsonb) to authenticated;

create or replace function public.process_cfb_game_scoring(target_game_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  game public.cfb_games; winner_id uuid; loser_id uuid; loser_rank integer; ranking_source text;
  winner_classification text; loser_classification text; winner_codes text[] := array['WIN'];
  loser_codes text[] := array['LOSS']; fingerprint text; inserted_count integer;
begin
  select game_row.* into game from public.cfb_games game_row join public.leagues league on league.id = game_row.league_id
  where game_row.id = target_game_id and league.commissioner_id = auth.uid() for update of game_row;
  if game.id is null then raise exception 'Game not found or access denied' using errcode = '42501'; end if;
  if game.status <> 'final' or game.home_score is null or game.away_score is null or game.home_score = game.away_score then
    raise exception 'Only a completed, non-tied game can be scored' using errcode = 'P0001'; end if;
  if game.home_score > game.away_score then winner_id := game.home_team_id; loser_id := game.away_team_id;
  else winner_id := game.away_team_id; loser_id := game.home_team_id; end if;
  if loser_id is not null then
    select snapshot.rank, snapshot.ranking_source into loser_rank, ranking_source from public.team_ranking_snapshots snapshot
    where snapshot.game_id = game.id and snapshot.team_id = loser_id order by snapshot.captured_at desc limit 1;
  end if;
  if winner_id is not null then select classification.classification into winner_classification from public.teams team
    left join public.conference_classifications classification on classification.season = game.season and classification.conference = team.conference where team.id = winner_id; end if;
  if loser_id is not null then select classification.classification into loser_classification from public.teams team
    left join public.conference_classifications classification on classification.season = game.season and classification.conference = team.conference where team.id = loser_id; end if;
  if winner_id is not null and loser_id is not null and loser_rank is not null then winner_codes := array_append(winner_codes, 'WIN_OVER_RANKED'); end if;
  if winner_id is not null and loser_id is not null and loser_rank <= 15 then winner_codes := array_append(winner_codes, 'WIN_OVER_TOP_15'); end if;
  if winner_id is not null and loser_id is not null and loser_rank <= 5 then winner_codes := array_append(winner_codes, 'WIN_OVER_TOP_5'); end if;
  if winner_id is not null and loser_id is not null and winner_classification = 'G5' and loser_classification = 'POWER' then
    winner_codes := array_append(winner_codes, 'G5_WIN_OVER_P5'); loser_codes := array_append(loser_codes, 'P5_LOSS_TO_G5'); end if;
  fingerprint := md5(concat_ws('|', game.home_team_id, game.home_external_opponent_id, game.away_team_id,
    game.away_external_opponent_id, game.home_score, game.away_score, game.season, game.week,
    coalesce(loser_rank::text, ''), coalesce(ranking_source, ''), coalesce(winner_classification, ''), coalesce(loser_classification, '')));
  if game.scoring_fingerprint = fingerprint then select count(*) into inserted_count from public.scoring_events
    where league_id = game.league_id and source_type = 'game' and source_identifier = game.id::text and voided_at is null; return inserted_count; end if;
  update public.scoring_events set voided_at = now(), voided_by = auth.uid(), void_reason = 'Game scoring recalculated after result or context changed'
  where league_id = game.league_id and source_type = 'game' and source_identifier = game.id::text and voided_at is null;
  with awards(team_id, code) as (
    select winner_id, unnest(winner_codes) where winner_id is not null
    union all select loser_id, unnest(loser_codes) where loser_id is not null
  ) insert into public.scoring_events (league_id, team_id, scoring_rule_id, season, week, points, event_date,
    source_type, source_identifier, origin, idempotency_key, notes, metadata, created_by)
  select game.league_id, awards.team_id, rule.id, game.season, game.week, rule.points, game.game_date,
    'game', game.id::text, 'automatic', concat('game:', game.id, ':', awards.team_id, ':', rule.code, ':', fingerprint), null,
    jsonb_build_object('game_id', game.id, 'ranking_source', ranking_source,
      'opponent_rank', case when awards.team_id = winner_id then loser_rank else null end, 'scoring_fingerprint', fingerprint), auth.uid()
  from awards join public.scoring_rules rule on rule.code = awards.code and rule.league_id is null and rule.active;
  get diagnostics inserted_count = row_count;
  update public.cfb_games set scoring_fingerprint = fingerprint, scored_at = now() where id = game.id;
  return inserted_count;
end; $$;

revoke all on function public.process_cfb_game_scoring(uuid) from public;
grant execute on function public.process_cfb_game_scoring(uuid) to authenticated;
