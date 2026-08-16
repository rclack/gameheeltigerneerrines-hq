import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  bulkScoringPlan,
  canProcessScoring,
  defaultGameView,
  executeBulkScoring,
  gameAttentionCounts,
  visibleGames,
  type ScoringDashboardGame,
} from "../../src/lib/cfbd/scoringDashboard.ts";

const scoringActions = readFileSync(new URL("../../src/app/commissioner/scoring/actions.ts", import.meta.url), "utf8");

function game(overrides: Partial<ScoringDashboardGame> & Pick<ScoringDashboardGame, "id" | "week" | "game_date">): ScoringDashboardGame {
  return {
    status: "scheduled",
    home_team_id: "home",
    away_team_id: "away",
    rankings: [{ ranking_source: "AP" }, { ranking_source: "AP" }],
    home_score: null,
    away_score: null,
    scored_at: null,
    scoring_fingerprint: null,
    ...overrides,
  };
}

test("action-first ordering keeps attention, current, upcoming, past current, then far future chronological", () => {
  const games = [
    game({ id: "future", week: 12, game_date: "2026-11-14" }),
    game({ id: "past", week: 2, game_date: "2026-09-05", status: "final", scored_at: "x", scoring_fingerprint: "x" }),
    game({ id: "upcoming", week: 5, game_date: "2026-09-26" }),
    game({ id: "current", week: 3, game_date: "2026-09-12", status: "in_progress" }),
    game({ id: "action", week: 1, game_date: "2026-08-29", status: "final", home_score: 21, away_score: 14 }),
  ];
  assert.deepEqual(visibleGames(games, "all").map((item) => item.id), ["action", "current", "upcoming", "past", "future"]);
});

test("week view filters and sorts chronologically, while useful defaults prefer attention then upcoming week", () => {
  const games = [
    game({ id: "later", week: 5, game_date: "2026-09-27" }),
    game({ id: "earlier", week: 5, game_date: "2026-09-26" }),
    game({ id: "next", week: 6, game_date: "2026-10-03" }),
  ];
  assert.equal(defaultGameView(games), "week:5");
  assert.deepEqual(visibleGames(games, "week:5").map((item) => item.id), ["earlier", "later"]);
  assert.equal(defaultGameView([...games, game({ id: "action", week: 2, game_date: "2026-09-05", status: "final", home_score: 21, away_score: 14 })]), "attention");
});

test("summary derives scoring and ranking states without changing eligibility", () => {
  const games = [
    game({ id: "needs", week: 1, game_date: "2026-08-29", status: "final", home_score: 21, away_score: 14 }),
    game({ id: "reprocess", week: 2, game_date: "2026-09-05", status: "final", home_score: 14, away_score: 21, scored_at: "x" }),
    game({ id: "missing", week: 3, game_date: "2026-09-12", status: "final", home_score: 21, away_score: 14, rankings: [] }),
    game({ id: "current", week: 4, game_date: "2026-09-19", status: "final", home_score: 21, away_score: 14, scored_at: "x", scoring_fingerprint: "x" }),
    game({ id: "scheduled", week: 5, game_date: "2026-09-26" }),
  ];
  assert.deepEqual(gameAttentionCounts(games), { needsScoring: 2, needsReprocessing: 1, missingRankingContext: 1, current: 1 });
  assert.equal(canProcessScoring(games[0]), true);
  assert.equal(canProcessScoring(games[1]), true);
  assert.equal(canProcessScoring(games[2]), false);
  assert.equal(canProcessScoring(games[3]), false);
  assert.equal(canProcessScoring(games[4]), false);
});

test("bulk plan includes only eligible finals and reports every exclusion", () => {
  const games = [
    game({ id: "eligible", week: 1, game_date: "2026-08-29", status: "final", home_score: 21, away_score: 14 }),
    game({ id: "current", week: 1, game_date: "2026-08-29", status: "final", home_score: 21, away_score: 14, scored_at: "x", scoring_fingerprint: "x" }),
    game({ id: "missing", week: 1, game_date: "2026-08-29", status: "final", home_score: 21, away_score: 14, rankings: [] }),
    game({ id: "tied", week: 1, game_date: "2026-08-29", status: "final", home_score: 14, away_score: 14 }),
    game({ id: "scheduled", week: 2, game_date: "2026-09-05" }),
  ];
  const plan = bulkScoringPlan(games);
  assert.deepEqual(plan.eligible.map((item) => item.id), ["eligible"]);
  assert.deepEqual(plan.excluded, { notFinal: 1, alreadyCurrent: 1, missingRankingContext: 1, otherwiseIneligible: 1 });
});

test("bulk execution reports partial failures and a repeated plan skips current games", async () => {
  const eligible = [
    game({ id: "success", week: 1, game_date: "2026-08-29", status: "final", home_score: 21, away_score: 14 }),
    game({ id: "failure", week: 1, game_date: "2026-08-30", status: "final", home_score: 17, away_score: 10 }),
  ];
  const result = await executeBulkScoring(eligible, async (item) => {
    if (item.id === "failure") throw new Error("Backend safeguard rejected this game.");
    item.scored_at = "x";
    item.scoring_fingerprint = "x";
    return 2;
  });
  assert.deepEqual(result.processed.map((item) => item.game.id), ["success"]);
  assert.deepEqual(result.failed, [{ game: eligible[1], reason: "Backend safeguard rejected this game." }]);
  const repeated = bulkScoringPlan(eligible);
  assert.deepEqual(repeated.eligible.map((item) => item.id), ["failure"]);
  assert.equal(repeated.excluded.alreadyCurrent, 1);
});

test("bulk server action reuses commissioner authorization and authoritative scoring", () => {
  const action = scoringActions.slice(scoringActions.indexOf("export async function scoreEligibleFinalsAction"));
  assert.match(action, /authorizedClient\(leagueId\)/);
  assert.match(action, /if \(!supabase\) return \{ error: "You do not have permission/);
  assert.match(action, /getLeagueGames\(supabase, leagueId\)/);
  assert.match(action, /scoreGame\(supabase, game\.id\)/);
  assert.match(action, /refreshScoring\(leagueId\)/);
});
