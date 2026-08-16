-- Scheduled CFBD synchronization uses narrow service-role-only wrappers around
-- the existing commissioner-authorized sync RPCs. Manual sync remains unchanged.

create or replace function public.begin_external_sync(
  target_league_id uuid,
  target_provider text,
  target_sync_type text
)
returns public.external_sync_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.external_sync_runs;
  league_season text;
begin
  select league.season into league_season
  from public.leagues league
  where league.id = target_league_id
    and league.commissioner_id = auth.uid()
  for update;

  if league_season is null then
    raise exception 'League not found or access denied' using errcode = '42501';
  end if;
  if target_provider <> 'cfbd' or target_sync_type not in ('connection_test', 'schedule') then
    raise exception 'Unsupported external sync' using errcode = '22023';
  end if;

  update public.external_sync_runs sync_run
  set status = 'failed',
      completed_at = now(),
      error_count = greatest(sync_run.error_count, 1),
      summary = coalesce(sync_run.summary, '{}'::jsonb) || jsonb_build_object(
        'failure_stage', 'audit_creation',
        'error_category', 'database_error',
        'error_message', 'A stale synchronization run was closed by the overlap guard.'
      )
  where sync_run.league_id = target_league_id
    and sync_run.provider = target_provider
    and sync_run.sync_type = target_sync_type
    and sync_run.status = 'running'
    and sync_run.started_at < now() - interval '45 minutes';

  if exists (
    select 1 from public.external_sync_runs sync_run
    where sync_run.league_id = target_league_id
      and sync_run.provider = target_provider
      and sync_run.sync_type = target_sync_type
      and sync_run.status = 'running'
  ) then
    raise exception 'CFBD synchronization is already running' using errcode = '55P03';
  end if;

  insert into public.external_sync_runs (league_id, provider, sync_type, season, initiated_by)
  values (target_league_id, target_provider, target_sync_type, league_season, auth.uid())
  returning * into run;
  return run;
end;
$$;

create function private.bind_scheduled_cfbd_commissioner(target_league_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_role text;
  commissioner_id uuid;
  claims jsonb;
begin
  claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  request_role := claims->>'role';
  if request_role is distinct from 'service_role' then
    raise exception 'Scheduled synchronization access denied' using errcode = '42501';
  end if;

  select league.commissioner_id into commissioner_id
  from public.leagues league
  where league.id = target_league_id;
  if commissioner_id is null then
    raise exception 'League not found' using errcode = 'P0002';
  end if;

  perform set_config('request.jwt.claim.sub', commissioner_id::text, true);
  perform set_config('request.jwt.claims', (claims || jsonb_build_object('sub', commissioner_id::text))::text, true);
end;
$$;

revoke all on function private.bind_scheduled_cfbd_commissioner(uuid) from public, anon, authenticated, service_role;

create function public.scheduled_begin_external_sync(
  target_league_id uuid,
  target_provider text,
  target_sync_type text
)
returns public.external_sync_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.external_sync_runs;
begin
  perform private.bind_scheduled_cfbd_commissioner(target_league_id);
  run := public.begin_external_sync(target_league_id, target_provider, target_sync_type);
  update public.external_sync_runs sync_run
  set initiated_by = null,
      summary = coalesce(sync_run.summary, '{}'::jsonb) || jsonb_build_object('trigger', 'scheduled')
  where sync_run.id = run.id
  returning * into run;
  return run;
end;
$$;

create function public.scheduled_save_external_team_mappings(
  target_league_id uuid,
  target_provider text,
  target_mappings jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.bind_scheduled_cfbd_commissioner(target_league_id);
  return public.save_external_team_mappings(target_league_id, target_provider, target_mappings);
end;
$$;

create function public.scheduled_apply_external_game_sync(
  target_sync_run_id uuid,
  target_games jsonb,
  target_external_opponents jsonb,
  target_mapping_summary jsonb
)
returns public.external_sync_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  league_id uuid;
begin
  select sync_run.league_id into league_id
  from public.external_sync_runs sync_run
  where sync_run.id = target_sync_run_id;
  if league_id is null then raise exception 'Sync run not found' using errcode = 'P0002'; end if;
  perform private.bind_scheduled_cfbd_commissioner(league_id);
  return public.apply_external_game_sync(target_sync_run_id, target_games, target_external_opponents, target_mapping_summary);
end;
$$;

create function public.scheduled_apply_cfb_ranking_snapshot_sync(
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
  league_id uuid;
begin
  select sync_run.league_id into league_id
  from public.external_sync_runs sync_run
  where sync_run.id = target_sync_run_id;
  if league_id is null then raise exception 'Sync run not found' using errcode = 'P0002'; end if;
  perform private.bind_scheduled_cfbd_commissioner(league_id);
  return public.apply_cfb_ranking_snapshot_sync(target_sync_run_id, target_snapshots, target_missing_count);
end;
$$;

create function public.scheduled_fail_external_sync(
  target_sync_run_id uuid,
  target_summary jsonb
)
returns public.external_sync_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  league_id uuid;
begin
  select sync_run.league_id into league_id
  from public.external_sync_runs sync_run
  where sync_run.id = target_sync_run_id;
  if league_id is null then raise exception 'Sync run not found' using errcode = 'P0002'; end if;
  perform private.bind_scheduled_cfbd_commissioner(league_id);
  return public.fail_external_sync(
    target_sync_run_id,
    coalesce(target_summary, '{}'::jsonb) || jsonb_build_object('trigger', 'scheduled')
  );
end;
$$;

revoke all on function public.scheduled_begin_external_sync(uuid, text, text) from public, anon, authenticated;
revoke all on function public.scheduled_save_external_team_mappings(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.scheduled_apply_external_game_sync(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.scheduled_apply_cfb_ranking_snapshot_sync(uuid, jsonb, integer) from public, anon, authenticated;
revoke all on function public.scheduled_fail_external_sync(uuid, jsonb) from public, anon, authenticated;

grant execute on function public.scheduled_begin_external_sync(uuid, text, text) to service_role;
grant execute on function public.scheduled_save_external_team_mappings(uuid, text, jsonb) to service_role;
grant execute on function public.scheduled_apply_external_game_sync(uuid, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.scheduled_apply_cfb_ranking_snapshot_sync(uuid, jsonb, integer) to service_role;
grant execute on function public.scheduled_fail_external_sync(uuid, jsonb) to service_role;
