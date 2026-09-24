-- Ensure provider-owned tables are read-only through direct browser table APIs.
-- SECURITY DEFINER synchronization functions retain their owner privileges.

revoke insert, update, delete on table public.external_opponents from public, anon, authenticated;
revoke insert, update, delete on table public.external_team_mappings from public, anon, authenticated;
revoke insert, update, delete on table public.external_sync_runs from public, anon, authenticated;

grant select on table public.external_opponents to authenticated;
grant select on table public.external_team_mappings to authenticated;
grant select on table public.external_sync_runs to authenticated;
