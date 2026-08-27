import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { assessRecapReadiness, buildVerifiedRecapPayload, type RecapMemberInput, type SnapshotInput } from "../../src/lib/recap/dataset.ts";
import { pendingRecapRecipients } from "../../src/lib/recap/delivery.ts";
import { runScheduledRecapBatch } from "../../src/lib/recap/cron.ts";
import { validateRecapNarrative } from "../../src/lib/recap/narrativeValidation.ts";
import type { GameDetail } from "../../src/services/gameService.ts";
import type { ScoringEventDetail } from "../../src/services/scoringService.ts";
import type { League, Team } from "../../src/types/database.ts";

const league = { id: "league", name: "Saturday Legends", season: "2026" } as League;
const auburn = { id: "auburn", school_name: "Auburn" } as Team;
const georgia = { id: "georgia", school_name: "Georgia" } as Team;
const members = [
  { id: "member-a", team_name: "War Eagles", ownerName: "Randy" },
  { id: "member-b", team_name: "Dawgs", ownerName: "Carson" },
] as RecapMemberInput[];

function game(overrides: Partial<GameDetail> = {}): GameDetail {
  return { id: "game-1", league_id: league.id, week: 4, status: "final", scored_at: "2026-09-20T04:00:00Z", scoring_fingerprint: "current", home_team_id: auburn.id, away_team_id: georgia.id, home_score: 27, away_score: 24, homeParticipant: { kind: "internal", id: auburn.id, displayName: "Auburn", classification: "fbs", team: auburn }, awayParticipant: { kind: "internal", id: georgia.id, displayName: "Georgia", classification: "fbs", team: georgia }, rankings: [{ team_id: georgia.id, rank: 3, ranking_source: "AP Top 25" }], ...overrides } as GameDetail;
}

function scoringEvent(overrides: Partial<ScoringEventDetail> = {}): ScoringEventDetail {
  return { id: "event-1", league_id: league.id, team_id: auburn.id, week: 4, points: 4, source_type: "game", source_identifier: "game-1", voided_at: null, rule: { display_name: "Win over Top 5" }, team: auburn, ...overrides } as ScoringEventDetail;
}

function payload(snapshotOverrides: Partial<SnapshotInput>[] = [], eventOverrides: ScoringEventDetail[] = [scoringEvent()]) {
  const snapshots: SnapshotInput[] = [
    { league_member_id: "member-a", total_points: 12, standing_position: 1, weekly_points: 4, prior_position: 3 },
    { league_member_id: "member-b", total_points: 8, standing_position: 2, weekly_points: -1, prior_position: 1 },
  ].map((item, index) => ({ ...item, ...snapshotOverrides[index] }));
  return buildVerifiedRecapPayload({ league, week: 4, snapshots, members, picks: [{ league_member_id: "member-a", team: auburn }, { league_member_id: "member-b", team: georgia }], events: eventOverrides, games: [game(), game({ id: "game-2", week: 5 })] });
}

test("normal week uses only verified snapshots, active scoring, game results, and ranking context", () => {
  const result = payload();
  assert.equal(result.standings[0].movement, 2);
  assert.equal(result.events[0].finalScore, "27-24");
  assert.equal(result.events[0].opponentPregameRank, 3);
  assert.match(result.facts.find((fact) => fact.id === "event:event-1")!.text, /#3 Georgia/);
  assert.equal(result.nextWeek, 5);
});

test("Captain recap facts use deterministic base, multiplier, and final points", () => {
  const result = payload([], [scoringEvent({ points: 8, base_points: 4, scoring_multiplier: 2, captain_at_scoring: true })]);
  assert.deepEqual({ base: result.events[0].basePoints, multiplier: result.events[0].scoringMultiplier, captain: result.events[0].captainApplied, final: result.events[0].points }, { base: 4, multiplier: 2, captain: true, final: 8 });
  assert.match(result.facts.find((fact) => fact.id === "event:event-1")!.text, /as Captain \(\+4 × 2 = \+8\)/);
});

test("zero-event weeks produce a factual quiet-week card", () => {
  const result = payload([{ weekly_points: 0, prior_position: 1 }, { weekly_points: 0, prior_position: 2 }], []);
  assert.deepEqual(result.events, []);
  assert.equal(result.facts.length, 1);
  assert.match(result.facts[0].text, /no active scoring changes/);
});

test("Week 0 is a legitimate recap boundary", () => {
  const weekZeroSnapshots: SnapshotInput[] = [
    { league_member_id: "member-a", total_points: 0, standing_position: 1, weekly_points: 0, prior_position: null },
    { league_member_id: "member-b", total_points: 0, standing_position: 2, weekly_points: 0, prior_position: null },
  ];
  const payload = buildVerifiedRecapPayload({ league, week: 0, snapshots: weekZeroSnapshots, members, picks: [{ league_member_id: "member-a", team: auburn }, { league_member_id: "member-b", team: georgia }], events: [], games: [game({ week: 0 })] });
  assert.equal(payload.league.week, 0);
  assert.equal(payload.nextWeek, null);
  assert.match(payload.facts[0].text, /Week 0/);
});

test("ties do not force unsupported weekly superlatives", () => {
  const result = payload([{ weekly_points: 3, prior_position: null }, { weekly_points: 3, prior_position: null }], []);
  assert.equal(result.facts.some((fact) => fact.id.startsWith("top:")), false);
  assert.equal(result.standings.every((row) => row.movement === null), true);
});

test("large movers and negative weeks are calculated from frozen snapshots", () => {
  const result = payload([{ standing_position: 1, prior_position: 4, weekly_points: 8 }, { standing_position: 4, prior_position: 1, weekly_points: -6 }], []);
  assert.match(result.facts.find((fact) => fact.label === "Biggest Mover")!.text, /climbed 3 spots/);
  assert.match(result.facts.find((fact) => fact.label === "Toughest Saturday")!.text, /-6 points/);
});

test("voided/corrected events stay excluded by requiring the active-event input", () => {
  const corrected = scoringEvent({ id: "replacement", points: 1, rule: { display_name: "Win" } as ScoringEventDetail["rule"] });
  const result = payload([], [corrected]);
  assert.deepEqual(result.events.map((event) => event.id), ["replacement"]);
  assert.equal(result.events.some((event) => event.id === "event-1"), false);
});

test("readiness blocks unprocessed finals and permits scoring-current or canceled weeks", () => {
  assert.equal(assessRecapReadiness([game({ scoring_fingerprint: null, scored_at: null })], 4).ready, false);
  assert.equal(assessRecapReadiness([game({ status: "scheduled", scoring_fingerprint: null, scored_at: null })], 4).ready, false);
  assert.equal(assessRecapReadiness([game(), game({ id: "canceled", status: "canceled", scoring_fingerprint: null, scored_at: null })], 4).ready, true);
});

test("AI narrative accepts verified fact references and rejects invented details", () => {
  const verified = payload();
  const valid = { subjectHook: "Saturday brought the noise", opening: "The pool delivered another lively weekend.", stories: [{ factId: verified.facts[0].id, reaction: "That is how a statement gets made." }], closing: "Bring on the next slate." };
  assert.deepEqual(validateRecapNarrative(verified, valid), valid);
  assert.throws(() => validateRecapNarrative(verified, { ...valid, opening: "Auburn added 9 points." }), /outside the verified fact cards/);
  assert.throws(() => validateRecapNarrative(verified, { ...valid, stories: [{ factId: "invented", reaction: "Chaos." }] }), /unverified recap fact/);
});

test("repeat delivery skips recipients already marked sent", () => {
  assert.deepEqual(pendingRecapRecipients(["a", "b", "c"], [{ league_member_id: "a", status: "sent" }, { league_member_id: "b", status: "failed" }]), ["b", "c"]);
});

test("scheduled batch isolates failures and keeps processing leagues", async () => {
  const result = await runScheduledRecapBatch(["ok", "skip", "fail"], async (item) => { if (item === "fail") throw new Error("AI unavailable"); return item === "skip" ? "skipped" : "succeeded"; });
  assert.deepEqual(result, { succeeded: 1, skipped: 1, failed: 1 });
});

test("migration enforces idempotency, RLS, and service-role-only snapshot execution", () => {
  const migration = readFileSync(new URL("../../supabase/migrations/20260816032427_sunday_recap_v1.sql", import.meta.url), "utf8");
  assert.match(migration, /unique \(league_id, season, week, league_member_id\)/i);
  assert.match(migration, /unique \(league_id, season, week\)/i);
  assert.match(migration, /unique \(recap_id, league_member_id\)/i);
  assert.match(migration, /enable row level security/gi);
  assert.match(migration, /revoke all on function public\.create_weekly_recap_snapshot\(uuid, integer\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.create_weekly_recap_snapshot\(uuid, integer\) to service_role/i);
  assert.doesNotMatch(migration, /grant select, insert, update, delete on public\.weekly_recap_snapshots/i);
});

test("commissioner actions authorize before creating an elevated client", () => {
  const actions = readFileSync(new URL("../../src/app/commissioner/scoring/recap-actions.ts", import.meta.url), "utf8");
  const generate = actions.slice(actions.indexOf("export async function generateSundayRecapAction"), actions.indexOf("export async function sendSundayRecapAction"));
  assert.ok(generate.indexOf("await authorize") < generate.indexOf("createCronClient"));
  assert.match(actions, /Only the league commissioner can send this recap/);
});

test("cron schedule remains within two slots and Sunday recaps reuse the protected route", () => {
  const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
  const route = readFileSync(new URL("../../src/app/api/cron/cfbd-sync/route.ts", import.meta.url), "utf8");
  assert.equal(config.crons.length, 2);
  assert.match(route, /isAuthorizedCronRequest/);
  assert.match(route, /isSundayInEastern/);
  assert.match(route, /sendPreparedSundayRecap/);
});
