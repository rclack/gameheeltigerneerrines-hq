import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { LiveProjectionResult, ProjectionOwnerResult, ProjectedGameFact } from "../../src/lib/projection/live-projection.ts";
import { hasMeaningfulProjectionContext, LIVE_PROJECTION_REFRESH_MS, projectedGameSummary, projectedMovementLabel, projectionFreshnessLabel, provisionalPoints, signedPoints } from "../../src/lib/projection/presentation.ts";

function game(overrides: Partial<ProjectedGameFact> = {}): ProjectedGameFact {
  return { gameId: "game", providerGameId: "provider", week: 5, opponentMemberId: null, teamPregameRank: null, opponentPregameRank: null, teamRankingContextResolved: true, opponentRankingContextResolved: true, teamClassification: "POWER", opponentClassification: "POWER", period: 3, sourceFreshness: "fresh", sourceFetchedAt: "2026-10-03T17:59:00Z", canonicalStateFingerprint: "fixture", teamId: "team", teamName: "Team", opponentId: "opponent", opponentName: "Opponent", state: "live",
    score: { team: 21, opponent: 14 }, lineupEntryId: "entry", lineupStatus: "starter", counts: true, captainApplied: false, multiplier: 1,
    baseProjectedPoints: 1, projectedPoints: 1, components: [], ...overrides };
}

function owner(overrides: Partial<ProjectionOwnerResult> = {}): ProjectionOwnerResult {
  return { memberId: "owner", displayName: "Owner", officialPoints: 10, liveDelta: 0, finalPendingDelta: 0, projectedTotal: 10,
    officialRank: 2, projectedRank: 2, rankMovement: 0, contributingGames: [], benchPotential: [], ...overrides };
}

function projection(overrides: Partial<LiveProjectionResult> = {}): LiveProjectionResult {
  return { leagueId: "league", season: "2026", competitionWeek: 5, generatedAt: "2026-10-03T18:00:00Z", liveDataFetchedAt: null,
    freshnessState: "unavailable", officialAsOf: null, owners: [owner()], context: { tiedGames: [], staleGames: [], notStartedGames: [], integrityWarnings: [] }, ...overrides };
}

test("inactive standings stay clean while every meaningful provisional state activates the enhancement", () => {
  assert.equal(hasMeaningfulProjectionContext(projection()), false);
  assert.equal(hasMeaningfulProjectionContext(projection({ owners: [owner({ liveDelta: 1, projectedTotal: 11 })] })), true);
  assert.equal(hasMeaningfulProjectionContext(projection({ owners: [owner({ liveDelta: -1, projectedTotal: 9 })] })), true);
  assert.equal(hasMeaningfulProjectionContext(projection({ owners: [owner({ liveDelta: 8, projectedTotal: 18, contributingGames: [game({ captainApplied: true, multiplier: 2, projectedPoints: 8 })] })] })), true);
  assert.equal(hasMeaningfulProjectionContext(projection({ owners: [owner({ liveDelta: -2, projectedTotal: 8, contributingGames: [game({ captainApplied: true, multiplier: 2, projectedPoints: -2 })] })] })), true);
  assert.equal(hasMeaningfulProjectionContext(projection({ context: { tiedGames: [{ gameId: "game", providerGameId: "provider", state: "tied", label: "TIED — unresolved" }], staleGames: [], notStartedGames: [], integrityWarnings: [] } })), true);
  assert.equal(hasMeaningfulProjectionContext(projection({ owners: [owner({ benchPotential: [game({ lineupStatus: "bench", counts: false, projectedPoints: 2 })] })] })), true);
  assert.equal(hasMeaningfulProjectionContext(projection({ owners: [owner({ finalPendingDelta: 1, projectedTotal: 11, contributingGames: [game({ state: "final_pending" })] })] })), true);
  assert.equal(hasMeaningfulProjectionContext(projection({ freshnessState: "stale", liveDataFetchedAt: "2026-10-03T17:40:00Z" })), true);
  assert.equal(hasMeaningfulProjectionContext(projection({ owners: [owner({ contributingGames: [game(), game({ gameId: "second" })] })] })), true);
});

test("presentation uses certified totals, ranks, tie-safe movement, and signed values", () => {
  const up = owner({ officialRank: 4, projectedRank: 2, rankMovement: 2, liveDelta: 8, projectedTotal: 18 });
  const down = owner({ officialRank: 1, projectedRank: 3, rankMovement: -2, liveDelta: -2, projectedTotal: 8 });
  const tied = owner({ officialRank: 3, projectedRank: 3, rankMovement: 0 });
  const sharedProjectedRank = [
    owner({ memberId: "one", officialRank: 2, projectedRank: 1, rankMovement: 1 }),
    owner({ memberId: "two", officialRank: 3, projectedRank: 1, rankMovement: 2 }),
  ];
  assert.equal(provisionalPoints(up), 8);
  assert.equal(projectedMovementLabel(up), "Moves up from #4 to #2 if scores hold");
  assert.equal(projectedMovementLabel(down), "Moves down from #1 to #3 if scores hold");
  assert.equal(projectedMovementLabel(tied), "Stays #3 if scores hold");
  assert.deepEqual(sharedProjectedRank.map((item) => item.projectedRank), [1, 1]);
  assert.deepEqual(sharedProjectedRank.map(projectedMovementLabel), [
    "Moves up from #2 to #1 if scores hold",
    "Moves up from #3 to #1 if scores hold",
  ]);
  assert.deepEqual([signedPoints(8), signedPoints(-2), signedPoints(0)], ["+8", "−2", "0"]);
});

test("freshness and game copy remain player-facing", () => {
  const fresh = projection({ freshnessState: "fresh", liveDataFetchedAt: "2026-10-03T17:58:30Z" });
  assert.equal(projectionFreshnessLabel(fresh, Date.parse("2026-10-03T18:00:00Z")), "Updated 1 min ago");
  assert.equal(projectionFreshnessLabel(projection(), Date.now()), "Live projection temporarily unavailable");
  assert.equal(projectedGameSummary(game()), "Team leads 21–14");
  assert.equal(projectedGameSummary(game({ state: "final_pending" })), "FINAL — scoring pending");
  assert.equal(projectedGameSummary(game({ score: { team: 10, opponent: 10 } })), "TIED — unresolved");
});

test("web consumer is localized, accessible, read-only, and avoids duplicate provider polling", () => {
  const component = readFileSync(new URL("../../src/components/league/StandingsLeaderboard.tsx", import.meta.url), "utf8");
  const hook = readFileSync(new URL("../../src/components/projection/useLiveProjection.ts", import.meta.url), "utf8");
  assert.equal(LIVE_PROJECTION_REFRESH_MS, 180_000);
  assert.match(hook, /fetch\(`\/api\/leagues\/\$\{leagueId\}\/live-projection`/);
  assert.match(hook, /credentials: "same-origin"/);
  assert.match(hook, /document\.visibilityState === "visible"/);
  assert.match(component, /Live projection is temporarily unavailable\. Official standings remain current\./);
  assert.match(component, /<details/);
  assert.match(component, /min-h-11/);
  assert.match(component, /CAPTAIN ×2/);
  assert.match(component, /Does not count/);
  assert.doesNotMatch(component + hook, /CFBD|service.role|SUPABASE_SERVICE|\.rpc\(|\.insert\(|\.update\(|\.delete\(/i);
  for (const forbidden of ["projection engine", "canonical state", "Scoring Current", "live delta", "provider freshness", "scoring fingerprint"]) assert.doesNotMatch(component, new RegExp(forbidden, "i"));
});

test("deterministic visual fixture covers long names, ties, Captain, bench, final pending, and stale treatment", () => {
  const fixture = readFileSync(new URL("../../src/app/dev/live-projection-preview/page.tsx", import.meta.url), "utf8");
  for (const expected of ["Extremely Long Pool Team", "captainApplied: true", "projectedPoints: -2", "benchPotential", "final_pending", "tiedGames", "staleGames", "contributingGames: [game("]) assert.ok(fixture.includes(expected), `fixture should include ${expected}`);
  assert.match(fixture, /process\.env\.NODE_ENV === "production"\) notFound\(\)/);
});
