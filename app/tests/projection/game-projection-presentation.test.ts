import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { LiveProjectionResult, ProjectedGameFact, ProjectionOwnerResult } from "../../src/lib/projection/live-projection.ts";
import { projectionFactsForGame } from "../../src/lib/projection/presentation.ts";

function fact(overrides: Partial<ProjectedGameFact> = {}): ProjectedGameFact {
  return { gameId: "game", providerGameId: "provider", teamId: "team", teamName: "Team", opponentId: "opponent", opponentName: "Opponent", state: "live", score: { team: 21, opponent: 14 }, lineupEntryId: "entry", lineupStatus: "starter", counts: true, captainApplied: false, multiplier: 1, baseProjectedPoints: 1, projectedPoints: 1, components: [], ...overrides };
}

function owner(overrides: Partial<ProjectionOwnerResult> = {}): ProjectionOwnerResult {
  return { memberId: "owner", displayName: "Owner", officialPoints: 10, liveDelta: 1, finalPendingDelta: 0, projectedTotal: 11, officialRank: 3, projectedRank: 2, rankMovement: 1, contributingGames: [fact()], benchPotential: [], ...overrides };
}

function projection(overrides: Partial<LiveProjectionResult> = {}): LiveProjectionResult {
  return { leagueId: "league", season: "2026", competitionWeek: 5, generatedAt: "2026-10-03T18:00:00Z", liveDataFetchedAt: "2026-10-03T17:59:00Z", freshnessState: "fresh", officialAsOf: null, owners: [owner()], context: { tiedGames: [], staleGames: [], notStartedGames: [], integrityWarnings: [] }, ...overrides };
}

test("game mapping returns both drafted sides without recomputing projection semantics", () => {
  const result = projectionFactsForGame(projection({ owners: [owner(), owner({ memberId: "other", displayName: "Other", liveDelta: -1, projectedTotal: 9, officialRank: 2, projectedRank: 3, rankMovement: -1, contributingGames: [fact({ teamId: "other-team", teamName: "Other Team", projectedPoints: -1 })] })] }), "game");
  assert.equal(result.owners.length, 2);
  assert.deepEqual(result.owners.map((item) => [item.owner.displayName, item.game.projectedPoints, item.bench]), [["Owner", 1, false], ["Other", -1, false]]);
});

test("bench, tied, stale, and no-relevant-team states stay explicit", () => {
  const bench = projectionFactsForGame(projection({ owners: [owner({ contributingGames: [], benchPotential: [fact({ lineupStatus: "bench", counts: false, projectedPoints: 5 })] })] }), "game");
  assert.equal(bench.owners[0]?.bench, true);
  assert.equal(bench.owners[0]?.game.counts, false);
  assert.equal(projectionFactsForGame(projection({ owners: [], context: { tiedGames: [{ gameId: "game", providerGameId: "provider", state: "tied", label: "TIED — unresolved" }], staleGames: [], notStartedGames: [], integrityWarnings: [] } }), "game").tied, true);
  assert.equal(projectionFactsForGame(projection({ owners: [], context: { tiedGames: [], staleGames: [{ gameId: "game", providerGameId: "provider", state: "stale", label: "stale" }], notStartedGames: [], integrityWarnings: [] } }), "game").stale, true);
  assert.deepEqual(projectionFactsForGame(projection({ owners: [] }), "unrelated").owners, []);
});

test("Saturday and Game Room consumers share one authenticated read hook and remain presentation-only", () => {
  const watchlist = readFileSync(new URL("../../src/components/league/SaturdayWatchlist.tsx", import.meta.url), "utf8");
  const room = readFileSync(new URL("../../src/components/league/GameRoom.tsx", import.meta.url), "utf8");
  const hook = readFileSync(new URL("../../src/components/projection/useLiveProjection.ts", import.meta.url), "utf8");
  for (const source of [watchlist, room]) assert.match(source, /useLiveProjection\(leagueId/);
  assert.match(hook, /LIVE_PROJECTION_REFRESH_MS/);
  assert.match(hook, /credentials: "same-origin"/);
  assert.doesNotMatch(watchlist + room + hook, /CFBD|service.role|SUPABASE_SERVICE|\.rpc\(|\.insert\(|\.update\(|\.delete\(/i);
  assert.match(watchlist, /Open Game Room/);
  assert.match(room, /View standings/);
  assert.match(room, /CAPTAIN ×2|Captain ×2/);
  assert.match(room, /Does not count/);
  assert.match(room, /Tied — unresolved/);
  assert.match(room, /Final — scoring pending/);
});

test("deterministic fixtures cover the complete 3B.1D visual matrix", () => {
  const fixture = readFileSync(new URL("../../src/app/dev/game-projection-preview/page.tsx", import.meta.url), "utf8");
  for (const expected of ["captain-positive", "projectedPoints: -1", "bench-leading", "TIED — unresolved", "both", "lineupStatus: \"bench\"", "final_pending", "staleGames", "officialRank: 4", "projectedRank: 2", "rankMovement: -1", "projectedRank: 2", "watchlistGames", "unrelated", "Extremely Long Pool Team Name"]) {
    assert.ok(fixture.includes(expected), `fixture should include ${expected}`);
  }
  assert.match(fixture, /process\.env\.NODE_ENV === "production"\) notFound\(\)/);
});
