import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { activeLivePollRun } from "../../src/lib/cfbd/livePollRun.ts";

const migration = readFileSync(new URL("../../supabase/migrations/20260903000000_live_scoreboard_foundation.sql", import.meta.url), "utf8");
const route = readFileSync(new URL("../../src/app/api/cron/cfbd-live/route.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("../../src/services/liveScoreboardService.ts", import.meta.url), "utf8");
const quotaMigration = readFileSync(new URL("../../supabase/migrations/20260903000003_live_scoreboard_quota_sampling.sql", import.meta.url), "utf8");
const activationMigration = readFileSync(new URL("../../supabase/migrations/20260903000004_live_scoreboard_drafted_game_cadence.sql", import.meta.url), "utf8");

const validRunIdentity = {
  id: "b07a2d45-67fc-4d11-81c4-86bc17fb0098",
  lease_token: "2cb7d408-51d9-4e4f-96d1-d36c62d93073",
};

test("disabled live polling normalizes literal null and PostgREST null-field composites to no run", () => {
  assert.equal(activeLivePollRun(null), null);
  assert.equal(activeLivePollRun({ id: null, lease_token: null }), null);
  assert.equal(activeLivePollRun({ id: validRunIdentity.id, lease_token: null }), null);
  assert.equal(activeLivePollRun({ id: null, lease_token: validRunIdentity.lease_token }), null);
});

test("valid live poll identity remains authoritative", () => {
  assert.equal(activeLivePollRun(validRunIdentity), validRunIdentity);
  assert.equal(activeLivePollRun({ ...validRunIdentity, id: "not-a-run-id" }), null);
});

test("live poll service returns immediately for either disabled RPC shape", () => {
  assert.match(service, /const run = activeLivePollRun\(begin\.data\);\s*if \(!run\) return null;/);
  const noRunGuard = service.indexOf("if (!run) return null;");
  for (const downstreamCall of [
    "fetchCfbdAccountInfo()",
    "fetchCfbdScoreboard()",
    'supabase.rpc("record_live_scoreboard_call_breakdown"',
    'supabase.rpc("complete_live_scoreboard_poll"',
    'supabase.rpc("fail_live_scoreboard_poll"',
  ]) assert.ok(noRunGuard >= 0 && noRunGuard < service.indexOf(downstreamCall), `${downstreamCall} must remain after the no-run return`);
});

test("route preserves unauthorized, disabled no-op, and genuine failure contracts", () => {
  assert.match(route, /status: 401/);
  assert.match(route, /ok: true, polled: Boolean\(run\), runId: run\?\.id \?\? null/);
  assert.match(route, /status: 503/);
});

test("live scoreboard capability starts inert with 10/3 minute intervals and no incompatible Vercel cron", () => {
  assert.match(migration, /enabled boolean not null default false/);
  assert.match(migration, /pregame_interval_seconds integer not null default 600/);
  assert.match(migration, /live_interval_seconds integer not null default 180/);
  assert.doesNotMatch(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"), /cfbd-live/);
});

test("one canonical provider poll serves the configured league scope", () => {
  assert.match(service, /fetchCfbdScoreboard\(\)/);
  assert.equal((service.match(/fetchCfbdScoreboard\(\)/g) ?? []).length, 1);
  assert.match(route, /configuredCronLeagueIds/);
  assert.match(migration, /primary key \(provider, provider_game_id\)/);
  assert.match(migration, /game\.external_id = v_item->>'provider_game_id'/);
});

test("changed snapshots deduplicate and never touch official scoring state", () => {
  assert.match(migration, /unique \(provider, provider_game_id, state_fingerprint\)/);
  assert.match(migration, /state_fingerprint is distinct from/);
  for (const forbidden of ["scoring_events", "scoring_fingerprint", "team_ranking_snapshots", "weekly_lineup", "sunday_recap", "draft_picks"]) {
    assert.doesNotMatch(migration, new RegExp(`(?:insert into|update|delete from) public\\.${forbidden}`, "i"));
  }
});

test("live reads are member scoped and writes/RPCs remain elevated only", () => {
  assert.match(migration, /private\.is_league_member\(game\.league_id\)/);
  assert.match(migration, /grant select on public\.live_scoreboard_games/);
  assert.match(migration, /revoke insert, update, delete/);
  assert.match(migration, /grant execute on function public\.begin_live_scoreboard_poll\(text, uuid\[\]\) to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.(?:begin|complete|fail)_live_scoreboard_poll[^;]+to authenticated/);
});

test("forward privilege repair removes anonymous live-table access", () => {
  const repair = readFileSync(new URL("../../supabase/migrations/20260903000001_live_scoreboard_privilege_repair.sql", import.meta.url), "utf8");
  for (const table of ["live_scoreboard_games", "live_scoreboard_snapshots", "live_scoreboard_poll_runs"]) assert.match(repair, new RegExp(`revoke all on public\\.${table} from anon`));
  assert.match(repair, /revoke all on sequence public\.live_scoreboard_snapshots_id_seq from anon, authenticated/);
});

test("polling has a lease, local counters, quota cap, and provider backoff", () => {
  assert.match(migration, /lease_expires_at > clock_timestamp\(\)/);
  assert.match(migration, /monthly_call_cap integer not null default 24000/);
  assert.match(migration, /sum\(provider_calls\)/);
  assert.match(migration, /least\(3600, 180/);
});

test("routine live polling reuses an hourly quota sample and spends one scoreboard call", () => {
  assert.match(quotaMigration, /last_quota_checked_at timestamptz/);
  assert.match(quotaMigration, /record_live_scoreboard_quota_sample/);
  assert.match(quotaMigration, /v_control\.last_quota_checked_at/);
  assert.match(service, /trigger === "manual" \|\| liveQuotaSampleDue\(run\)/);
  assert.equal((service.match(/fetchCfbdScoreboard\(\)/g) ?? []).length, 1);
  assert.match(service, /record_live_scoreboard_quota_sample/);
  assert.match(service, /if \(!sampledQuota\)/);
  assert.match(activationMigration, /scoreboard_calls integer not null default 0/);
  assert.match(activationMigration, /info_calls integer not null default 0/);
  assert.match(activationMigration, /record_live_scoreboard_call_breakdown/);
});

test("scheduled cadence is driven only by teams drafted in completed scoped leagues", () => {
  assert.match(activationMigration, /join public\.drafts draft on draft\.league_id = game\.league_id and draft\.status = 'complete'/);
  assert.match(activationMigration, /join public\.draft_picks pick on pick\.draft_id = draft\.id/);
  assert.match(activationMigration, /pick\.team_id in \(game\.home_team_id, game\.away_team_id\)/);
  assert.match(activationMigration, /v_any_drafted_live/);
});
