-- Canonical replay marker for a production-only historical data repair.
--
-- Production truth: version 20260924020741 executed once against the populated
-- production database to reconstruct seven approved Week 2-3 lineups. The exact
-- executed SQL is preserved at:
--   supabase/production-repairs/20260924020741_reconstruct_historical_weekly_lineups.sql
--
-- Fresh environments must not require production users, leagues, drafts, games,
-- or historical owner state. This marker intentionally makes the production
-- ledger version part of canonical migration history without replaying the
-- production-specific DML.

do $$
begin
  raise notice 'Skipping archived production-only repair 20260924020741 in canonical replay';
end
$$;
