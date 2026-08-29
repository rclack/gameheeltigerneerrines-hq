import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { activeLivePollRun } from "../../src/lib/cfbd/livePollRun.ts";
import { livePresentation, validatedLiveClock, type LiveScoreboardGame, type LiveScoreboardSnapshot } from "../../src/lib/cfbd/livePresentation.ts";

const migration = readFileSync(new URL("../../supabase/migrations/20260903000000_live_scoreboard_foundation.sql", import.meta.url), "utf8");
const route = readFileSync(new URL("../../src/app/api/cron/cfbd-live/route.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("../../src/services/liveScoreboardService.ts", import.meta.url), "utf8");
const quotaMigration = readFileSync(new URL("../../supabase/migrations/20260903000003_live_scoreboard_quota_sampling.sql", import.meta.url), "utf8");
const activationMigration = readFileSync(new URL("../../supabase/migrations/20260903000004_live_scoreboard_drafted_game_cadence.sql", import.meta.url), "utf8");
const phase3a2Migration = readFileSync(new URL("../../supabase/migrations/20260903000007_phase_3a_2_live_cadence_relevance_telemetry.sql", import.meta.url), "utf8");
const leagueHome = readFileSync(new URL("../../src/app/league/[leagueId]/page.tsx", import.meta.url), "utf8");
const gameService = readFileSync(new URL("../../src/services/gameService.ts", import.meta.url), "utf8");

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

test("Phase 3A.2 anchors normal cadence to poll start without changing lease or backoff authority", () => {
  assert.match(phase3a2Migration, /greatest\(v_run\.started_at \+ make_interval\(secs => v_interval\), v_now\)/);
  assert.doesNotMatch(phase3a2Migration, /lease_expires_at\s*=/);
  assert.doesNotMatch(phase3a2Migration, /fail_live_scoreboard_poll/);
});

test("Phase 3A.2 records provider, canonical, drafted-relevant, and drafted-live counts", () => {
  for (const column of ["provider_game_count", "canonical_game_count", "drafted_relevant_game_count", "drafted_live_game_count"]) {
    assert.match(phase3a2Migration, new RegExp(column));
  }
  assert.match(phase3a2Migration, /v_drafted_live := v_drafted_live \+ 1/);
  assert.match(activationMigration, /case when v_any_drafted_live then live_interval_seconds else pregame_interval_seconds end/);
  assert.equal((service.match(/fetchCfbdScoreboard\(\)/g) ?? []).length, 1);
});

const liveGame: LiveScoreboardGame = {
  provider: "cfbd", provider_game_id: "401", start_at: "2026-08-29T16:00:00Z", status: "in_progress",
  period: 4, clock: "08:21", situation: null, possession: null, last_play: null,
  home_external_team_id: "1", home_name: "TCU", home_score: 10, home_win_probability: 0.5,
  away_external_team_id: "2", away_name: "North Carolina", away_score: 15, away_win_probability: 0.5,
  state_fingerprint: "current", fetched_at: "2026-08-29T19:00:00Z", changed_at: "2026-08-29T19:00:00Z",
  first_seen_at: "2026-08-29T16:00:00Z", first_in_progress_at: "2026-08-29T16:13:00Z", first_completed_at: null,
};
const priorSnapshot: LiveScoreboardSnapshot = {
  id: 1, provider: "cfbd", provider_game_id: "401", status: "in_progress", period: 4, clock: "00:07",
  situation: null, possession: null, last_play: null, home_score: 10, home_win_probability: 0.5,
  away_score: 15, away_win_probability: 0.5, state_fingerprint: "prior",
  fetched_at: "2026-08-29T18:48:00Z", created_at: "2026-08-29T18:48:00Z",
};

test("website live overlay accepts fresh state and rejects stale state", () => {
  const fresh = livePresentation(liveGame, [], new Date("2026-08-29T19:05:00Z").getTime());
  assert.equal(fresh?.status, "in_progress");
  assert.equal(fresh?.homeScore, 10);
  assert.equal(livePresentation(liveGame, [], new Date("2026-08-29T19:16:00Z").getTime()), null);
  assert.match(leagueHome, /livePresentationData/);
  assert.match(leagueHome, /displayStatus = live\?\.status \?\? game\.status/);
  assert.match(gameService, /optional_live_presentation_read_failure/);
  assert.match(gameService, /return \{ games: new Map\(\), snapshots: new Map\(\) \}/);
});

test("impossible and regressive clocks are presentation-ineligible while raw snapshots remain untouched", () => {
  assert.equal(validatedLiveClock(liveGame, [priorSnapshot]), null);
  assert.equal(validatedLiveClock({ ...liveGame, clock: "16:00" }, []), null);
  assert.equal(validatedLiveClock({ ...liveGame, clock: "07:59" }, [{ ...priorSnapshot, clock: "08:21" }]), "07:59");
  assert.equal(priorSnapshot.clock, "00:07");
});

test("website overlay remains presentation-only", () => {
  for (const forbidden of ["scoring_events", "scoring_fingerprint", "weekly_lineup", "sunday_recap", "draft_picks"]) {
    assert.doesNotMatch(leagueHome, new RegExp(`(?:insert|update|delete).*${forbidden}`, "i"));
  }
  assert.match(leagueHome, /getLivePresentationData/);
});
