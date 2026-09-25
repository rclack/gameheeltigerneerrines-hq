-- Ordinary clients should reach gameplay mutations through the reviewed RPCs.
-- RLS already denied these unused grants; revoking them makes the database
-- privilege boundary match the application authorization model.
revoke all privileges on all tables in schema public from anon;

revoke insert, update, delete on all tables in schema public from authenticated;

-- These are the only intentional direct authenticated table writes. Their
-- existing RLS policies remain the row-level authorization boundary.
grant update on table public.profiles to authenticated;
grant insert, update, delete on table public.league_members to authenticated;
grant update, delete on table public.leagues to authenticated;

-- Trigger functions do not need to be directly callable through PostgREST.
revoke execute on function public.set_updated_at() from public, anon;
