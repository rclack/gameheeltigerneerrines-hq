import assert from "node:assert/strict";
import test from "node:test";

import {
  canProcessScoring,
  defaultGameView,
  gameAttentionCounts,
  visibleGames,
  type ScoringDashboardGame,
} from "../../src/lib/cfbd/scoringDashboard.ts";

function game(overrides: Partial<ScoringDashboardGame> & Pick<ScoringDashboardGame, "id" | "week" | "game_date">): ScoringDashboardGame {
  return {
    status: "scheduled",
    home_team_id: "home",
    away_team_id: "away",
    rankings: [{ ranking_source: "AP" }, { ranking_source: "AP" }],
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
    game({ id: "action", week: 1, game_date: "2026-08-29", status: "final" }),
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
  assert.equal(defaultGameView([...games, game({ id: "action", week: 2, game_date: "2026-09-05", status: "final" })]), "attention");
});

test("summary derives scoring and ranking states without changing eligibility", () => {
  const games = [
    game({ id: "needs", week: 1, game_date: "2026-08-29", status: "final" }),
    game({ id: "reprocess", week: 2, game_date: "2026-09-05", status: "final", scored_at: "x" }),
    game({ id: "missing", week: 3, game_date: "2026-09-12", status: "final", rankings: [] }),
    game({ id: "current", week: 4, game_date: "2026-09-19", status: "final", scored_at: "x", scoring_fingerprint: "x" }),
    game({ id: "scheduled", week: 5, game_date: "2026-09-26" }),
  ];
  assert.deepEqual(gameAttentionCounts(games), { needsScoring: 2, needsReprocessing: 1, missingRankingContext: 1, current: 1 });
  assert.equal(canProcessScoring(games[0]), true);
  assert.equal(canProcessScoring(games[1]), true);
  assert.equal(canProcessScoring(games[2]), false);
  assert.equal(canProcessScoring(games[3]), false);
  assert.equal(canProcessScoring(games[4]), false);
});
