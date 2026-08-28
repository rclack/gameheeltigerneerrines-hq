-- Phase 3A: canonical, league-agnostic CFBD live scoreboard snapshots.
-- This migration is inert: recurring polling remains disabled until separately activated.

create table public.live_scoreboard_games (
  provider text not null default 'cfbd' check (provider = 'cfbd'),
  provider_game_id text not null check (char_length(trim(provider_game_id)) > 0),
  start_at timestamptz not null,
  status text not null check (status in ('scheduled', 'in_progress', 'completed')),
  period integer check (period is null or period >= 0),
  clock text,
  situation text,
  possession text,
  last_play text,
  home_external_team_id text not null,
  home_name text not null,
  home_score integer check (home_score is null or home_score >= 0),
  home_win_probability numeric check (home_win_probability is null or home_win_probability between 0 and 1),
  away_external_team_id text not null,
  away_name text not null,
  away_score integer check (away_score is null or away_score >= 0),
  away_win_probability numeric check (away_win_probability is null or away_win_probability between 0 and 1),
  state_fingerprint text not null,
  fetched_at timestamptz not null,
  changed_at timestamptz not null,
  first_seen_at timestamptz not null,
  first_in_progress_at timestamptz,
  first_completed_at timestamptz,
  primary key (provider, provider_game_id)
);

create table public.live_scoreboard_snapshots (
  id bigint generated always as identity primary key,
  provider text not null default 'cfbd' check (provider = 'cfbd'),
  provider_game_id text not null,
  status text not null check (status in ('scheduled', 'in_progress', 'completed')),
  period integer,
  clock text,
  situation text,
  possession text,
  last_play text,
  home_score integer,
  home_win_probability numeric,
  away_score integer,
  away_win_probability numeric,
  state_fingerprint text not null,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (provider, provider_game_id) references public.live_scoreboard_games(provider, provider_game_id) on delete cascade,
  unique (provider, provider_game_id, state_fingerprint)
);

create table public.live_scoreboard_poll_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'cfbd' check (provider = 'cfbd'),
  trigger_type text not null check (trigger_type in ('manual', 'scheduled')),
  league_ids uuid[] not null check (cardinality(league_ids) > 0),
  lease_token uuid not null default gen_random_uuid(),
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  provider_calls integer not null default 0 check (provider_calls >= 0),
  provider_game_count integer not null default 0 check (provider_game_count >= 0),
  relevant_game_count integer not null default 0 check (relevant_game_count >= 0),
  changed_game_count integer not null default 0 check (changed_game_count >= 0),
  unchanged_game_count integer not null default 0 check (unchanged_game_count >= 0),
  unmatched_game_count integer not null default 0 check (unmatched_game_count >= 0),
  quota_tier text,
  quota_monthly_limit integer,
  quota_used integer,
  quota_remaining integer,
  error_category text,
  error_message text
);

create table public.live_scoreboard_poll_control (
  provider text primary key check (provider = 'cfbd'),
  enabled boolean not null default false,
  pregame_interval_seconds integer not null default 600 check (pregame_interval_seconds >= 60),
  live_interval_seconds integer not null default 180 check (live_interval_seconds >= 60),
  monthly_call_cap integer not null default 24000 check (monthly_call_cap > 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  next_poll_at timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  consecutive_errors integer not null default 0 check (consecutive_errors >= 0),
  last_quota_tier text,
  last_quota_monthly_limit integer,
  last_quota_used integer,
  last_quota_remaining integer,
  updated_at timestamptz not null default now()
);

insert into public.live_scoreboard_poll_control(provider) values ('cfbd');

create index live_scoreboard_games_status_start_idx on public.live_scoreboard_games(status, start_at);
create index live_scoreboard_games_freshness_idx on public.live_scoreboard_games(fetched_at desc);
create index live_scoreboard_snapshots_game_time_idx on public.live_scoreboard_snapshots(provider, provider_game_id, fetched_at);
create index live_scoreboard_poll_runs_recent_idx on public.live_scoreboard_poll_runs(started_at desc);

alter table public.live_scoreboard_games enable row level security;
alter table public.live_scoreboard_snapshots enable row level security;
alter table public.live_scoreboard_poll_runs enable row level security;
alter table public.live_scoreboard_poll_control enable row level security;

create policy "League members can read relevant live games"
on public.live_scoreboard_games for select to authenticated using (
  exists (
    select 1 from public.cfb_games game
    where game.external_provider = live_scoreboard_games.provider
      and game.external_id = live_scoreboard_games.provider_game_id
      and private.is_league_member(game.league_id)
  )
);

create policy "League members can read relevant live snapshots"
on public.live_scoreboard_snapshots for select to authenticated using (
  exists (
    select 1 from public.cfb_games game
    where game.external_provider = live_scoreboard_snapshots.provider
      and game.external_id = live_scoreboard_snapshots.provider_game_id
      and private.is_league_member(game.league_id)
  )
);

create policy "Commissioners can read scoped live poll diagnostics"
on public.live_scoreboard_poll_runs for select to authenticated using (
  exists (
    select 1 from public.leagues league
    where league.id = any(live_scoreboard_poll_runs.league_ids)
      and league.commissioner_id = auth.uid()
  )
);

grant select on public.live_scoreboard_games, public.live_scoreboard_snapshots, public.live_scoreboard_poll_runs to authenticated;
revoke all on public.live_scoreboard_poll_control from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.live_scoreboard_games, public.live_scoreboard_snapshots, public.live_scoreboard_poll_runs from anon, authenticated;

create function public.begin_live_scoreboard_poll(target_trigger text, target_league_ids uuid[])
returns public.live_scoreboard_poll_runs
language plpgsql security definer set search_path = '' as $$
declare
  v_control public.live_scoreboard_poll_control;
  v_run public.live_scoreboard_poll_runs;
  v_month_calls integer;
begin
  if target_trigger not in ('manual', 'scheduled') or coalesce(cardinality(target_league_ids), 0) = 0 then
    raise exception 'Invalid live scoreboard poll request' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(target_league_ids) id left join public.leagues league on league.id = id where league.id is null) then
    raise exception 'Unknown live scoreboard league scope' using errcode = '22023';
  end if;

  select * into v_control from public.live_scoreboard_poll_control where provider = 'cfbd' for update;
  if target_trigger = 'scheduled' and not v_control.enabled then return null; end if;
  if target_trigger = 'scheduled' and v_control.next_poll_at is not null and v_control.next_poll_at > clock_timestamp() then return null; end if;
  if target_trigger = 'scheduled' and not exists (
    select 1 from public.cfb_games game
    where game.league_id = any(target_league_ids) and game.external_provider = 'cfbd'
      and game.start_at between clock_timestamp() - interval '6 hours' and clock_timestamp() + interval '12 hours'
      and game.status not in ('canceled', 'postponed')
  ) then return null; end if;
  if v_control.lease_expires_at is not null and v_control.lease_expires_at > clock_timestamp() then
    raise exception 'Live scoreboard poll is already running' using errcode = '55P03';
  end if;

  select coalesce(sum(provider_calls), 0)::integer into v_month_calls
  from public.live_scoreboard_poll_runs
  where started_at >= date_trunc('month', clock_timestamp()) and status in ('succeeded', 'failed');
  if v_month_calls >= v_control.monthly_call_cap then
    raise exception 'Live scoreboard monthly call cap reached' using errcode = '54000';
  end if;

  insert into public.live_scoreboard_poll_runs(trigger_type, league_ids)
  values (target_trigger, target_league_ids) returning * into v_run;
  update public.live_scoreboard_poll_control set lease_token = v_run.lease_token,
    lease_expires_at = clock_timestamp() + interval '90 seconds', last_attempt_at = clock_timestamp(), updated_at = clock_timestamp()
  where provider = 'cfbd';
  return v_run;
end; $$;

create function public.complete_live_scoreboard_poll(
  target_run_id uuid, target_lease_token uuid, target_games jsonb, target_provider_calls integer, target_quota jsonb
)
returns public.live_scoreboard_poll_runs
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.live_scoreboard_poll_runs;
  v_item jsonb;
  v_existing public.live_scoreboard_games;
  v_now timestamptz := clock_timestamp();
  v_provider_count integer := 0;
  v_relevant integer := 0;
  v_changed integer := 0;
  v_unchanged integer := 0;
  v_unmatched integer := 0;
  v_any_live boolean := false;
  v_interval integer;
begin
  select * into v_run from public.live_scoreboard_poll_runs where id = target_run_id and lease_token = target_lease_token and status = 'running' for update;
  if v_run.id is null then raise exception 'Live scoreboard poll lease is invalid' using errcode = '42501'; end if;
  if jsonb_typeof(target_games) <> 'array' or target_provider_calls < 1 then raise exception 'Invalid live scoreboard payload' using errcode = '22023'; end if;
  if not exists (select 1 from public.live_scoreboard_poll_control where provider = 'cfbd' and lease_token = target_lease_token for update) then
    raise exception 'Live scoreboard poll lease is no longer authoritative' using errcode = '55P03';
  end if;

  v_provider_count := jsonb_array_length(target_games);
  for v_item in select value from jsonb_array_elements(target_games) loop
    if not exists (
      select 1 from public.cfb_games game where game.league_id = any(v_run.league_ids)
        and game.external_provider = 'cfbd' and game.external_id = v_item->>'provider_game_id'
    ) then
      v_unmatched := v_unmatched + 1;
      continue;
    end if;
    v_relevant := v_relevant + 1;
    v_any_live := v_any_live or v_item->>'status' = 'in_progress';
    select * into v_existing from public.live_scoreboard_games
      where provider = 'cfbd' and provider_game_id = v_item->>'provider_game_id' for update;

    insert into public.live_scoreboard_games(provider, provider_game_id, start_at, status, period, clock, situation,
      possession, last_play, home_external_team_id, home_name, home_score, home_win_probability,
      away_external_team_id, away_name, away_score, away_win_probability, state_fingerprint, fetched_at, changed_at,
      first_seen_at, first_in_progress_at, first_completed_at)
    values ('cfbd', v_item->>'provider_game_id', (v_item->>'start_at')::timestamptz, v_item->>'status',
      (v_item->>'period')::integer, v_item->>'clock', v_item->>'situation', v_item->>'possession',
      v_item->>'last_play', v_item->>'home_external_team_id', v_item->>'home_name', (v_item->>'home_score')::integer,
      (v_item->>'home_win_probability')::numeric, v_item->>'away_external_team_id', v_item->>'away_name',
      (v_item->>'away_score')::integer, (v_item->>'away_win_probability')::numeric, v_item->>'state_fingerprint',
      v_now, v_now, v_now, case when v_item->>'status' = 'in_progress' then v_now end,
      case when v_item->>'status' = 'completed' then v_now end)
    on conflict (provider, provider_game_id) do update set
      start_at = excluded.start_at, status = excluded.status, period = excluded.period, clock = excluded.clock,
      situation = excluded.situation, possession = excluded.possession,
      last_play = excluded.last_play, home_external_team_id = excluded.home_external_team_id, home_name = excluded.home_name,
      home_score = excluded.home_score, home_win_probability = excluded.home_win_probability,
      away_external_team_id = excluded.away_external_team_id, away_name = excluded.away_name,
      away_score = excluded.away_score, away_win_probability = excluded.away_win_probability,
      state_fingerprint = excluded.state_fingerprint, fetched_at = v_now,
      changed_at = case when public.live_scoreboard_games.state_fingerprint is distinct from excluded.state_fingerprint then v_now else public.live_scoreboard_games.changed_at end,
      first_in_progress_at = coalesce(public.live_scoreboard_games.first_in_progress_at, excluded.first_in_progress_at),
      first_completed_at = coalesce(public.live_scoreboard_games.first_completed_at, excluded.first_completed_at);

    if v_existing.provider_game_id is null or v_existing.state_fingerprint is distinct from v_item->>'state_fingerprint' then
      insert into public.live_scoreboard_snapshots(provider, provider_game_id, status, period, clock, situation,
        possession, last_play, home_score, home_win_probability, away_score, away_win_probability,
        state_fingerprint, fetched_at)
      values ('cfbd', v_item->>'provider_game_id', v_item->>'status', (v_item->>'period')::integer,
        v_item->>'clock', v_item->>'situation', v_item->>'possession', v_item->>'last_play',
        (v_item->>'home_score')::integer, (v_item->>'home_win_probability')::numeric,
        (v_item->>'away_score')::integer, (v_item->>'away_win_probability')::numeric,
        v_item->>'state_fingerprint', v_now) on conflict do nothing;
      v_changed := v_changed + 1;
    else
      v_unchanged := v_unchanged + 1;
    end if;
  end loop;

  select case when v_any_live then live_interval_seconds else pregame_interval_seconds end into v_interval
  from public.live_scoreboard_poll_control where provider = 'cfbd';
  update public.live_scoreboard_poll_runs set completed_at = v_now, status = 'succeeded', provider_calls = target_provider_calls,
    provider_game_count = v_provider_count, relevant_game_count = v_relevant, changed_game_count = v_changed,
    unchanged_game_count = v_unchanged, unmatched_game_count = v_unmatched,
    quota_tier = target_quota->>'tier_name', quota_monthly_limit = (target_quota->>'monthly_limit')::integer,
    quota_used = (target_quota->>'used')::integer, quota_remaining = (target_quota->>'remaining')::integer
  where id = v_run.id returning * into v_run;
  update public.live_scoreboard_poll_control set lease_token = null, lease_expires_at = null,
    next_poll_at = v_now + make_interval(secs => v_interval), last_success_at = v_now, consecutive_errors = 0,
    last_quota_tier = target_quota->>'tier_name', last_quota_monthly_limit = (target_quota->>'monthly_limit')::integer,
    last_quota_used = (target_quota->>'used')::integer, last_quota_remaining = (target_quota->>'remaining')::integer,
    updated_at = v_now where provider = 'cfbd';
  return v_run;
end; $$;

create function public.fail_live_scoreboard_poll(
  target_run_id uuid, target_lease_token uuid, target_provider_calls integer, target_error_category text, target_error_message text
)
returns public.live_scoreboard_poll_runs
language plpgsql security definer set search_path = '' as $$
declare v_run public.live_scoreboard_poll_runs; v_errors integer; v_delay integer; v_now timestamptz := clock_timestamp();
begin
  select * into v_run from public.live_scoreboard_poll_runs where id = target_run_id and lease_token = target_lease_token and status = 'running' for update;
  if v_run.id is null then raise exception 'Live scoreboard poll lease is invalid' using errcode = '42501'; end if;
  select consecutive_errors + 1 into v_errors from public.live_scoreboard_poll_control where provider = 'cfbd' and lease_token = target_lease_token for update;
  if v_errors is null then raise exception 'Live scoreboard poll lease is no longer authoritative' using errcode = '55P03'; end if;
  v_delay := least(3600, 180 * (2 ^ least(v_errors - 1, 4)));
  update public.live_scoreboard_poll_runs set completed_at = v_now, status = 'failed', provider_calls = greatest(target_provider_calls, 0),
    error_category = left(coalesce(target_error_category, 'provider_error'), 80), error_message = left(coalesce(target_error_message, 'Live scoreboard poll failed.'), 500)
  where id = v_run.id returning * into v_run;
  update public.live_scoreboard_poll_control set lease_token = null, lease_expires_at = null,
    next_poll_at = v_now + make_interval(secs => v_delay), last_error_at = v_now, consecutive_errors = v_errors, updated_at = v_now
  where provider = 'cfbd';
  return v_run;
end; $$;

revoke all on function public.begin_live_scoreboard_poll(text, uuid[]) from public, anon, authenticated;
revoke all on function public.complete_live_scoreboard_poll(uuid, uuid, jsonb, integer, jsonb) from public, anon, authenticated;
revoke all on function public.fail_live_scoreboard_poll(uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.begin_live_scoreboard_poll(text, uuid[]) to service_role;
grant execute on function public.complete_live_scoreboard_poll(uuid, uuid, jsonb, integer, jsonb) to service_role;
grant execute on function public.fail_live_scoreboard_poll(uuid, uuid, integer, text, text) to service_role;

comment on table public.live_scoreboard_poll_control is 'Phase 3A scheduler control; enabled remains false until separate polling activation approval.';
