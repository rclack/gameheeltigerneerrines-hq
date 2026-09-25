-- Poll attempts can outlive the 90-second database lease. Once a later request
-- acquires the lease, the old request can no longer use the protected failure
-- finalizer. Preserve those attempts as terminal audit rows instead of leaving
-- them permanently marked running.
update public.live_scoreboard_poll_runs
set completed_at = started_at + interval '90 seconds',
    status = 'failed',
    provider_calls = greatest(provider_calls, scoreboard_calls + info_calls),
    error_category = 'abandoned_expired_lease',
    error_message = 'Poll request outlived its authoritative lease; stale telemetry was recovered.'
where status = 'running'
  and started_at < clock_timestamp() - interval '5 minutes';

create or replace function public.begin_live_scoreboard_poll(target_trigger text, target_league_ids uuid[])
returns public.live_scoreboard_poll_runs
language plpgsql security definer set search_path = '' as $$
declare
  v_control public.live_scoreboard_poll_control;
  v_run public.live_scoreboard_poll_runs;
  v_month_calls integer;
  v_now timestamptz := clock_timestamp();
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

  select * into v_control
  from public.live_scoreboard_poll_control
  where provider = 'cfbd'
  for update;

  update public.live_scoreboard_poll_runs
  set completed_at = started_at + interval '90 seconds',
      status = 'failed',
      provider_calls = greatest(provider_calls, scoreboard_calls + info_calls),
      error_category = 'abandoned_expired_lease',
      error_message = 'Poll request outlived its authoritative lease; stale telemetry was recovered.'
  where status = 'running'
    and started_at < v_now - interval '5 minutes';

  if v_control.lease_token is not null
    and coalesce(v_control.lease_expires_at, '-infinity'::timestamptz) <= v_now then
    update public.live_scoreboard_poll_control
    set lease_token = null,
        lease_expires_at = null,
        updated_at = v_now
    where provider = 'cfbd';
    v_control.lease_token := null;
    v_control.lease_expires_at := null;
  end if;

  if target_trigger = 'scheduled' and not v_control.enabled then return null; end if;
  if target_trigger = 'scheduled' and v_control.next_poll_at is not null and v_control.next_poll_at > v_now then return null; end if;
  if target_trigger = 'scheduled' and not exists (
    select 1
    from public.cfb_games game
    join public.drafts draft on draft.league_id = game.league_id and draft.status = 'complete'
    join public.draft_picks pick on pick.draft_id = draft.id
      and pick.team_id in (game.home_team_id, game.away_team_id)
    where game.league_id = any(target_league_ids)
      and game.external_provider = 'cfbd'
      and game.start_at between v_now - interval '6 hours' and v_now + interval '12 hours'
      and game.status not in ('canceled', 'postponed')
  ) then return null; end if;
  if v_control.lease_expires_at is not null and v_control.lease_expires_at > v_now then
    raise exception 'Live scoreboard poll is already running' using errcode = '55P03';
  end if;

  select coalesce(sum(provider_calls), 0)::integer into v_month_calls
  from public.live_scoreboard_poll_runs
  where started_at >= date_trunc('month', v_now)
    and status in ('succeeded', 'failed');
  if v_month_calls >= v_control.monthly_call_cap then
    raise exception 'Live scoreboard monthly call cap reached' using errcode = '54000';
  end if;

  insert into public.live_scoreboard_poll_runs(
    trigger_type, league_ids, quota_tier, quota_monthly_limit, quota_used, quota_remaining, quota_checked_at
  ) values (
    target_trigger, target_league_ids, v_control.last_quota_tier, v_control.last_quota_monthly_limit,
    v_control.last_quota_used, v_control.last_quota_remaining, v_control.last_quota_checked_at
  ) returning * into v_run;

  update public.live_scoreboard_poll_control
  set lease_token = v_run.lease_token,
      lease_expires_at = clock_timestamp() + interval '90 seconds',
      last_attempt_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where provider = 'cfbd';
  return v_run;
end; $$;

comment on column public.live_scoreboard_poll_runs.provider_calls is
  'Internal count of CFBD request attempts made by this poll, whether or not CFBD returned a successful response.';
comment on column public.live_scoreboard_poll_runs.scoreboard_calls is
  'Internal count of /scoreboard request attempts made by this poll.';
comment on column public.live_scoreboard_poll_runs.info_calls is
  'Internal count of /info request attempts made by this poll.';
comment on column public.live_scoreboard_poll_runs.quota_used is
  'Provider-reported metered usage sampled from CFBD /info; it is not the internal request-attempt count.';

revoke all on function public.begin_live_scoreboard_poll(text, uuid[]) from public, anon, authenticated;
grant execute on function public.begin_live_scoreboard_poll(text, uuid[]) to service_role;
