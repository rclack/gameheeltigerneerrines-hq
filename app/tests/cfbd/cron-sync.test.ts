import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { configuredCronLeagueIds, isAuthorizedCronRequest, runScheduledSyncBatch } from "../../src/lib/cfbd/cron.ts";

const route = readFileSync(new URL("../../src/app/api/cron/cfbd-sync/route.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("../../src/services/cfbdService.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../supabase/migrations/20260828000000_scheduled_cfbd_sync.sql", import.meta.url), "utf8");
const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));

test("cron authorization accepts only the configured bearer secret", () => {
  assert.equal(isAuthorizedCronRequest("Bearer correct-secret", "correct-secret"), true);
  assert.equal(isAuthorizedCronRequest("Bearer wrong-secret", "correct-secret"), false);
  assert.equal(isAuthorizedCronRequest(null, "correct-secret"), false);
  assert.equal(isAuthorizedCronRequest("Bearer correct-secret", undefined), false);
});

test("cron league scope is fixed configuration, deduplicated, and validated", () => {
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(configuredCronLeagueIds(`${first}, ${second},${first}`), [first, second]);
  assert.throws(() => configuredCronLeagueIds(""));
  assert.throws(() => configuredCronLeagueIds("not-a-league-id"));
  assert.doesNotMatch(route, /searchParams|request\.json|target_league_id/);
});

test("scheduled batch reports success, overlap skips, and partial failures", async () => {
  const leagues = [
    { id: "one", season: "2026" },
    { id: "two", season: "2026" },
    { id: "three", season: "2026" },
  ];
  const result = await runScheduledSyncBatch(leagues, async (league) => {
    if (league.id === "two") return "skipped";
    if (league.id === "three") throw new Error("provider failed");
    return "succeeded";
  });
  assert.deepEqual(result, { succeeded: 1, skipped: 1, failed: 1 });
});

test("scheduled path wraps the existing sync implementation and audit failure path", () => {
  assert.match(service, /syncCfbdScheduleInternal\(supabase, leagueId, season, false\)/);
  assert.match(service, /syncCfbdScheduleInternal\(supabase, leagueId, season, true\)/);
  assert.match(service, /scheduled_fail_external_sync/);
  assert.match(service, /await failSync\(supabase, run\.id, failure, progress, scheduled\)/);
  assert.match(route, /syncScheduledCfbdSchedule[\s\S]*runAutomatedScoringSweep/);
  assert.doesNotMatch(route, /scoring_events\.(insert|update)|from\("scoring_events"\)/);
});

test("scheduled database wrappers are service-role-only and overlap guarded", () => {
  assert.match(migration, /request_role is distinct from 'service_role'/);
  assert.match(migration, /revoke all on function public\.scheduled_begin_external_sync[\s\S]+from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.scheduled_begin_external_sync[\s\S]+to service_role/);
  assert.match(migration, /CFBD synchronization is already running/);
  assert.match(migration, /stale synchronization run was closed by the overlap guard/);
});

test("Vercel retains only Hobby-compatible CFBD synchronization schedules", () => {
  assert.deepEqual(vercel.crons, [
    { path: "/api/cron/cfbd-sync", schedule: "0 11 * * *" },
    { path: "/api/cron/cfbd-sync", schedule: "0 21 * * 6" },
  ]);
});
