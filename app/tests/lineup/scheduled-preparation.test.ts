import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { selectPreparationWeek } from "../../src/lib/lineup/scheduledPreparation.ts";

const route = readFileSync(new URL("../../src/app/api/cron/cfbd-sync/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../../src/services/lineupService.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../supabase/migrations/20260923182829_proactive_weekly_lineup_materialization.sql", import.meta.url), "utf8");

test("the earliest future non-terminal application week is prepared", () => {
  const now = new Date("2026-09-23T16:00:00Z");
  assert.equal(selectPreparationWeek([
    { week: 3, start_at: "2026-09-20T16:00:00Z", status: "final" },
    { week: 4, start_at: "2026-09-26T16:00:00Z", status: "scheduled" },
    { week: 5, start_at: "2026-10-03T16:00:00Z", status: "scheduled" },
  ], 0, now), 4);
  assert.equal(selectPreparationWeek([{ week: 4, start_at: "2026-09-26T16:00:00Z", status: "scheduled" }], null, now), null);
});

test("schedule sync prepares lineups before automated scoring", () => {
  const sync = route.indexOf("const syncRun = await syncScheduledCfbdSchedule");
  const lineup = route.indexOf("prepareScheduledWeeklyLineups", sync);
  const scoring = route.indexOf("runAutomatedScoringSweep", sync);
  assert.ok(sync >= 0 && lineup > sync && scoring > lineup);
});

test("owner page reads existing authority and cannot materialize it", () => {
  assert.doesNotMatch(page, /rpc\("materialize_weekly_lineup"/);
  assert.match(page, /maybeSingle/);
});

test("scheduled APIs are service-role-only and readiness is read-only", () => {
  assert.match(migration, /scheduled_materialize_weekly_lineups/);
  assert.match(migration, /get_scheduled_weekly_lineup_readiness/);
  assert.match(migration, /revoke all on function public\.materialize_weekly_lineup\(uuid, integer, uuid\) from authenticated/);
  assert.match(migration, /grant execute on function public\.scheduled_materialize_weekly_lineups\(uuid, integer\) to service_role/);
  const readiness = migration.slice(migration.indexOf("create function public.get_scheduled_weekly_lineup_readiness"), migration.indexOf("create function public.record_scheduled_weekly_lineup_preparation"));
  assert.doesNotMatch(readiness, /\binsert\b|\bupdate\b|\bdelete\b/);
});
