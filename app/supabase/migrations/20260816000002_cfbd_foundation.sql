-- CFBD provider foundation: durable team mappings, provider-aware games, and sync audit.

create table public.external_team_mappings (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider ~ '^[a-z0-9_]+$'),
  team_id uuid not null references public.teams(id) on delete cascade,
  external_team_id text not null check (char_length(trim(external_team_id)) > 0),
  external_name text not null check (char_length(trim(external_name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_team_id),
  unique (provider, team_id)
);

create table public.external_sync_runs (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  provider text not null check (provider ~ '^[a-z0-9_]+$'),
  sync_type text not null check (sync_type in ('connection_test', 'schedule')),
  season text not null check (season ~ '^[0-9]{4}$'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed')),
  fetched_count integer not null default 0 check (fetched_count >= 0),
  created_count integer not null default 0 check (created_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  unchanged_count integer not null default 0 check (unchanged_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  initiated_by uuid references public.profiles(id) on delete set null
);

alter table public.cfb_games
  add column external_provider text,
  add column data_source text not null default 'manual' check (data_source in ('manual', 'provider')),
  add column provider_payload_hash text,
  add column provider_synced_at timestamptz,
  add column manual_override boolean not null default false;

-- Preserve any pre-foundation externally identified rows without pretending they came from CFBD.
update public.cfb_games set external_provider = 'legacy', data_source = 'provider'
where external_id is not null;

alter table public.cfb_games drop constraint cfb_games_status_check;
alter table public.cfb_games add constraint cfb_games_status_check
  check (status in ('scheduled', 'in_progress', 'final', 'postponed', 'canceled'));
alter table public.cfb_games add constraint cfb_games_external_identity_consistent check (
  (external_provider is null and external_id is null and data_source = 'manual')
  or (external_provider is not null and external_id is not null)
);

drop index public.cfb_games_league_external_id_key;
create unique index cfb_games_league_provider_external_key
  on public.cfb_games (league_id, external_provider, external_id)
  where external_provider is not null and external_id is not null;
create index cfb_games_provider_sync_idx
  on public.cfb_games (league_id, external_provider, season, provider_synced_at desc);
create index external_sync_runs_league_recent_idx
  on public.external_sync_runs (league_id, started_at desc);

create trigger external_team_mappings_set_updated_at before update on public.external_team_mappings
for each row execute function public.set_updated_at();

alter table public.external_team_mappings enable row level security;
alter table public.external_sync_runs enable row level security;

create policy "Authenticated users can read external team mappings"
on public.external_team_mappings for select to authenticated using (true);
create policy "League members can read external sync runs"
on public.external_sync_runs for select to authenticated using (private.is_league_member(league_id));

grant select on public.external_team_mappings, public.external_sync_runs to authenticated;

create or replace function public.save_cfb_game(
  target_game_id uuid, target_league_id uuid, target_season text, target_week integer,
  target_game_date date, target_home_team_id uuid, target_away_team_id uuid,
  target_home_score integer, target_away_score integer, target_status text,
  target_neutral_site boolean, target_postseason boolean, target_ranking_source text,
  target_home_rank integer, target_away_rank integer
)
returns public.cfb_games language plpgsql security definer set search_path = '' as $$
declare saved_game public.cfb_games; league_season text;
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
      scoring_fingerprint = case when (game.home_team_id, game.away_team_id, game.home_score, game.away_score,
        game.season, game.week) is distinct from (target_home_team_id, target_away_team_id,
        target_home_score, target_away_score, target_season, target_week) then null else game.scoring_fingerprint end
    where game.id = target_game_id and game.league_id = target_league_id returning * into saved_game;
    if saved_game.id is null then raise exception 'Game not found or access denied' using errcode = '42501'; end if;
  end if;

  delete from public.team_ranking_snapshots where game_id = saved_game.id;
  if target_ranking_source is not null and target_home_rank is not null then
    insert into public.team_ranking_snapshots (league_id, game_id, team_id, season, week, ranking_source, rank)
    values (target_league_id, saved_game.id, target_home_team_id, target_season, target_week, trim(target_ranking_source), target_home_rank);
  end if;
  if target_ranking_source is not null and target_away_rank is not null then
    insert into public.team_ranking_snapshots (league_id, game_id, team_id, season, week, ranking_source, rank)
    values (target_league_id, saved_game.id, target_away_team_id, target_season, target_week, trim(target_ranking_source), target_away_rank);
  end if;
  return saved_game;
end; $$;

create function public.begin_external_sync(target_league_id uuid, target_provider text, target_sync_type text)
returns public.external_sync_runs language plpgsql security definer set search_path = '' as $$
declare run public.external_sync_runs; league_season text;
begin
  select season into league_season from public.leagues
  where id = target_league_id and commissioner_id = auth.uid();
  if league_season is null then raise exception 'League not found or access denied' using errcode = '42501'; end if;
  if target_provider <> 'cfbd' or target_sync_type not in ('connection_test', 'schedule') then raise exception 'Unsupported external sync' using errcode = '22023'; end if;
  insert into public.external_sync_runs (league_id, provider, sync_type, season, initiated_by)
  values (target_league_id, target_provider, target_sync_type, league_season, auth.uid()) returning * into run;
  return run;
end; $$;

create function public.fail_external_sync(target_sync_run_id uuid, target_summary jsonb)
returns public.external_sync_runs language plpgsql security definer set search_path = '' as $$
declare run public.external_sync_runs;
begin
  update public.external_sync_runs sync_run set status = 'failed', completed_at = now(), error_count = 1,
    summary = coalesce(target_summary, '{}'::jsonb)
  from public.leagues league where sync_run.id = target_sync_run_id and league.id = sync_run.league_id
    and league.commissioner_id = auth.uid() and sync_run.status = 'running' returning sync_run.* into run;
  if run.id is null then raise exception 'Sync run not found or access denied' using errcode = '42501'; end if;
  return run;
end; $$;

create function public.save_external_team_mappings(target_league_id uuid, target_provider text, target_mappings jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare item jsonb; saved_count integer := 0;
begin
  if not exists (select 1 from public.leagues where id = target_league_id and commissioner_id = auth.uid()) then raise exception 'League not found or access denied' using errcode = '42501'; end if;
  if target_provider <> 'cfbd' or jsonb_typeof(target_mappings) <> 'array' then raise exception 'Invalid mappings payload' using errcode = '22023'; end if;
  for item in select value from jsonb_array_elements(target_mappings) loop
    insert into public.external_team_mappings (provider, team_id, external_team_id, external_name)
    values (target_provider, (item->>'team_id')::uuid, trim(item->>'external_team_id'), trim(item->>'external_name'))
    on conflict do nothing;
    if found then saved_count := saved_count + 1; end if;
  end loop;
  return saved_count;
end; $$;

create function public.apply_external_game_sync(target_sync_run_id uuid, target_games jsonb, target_mapping_summary jsonb)
returns public.external_sync_runs language plpgsql security definer set search_path = '' as $$
declare run public.external_sync_runs; item jsonb; existing public.cfb_games; created_count integer := 0;
  updated_count integer := 0; unchanged_count integer := 0; skipped_count integer := 0; error_count integer := 0;
  newly_final_count integer := 0; incoming_hash text; changed_result boolean;
begin
  select sync_run.* into run from public.external_sync_runs sync_run join public.leagues league on league.id = sync_run.league_id
  where sync_run.id = target_sync_run_id and sync_run.provider = 'cfbd' and sync_run.sync_type = 'schedule'
    and sync_run.status = 'running' and league.commissioner_id = auth.uid() for update of sync_run;
  if run.id is null then raise exception 'Sync run not found or access denied' using errcode = '42501'; end if;
  if jsonb_typeof(target_games) <> 'array' then raise exception 'Invalid games payload' using errcode = '22023'; end if;

  for item in select value from jsonb_array_elements(target_games) loop
    begin
      incoming_hash := md5(item::text);
      select * into existing from public.cfb_games where league_id = run.league_id
        and external_provider = 'cfbd' and external_id = item->>'external_id' for update;
      if existing.id is null then
        insert into public.cfb_games (league_id, external_provider, external_id, data_source, season, week,
          game_date, home_team_id, away_team_id, home_score, away_score, status, neutral_site, postseason,
          provider_payload_hash, provider_synced_at)
        values (run.league_id, 'cfbd', item->>'external_id', 'provider', item->>'season', (item->>'week')::integer,
          (item->>'game_date')::date, (item->>'home_team_id')::uuid, (item->>'away_team_id')::uuid,
          (item->>'home_score')::integer, (item->>'away_score')::integer, item->>'status',
          (item->>'neutral_site')::boolean, (item->>'postseason')::boolean, incoming_hash, now());
        created_count := created_count + 1;
        if item->>'status' = 'final' then newly_final_count := newly_final_count + 1; end if;
      elsif existing.manual_override then
        skipped_count := skipped_count + 1;
      elsif existing.provider_payload_hash = incoming_hash then
        update public.cfb_games set provider_synced_at = now() where id = existing.id;
        unchanged_count := unchanged_count + 1;
      else
        if existing.status <> 'final' and item->>'status' = 'final' then newly_final_count := newly_final_count + 1; end if;
        changed_result := (existing.home_team_id, existing.away_team_id, existing.home_score, existing.away_score,
          existing.status, existing.season, existing.week) is distinct from
          ((item->>'home_team_id')::uuid, (item->>'away_team_id')::uuid,
          (item->>'home_score')::integer, (item->>'away_score')::integer, item->>'status', item->>'season', (item->>'week')::integer);
        update public.cfb_games set season = item->>'season', week = (item->>'week')::integer,
          game_date = (item->>'game_date')::date, home_team_id = (item->>'home_team_id')::uuid,
          away_team_id = (item->>'away_team_id')::uuid, home_score = (item->>'home_score')::integer,
          away_score = (item->>'away_score')::integer, status = item->>'status',
          neutral_site = (item->>'neutral_site')::boolean, postseason = (item->>'postseason')::boolean,
          provider_payload_hash = incoming_hash, provider_synced_at = now(),
          scoring_fingerprint = case when changed_result then null else scoring_fingerprint end
        where id = existing.id;
        updated_count := updated_count + 1;
      end if;
    exception when others then error_count := error_count + 1; skipped_count := skipped_count + 1;
    end;
  end loop;

  update public.external_sync_runs set completed_at = now(),
    status = case when error_count > 0 or coalesce(jsonb_array_length(target_mapping_summary->'unmapped_games'), 0) > 0 then 'partial' else 'succeeded' end,
    fetched_count = jsonb_array_length(target_games) + coalesce(jsonb_array_length(target_mapping_summary->'unmapped_games'), 0),
    created_count = apply_external_game_sync.created_count, updated_count = apply_external_game_sync.updated_count,
    unchanged_count = apply_external_game_sync.unchanged_count, skipped_count = apply_external_game_sync.skipped_count + coalesce(jsonb_array_length(target_mapping_summary->'unmapped_games'), 0),
    error_count = apply_external_game_sync.error_count,
    summary = coalesce(target_mapping_summary, '{}'::jsonb) || jsonb_build_object('newly_final_count', newly_final_count)
  where id = run.id returning * into run;
  return run;
end; $$;

revoke all on function public.begin_external_sync(uuid, text, text) from public;
revoke all on function public.fail_external_sync(uuid, jsonb) from public;
revoke all on function public.save_external_team_mappings(uuid, text, jsonb) from public;
revoke all on function public.apply_external_game_sync(uuid, jsonb, jsonb) from public;
grant execute on function public.begin_external_sync(uuid, text, text) to authenticated;
grant execute on function public.fail_external_sync(uuid, jsonb) to authenticated;
grant execute on function public.save_external_team_mappings(uuid, text, jsonb) to authenticated;
grant execute on function public.apply_external_game_sync(uuid, jsonb, jsonb) to authenticated;
