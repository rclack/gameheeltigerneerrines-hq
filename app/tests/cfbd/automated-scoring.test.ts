import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  automatedScoringEnabled,
  executeAutomatedScoringGames,
  hasRequiredRankingContext,
  type AutomatedScoringGame,
} from "../../src/lib/cfbd/automatedScoring.ts";

const route = readFileSync(new URL("../../src/app/api/cron/cfbd-sync/route.ts", import.meta.url), "utf8");
const liveService = readFileSync(new URL("../../src/services/liveScoreboardService.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../supabase/migrations/20260830143826_automated_final_game_scoring.sql", import.meta.url), "utf8");

function game(overrides: Partial<AutomatedScoringGame> = {}): AutomatedScoringGame {
  return {
    id: "game-1",
    status: "final",
    home_score: 24,
    away_score: 17,
    home_team_id: "home",
    away_team_id: "away",
    scoring_fingerprint: null,
    scored_at: null,
    ...overrides,
  };
}

test("automatic scoring is inert unless explicitly enabled", () => {
  assert.equal(automatedScoringEnabled(undefined), false);
  assert.equal(automatedScoringEnabled("false"), false);
  assert.equal(automatedScoringEnabled("true"), true);
  assert.match(route, /CFBD_AUTOMATED_SCORING_ENABLED/);
});

test("ranking context requires every internal participant and permits external opponents", () => {
  assert.equal(hasRequiredRankingContext(game(), new Set(["game-1:home", "game-1:away"])), true);
  assert.equal(hasRequiredRankingContext(game(), new Set(["game-1:home"])), false);
  assert.equal(hasRequiredRankingContext(game({ away_team_id: null }), new Set(["game-1:home"])), true);
});

test("bounded sweep continues after one failure and preserves initial versus reprocess telemetry", async () => {
  const games = [game({ id: "new" }), game({ id: "failed" }), game({ id: "corrected", scored_at: "2026-08-29T23:00:00Z" })];
  const rankings = new Set(games.flatMap((item) => [`${item.id}:home`, `${item.id}:away`]));
  const calls: string[] = [];
  const result = await executeAutomatedScoringGames(games, rankings, async (gameId) => {
    calls.push(gameId);
    return { error: gameId === "failed" ? { code: "XX000" } : null };
  });
  assert.deepEqual(calls, ["new", "failed", "corrected"]);
  assert.deepEqual(result, {
    newlyScored: 1,
    reprocessed: 1,
    failures: [{ gameId: "failed", category: "database_write" }],
  });
});

test("invalid finals and missing rankings remain retryable without invoking scoring", async () => {
  const calls: string[] = [];
  const result = await executeAutomatedScoringGames(
    [game({ id: "tie", home_score: 7, away_score: 7 }), game({ id: "rankings" })],
    new Set(),
    async (gameId) => { calls.push(gameId); return { error: null }; },
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(result.failures, [
    { gameId: "tie", category: "invalid_final" },
    { gameId: "rankings", category: "missing_ranking_context" },
  ]);
});

test("scheduled wrapper reuses the existing scoring processor and is service-role only", () => {
  assert.match(migration, /private\.bind_scheduled_cfbd_commissioner\(target_league_id\)/);
  assert.match(migration, /return public\.process_cfb_game_scoring\(target_game_id\)/);
  assert.match(migration, /revoke all on function public\.scheduled_process_cfb_game_scoring\(uuid\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.scheduled_process_cfb_game_scoring\(uuid\) to service_role/);
});

test("schedule import completes before the isolated scoring stage and recap remains downstream", () => {
  const syncIndex = route.indexOf("syncScheduledCfbdSchedule");
  const scoringIndex = route.indexOf("runAutomatedScoringSweep", syncIndex);
  const recapIndex = route.indexOf("runScheduledRecapBatch", scoringIndex);
  assert.ok(syncIndex >= 0 && scoringIndex > syncIndex && recapIndex > scoringIndex);
});

test("canonical live ingestion remains informational and cannot invoke official scoring", () => {
  assert.doesNotMatch(liveService, /process_cfb_game_scoring|scheduled_process_cfb_game_scoring|scoring_events/);
});
