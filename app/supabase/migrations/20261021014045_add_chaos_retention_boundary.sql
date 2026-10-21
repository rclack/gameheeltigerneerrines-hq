-- Explicit season-aware retention boundary. This is intentionally not scheduled
-- or invoked in Phase 3B.2C; current-season and recent audit history is preserved.
create function public.cleanup_league_chaos_history(target_now timestamptz default clock_timestamp())
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_deleted integer;
begin
  with expired as (
    select event.event_key
    from public.league_chaos_events event
    join public.league_chaos_settings setting on setting.league_id=event.league_id
    where event.lifecycle_state='resolved'
      and event.resolved_at < target_now - make_interval(months => setting.retention_months)
      and event.season <> extract(year from target_now)::integer::text
    for update of event skip locked
  )
  delete from public.league_chaos_events event using expired
  where event.event_key=expired.event_key;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end; $$;

revoke all on function public.cleanup_league_chaos_history(timestamptz) from public, anon, authenticated;
grant execute on function public.cleanup_league_chaos_history(timestamptz) to service_role;
