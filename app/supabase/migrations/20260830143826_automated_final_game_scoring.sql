-- Scheduled scoring remains a separate stage after a successful schedule import.
-- These wrappers preserve the existing commissioner-authorized scoring engine
-- while exposing only the minimum service-role surface needed by the cron route.

create function public.scheduled_process_cfb_game_scoring(target_game_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_league_id uuid;
begin
  select game.league_id into target_league_id
  from public.cfb_games game
  where game.id = target_game_id;

  if target_league_id is null then
    raise exception 'Game not found' using errcode = 'P0002';
  end if;

  perform private.bind_scheduled_cfbd_commissioner(target_league_id);
  return public.process_cfb_game_scoring(target_game_id);
end;
$$;

create function public.record_scheduled_scoring_sweep(
  target_sync_run_id uuid,
  target_summary jsonb
)
returns public.external_sync_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_league_id uuid;
  updated_run public.external_sync_runs;
begin
  select sync_run.league_id into target_league_id
  from public.external_sync_runs sync_run
  where sync_run.id = target_sync_run_id;

  if target_league_id is null then
    raise exception 'Sync run not found' using errcode = 'P0002';
  end if;

  perform private.bind_scheduled_cfbd_commissioner(target_league_id);

  update public.external_sync_runs sync_run
  set summary = coalesce(sync_run.summary, '{}'::jsonb)
    || jsonb_build_object('automated_scoring', coalesce(target_summary, '{}'::jsonb))
  where sync_run.id = target_sync_run_id
  returning sync_run.* into updated_run;

  return updated_run;
end;
$$;

revoke all on function public.scheduled_process_cfb_game_scoring(uuid) from public, anon, authenticated;
revoke all on function public.record_scheduled_scoring_sweep(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.scheduled_process_cfb_game_scoring(uuid) to service_role;
grant execute on function public.record_scheduled_scoring_sweep(uuid, jsonb) to service_role;
