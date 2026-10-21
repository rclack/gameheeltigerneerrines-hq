create or replace function public.touch_duplicate_chaos_observation(
  target_league_id uuid,
  target_observation_key text,
  target_observed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.league_chaos_settings
  set last_success_at = clock_timestamp(),
      last_observation_at = target_observed_at,
      last_observation_key = target_observation_key,
      consecutive_failures = 0,
      last_error_category = null,
      updated_at = clock_timestamp()
  where league_id = target_league_id
    and enabled = true;
end;
$$;

revoke all on function public.touch_duplicate_chaos_observation(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.touch_duplicate_chaos_observation(uuid, text, timestamptz)
  to service_role;
