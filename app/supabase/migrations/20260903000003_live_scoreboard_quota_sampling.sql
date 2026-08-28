alter table public.live_scoreboard_poll_control add column last_quota_checked_at timestamptz;
alter table public.live_scoreboard_poll_runs add column quota_checked_at timestamptz;

update public.live_scoreboard_poll_control
set last_quota_checked_at = last_success_at
where last_quota_tier is not null and last_quota_checked_at is null;

create function public.record_live_scoreboard_quota_sample(target_quota jsonb)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp();
begin
  if target_quota->>'tier_name' is null
    or (target_quota->>'monthly_limit')::integer is null
    or (target_quota->>'used')::integer is null
    or (target_quota->>'remaining')::integer is null then
    raise exception 'Invalid live scoreboard quota sample' using errcode = '22023';
  end if;
  update public.live_scoreboard_poll_control
  set last_quota_tier = target_quota->>'tier_name',
      last_quota_monthly_limit = (target_quota->>'monthly_limit')::integer,
      last_quota_used = (target_quota->>'used')::integer,
      last_quota_remaining = (target_quota->>'remaining')::integer,
      last_quota_checked_at = v_now,
      updated_at = v_now
  where provider = 'cfbd';
  return found;
end; $$;

create or replace function public.begin_live_scoreboard_poll(target_trigger text, target_league_ids uuid[])
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
  if exists (
    select 1 from unnest(target_league_ids) as requested(league_id)
    left join public.leagues league on league.id = requested.league_id
    where league.id is null
  ) then
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
  insert into public.live_scoreboard_poll_runs(
    trigger_type, league_ids, quota_tier, quota_monthly_limit, quota_used, quota_remaining, quota_checked_at
  ) values (
    target_trigger, target_league_ids, v_control.last_quota_tier, v_control.last_quota_monthly_limit,
    v_control.last_quota_used, v_control.last_quota_remaining, v_control.last_quota_checked_at
  ) returning * into v_run;
  update public.live_scoreboard_poll_control set lease_token = v_run.lease_token,
    lease_expires_at = clock_timestamp() + interval '90 seconds', last_attempt_at = clock_timestamp(), updated_at = clock_timestamp()
  where provider = 'cfbd';
  return v_run;
end; $$;

revoke all on function public.record_live_scoreboard_quota_sample(jsonb) from public, anon, authenticated;
grant execute on function public.record_live_scoreboard_quota_sample(jsonb) to service_role;
revoke all on function public.begin_live_scoreboard_poll(text, uuid[]) from public, anon, authenticated;
grant execute on function public.begin_live_scoreboard_poll(text, uuid[]) to service_role;
