create function public.record_league_chaos_reconciliation_failure(
  target_league_id uuid,
  target_trigger text,
  target_error_category text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if target_trigger not in ('live_poll','schedule_sync','freshness','manual_validation')
     or char_length(coalesce(target_error_category,'')) not between 1 and 80 then
    raise exception 'Invalid Chaos failure telemetry' using errcode='22023';
  end if;
  if not exists (select 1 from public.league_chaos_settings where league_id=target_league_id and enabled) then return null; end if;
  insert into public.league_chaos_reconciliation_runs(league_id,observation_key,trigger_type,authority_state,
    observed_at,status,error_category)
  values (target_league_id,'failure:'||gen_random_uuid()::text,target_trigger,'unavailable',clock_timestamp(),'failed',target_error_category)
  returning id into v_id;
  update public.league_chaos_settings set consecutive_failures=consecutive_failures+1,
    last_error_category=target_error_category,updated_at=clock_timestamp() where league_id=target_league_id;
  return v_id;
end; $$;

revoke all on function public.record_league_chaos_reconciliation_failure(uuid,text,text) from public, anon, authenticated;
grant execute on function public.record_league_chaos_reconciliation_failure(uuid,text,text) to service_role;
