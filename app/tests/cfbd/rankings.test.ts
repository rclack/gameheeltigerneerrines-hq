import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getGameScoringState } from "../../src/lib/cfbd/scoringState.ts";
import { authoritativeSourceAt, buildRankingSnapshots, canAutomateRankingSnapshot, getCfpFirstRankingsAt, normalizeRankingSource } from "../../src/lib/cfbd/rankings.ts";
import type { CfbdRankingWeek, NormalizedCfbdGame } from "../../src/lib/cfbd/types.ts";

const cutoff = new Date("2026-11-03T23:00:00Z");
const baseGame: NormalizedCfbdGame = {
  external_id: "game-1", season: "2026", week: 10, game_date: "2026-10-31", start_at: "2026-10-31T19:00:00.000Z",
  home_external_team_id: "1", home_external_name: "Air Force", away_external_team_id: "2", away_external_name: "Alabama",
  home_score: null, away_score: null, status: "scheduled", neutral_site: false, postseason: false,
};
const prepared = [{ ...baseGame, home_team_id: "home-id", away_team_id: "away-id" }];
const rankings: CfbdRankingWeek[] = [
  { season: 2026, seasonType: "regular", week: 10, polls: [
    { poll: "AP Top 25", ranks: [{ rank: 1, school: "Alabama" }] },
    { poll: "Playoff Committee Rankings", ranks: [{ rank: 7, school: "Alabama" }, { rank: 20, school: "Air Force" }] },
  ] },
  { season: 2026, seasonType: "regular", week: 14, polls: [
    { poll: "College Football Playoff Rankings", ranks: [{ rank: 4, school: "Alabama" }] },
  ] },
];

test("AP is authoritative before CFP and records ranked plus explicitly unranked participants", () => {
  const result = buildRankingSnapshots([baseGame], prepared, rankings, cutoff);
  assert.equal(result.snapshots[0].ranking_source, "AP Top 25");
  assert.equal(result.snapshots[0].home_rank, null);
  assert.equal(result.snapshots[0].away_rank, 1);
  assert.equal(result.missing.length, 0);
});

test("CFP is exclusive at and after cutoff and AP is ignored", () => {
  const after = { ...baseGame, week: 10, start_at: cutoff.toISOString() };
  const result = buildRankingSnapshots([after], [{ ...prepared[0], start_at: after.start_at }], rankings, cutoff);
  assert.equal(authoritativeSourceAt(after.start_at, cutoff), "CFP");
  assert.equal(result.snapshots[0].ranking_source, "CFP");
  assert.equal(result.snapshots[0].away_rank, 7);
});

test("postseason carries the final CFP poll forward", () => {
  const postseason = { ...baseGame, week: 2, postseason: true, game_date: "2026-12-20", start_at: "2026-12-20T17:00:00.000Z" };
  const result = buildRankingSnapshots([postseason], prepared, rankings, cutoff);
  assert.equal(result.snapshots[0].ranking_source, "CFP");
  assert.equal(result.snapshots[0].away_rank, 4);
});

test("missing applicable poll is distinct from an explicit null unranked snapshot", () => {
  const noPriorAp = { ...baseGame, week: 1 };
  const result = buildRankingSnapshots([noPriorAp], prepared, rankings, cutoff);
  assert.equal(result.snapshots.length, 0);
  assert.deepEqual(result.missing, [{ external_id: "game-1", source: "AP Top 25" }]);
});

test("poll aliases normalize defensively and unknown names are rejected", () => {
  assert.equal(normalizeRankingSource("Associated Press Top 25"), "AP Top 25");
  assert.equal(normalizeRankingSource("Playoff Committee Rankings"), "CFP");
  assert.equal(normalizeRankingSource("Coaches Poll"), null);
  assert.throws(() => buildRankingSnapshots([baseGame], prepared, [], cutoff), /recognized AP Top 25/);
});

test("CFP cutoff configuration requires a verified timezone-aware season value", () => {
  assert.equal(getCfpFirstRankingsAt("2026", { CFP_FIRST_RANKINGS_AT_2026: cutoff.toISOString() }).toISOString(), cutoff.toISOString());
  assert.throws(() => getCfpFirstRankingsAt("2026", {}), /CFP_FIRST_RANKINGS_AT_2026/);
  assert.throws(() => getCfpFirstRankingsAt("2026", { CFP_FIRST_RANKINGS_AT_2026: "2026-11-03 18:00" }), /explicit timezone/);
});

test("automated snapshots freeze after kickoff or scoring and remain repeat-safe", () => {
  const now = new Date("2026-10-31T18:00:00Z");
  assert.equal(canAutomateRankingSnapshot(baseGame.start_at, null, now), true);
  assert.equal(canAutomateRankingSnapshot(baseGame.start_at, null, new Date("2026-10-31T20:00:00Z")), false);
  assert.equal(canAutomateRankingSnapshot(baseGame.start_at, "scored", now), false);
  assert.deepEqual(buildRankingSnapshots([baseGame], prepared, rankings, cutoff), buildRankingSnapshots([baseGame], prepared, rankings, cutoff));
});

test("migration makes manual ranking corrections invalidate scoring and require reprocessing", () => {
  const migration = readFileSync(new URL("../../supabase/migrations/20260826000000_automate_pregame_ranking_snapshots.sql", import.meta.url), "utf8");
  assert.match(migration, /ranking_changed[\s\S]*then null else game\.scoring_fingerprint/);
  assert.match(migration, /on conflict \(game_id, team_id\)[\s\S]*do update/);
  assert.match(migration, /v_game\.start_at <= now\(\) or v_game\.scoring_fingerprint is not null/);
  assert.equal(getGameScoringState({ status: "final", scored_at: "2026-10-31T23:00:00Z", scoring_fingerprint: null }), "needs_reprocessing");
});

test("scored final transitioning to canceled or postponed voids only its active game events", () => {
  const migration = readFileSync(new URL("../../supabase/migrations/20260826000000_automate_pregame_ranking_snapshots.sql", import.meta.url), "utf8");
  assert.match(migration, /existing_game\.status = 'final' and target_status <> 'final'/);
  assert.match(migration, /event\.source_type = 'game'[\s\S]*event\.source_identifier = saved_game\.id::text[\s\S]*event\.voided_at is null/);
  assert.match(migration, /void_reason = 'Game is no longer final; prior result was invalidated'/);
  assert.match(migration, /idempotency_key = event\.idempotency_key \|\| ':void:' \|\| event\.id::text/);
  assert.doesNotMatch(migration, /source_type = 'manual'[\s\S]*prior result was invalidated/);
  for (const status of ["canceled", "postponed"]) {
    assert.equal(status !== "final", true);
    assert.equal(getGameScoringState({ status, scored_at: "2026-10-31T23:00:00Z", scoring_fingerprint: null }), "not_final");
  }
});

test("voided game events leave standings and My Score while re-finalized games can be processed", () => {
  const scoringMigration = readFileSync(new URL("../../supabase/migrations/20260819000000_season_scoring.sql", import.meta.url), "utf8");
  const currentMigration = readFileSync(new URL("../../supabase/migrations/20260826000000_automate_pregame_ranking_snapshots.sql", import.meta.url), "utf8");
  assert.match(scoringMigration, /event\.voided_at is null/);
  assert.match(currentMigration, /game\.status[\s\S]*target_status[\s\S]*then null else game\.scoring_fingerprint/);
  assert.match(currentMigration, /target_status <> 'final'/);
  assert.equal(getGameScoringState({ status: "final", scored_at: "2026-10-31T23:00:00Z", scoring_fingerprint: null }), "needs_reprocessing");
});

test("final to corrected final keeps existing reprocessing behavior without status invalidation voiding", () => {
  const migration = readFileSync(new URL("../../supabase/migrations/20260826000000_automate_pregame_ranking_snapshots.sql", import.meta.url), "utf8");
  assert.match(migration, /game\.home_score, game\.away_score, game\.status/);
  assert.match(migration, /existing_game\.status = 'final' and target_status <> 'final'/);
  assert.equal("final" !== "final", false);
  assert.equal(getGameScoringState({ status: "final", scored_at: "2026-10-31T23:00:00Z", scoring_fingerprint: null }), "needs_reprocessing");
});
