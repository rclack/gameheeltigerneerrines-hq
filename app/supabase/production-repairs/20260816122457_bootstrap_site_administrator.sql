-- PRODUCTION-ONLY HISTORICAL DATA REPAIR
--
-- This block originally executed inside the production migration recorded as
-- 20260816122457_controlled_league_creation. It is preserved verbatim for
-- provenance, but must not be included in a clean migration replay because it
-- depends on a named, pre-existing production Auth identity.

do $$
declare
  administrator_id uuid;
  administrator_count integer;
begin
  select count(*) into administrator_count
  from auth.users where lower(email) = 'cfbpooltest@gmail.com';
  if administrator_count <> 1 then
    raise exception 'Expected exactly one authenticated site-administrator account';
  end if;
  select id into administrator_id from auth.users where lower(email) = 'cfbpooltest@gmail.com';
  insert into private.site_administrators (user_id) values (administrator_id);
end;
$$;
