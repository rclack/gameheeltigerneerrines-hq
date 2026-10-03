import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { evaluateChaos } from "../../src/lib/chaos/evaluator.ts";
import type { ChaosCandidate, ChaosEventType, ChaosSeverity } from "../../src/lib/chaos/types.ts";
import type { LiveProjectionResult, ProjectedGameFact, ProjectionOwnerResult } from "../../src/lib/projection/live-projection.ts";
import type { LiveProjectableRuleCode, ProjectedRuleComponent } from "../../src/lib/projection/game-result.ts";

const component = (code: LiveProjectableRuleCode, points: number, multiplier: 1 | 2 = 1): ProjectedRuleComponent => ({
  ruleId: `rule-${code}`, code, displayName: code, basePoints: points / multiplier, multiplier, points,
});

function fact(overrides: Partial<ProjectedGameFact> = {}): ProjectedGameFact {
  return {
    gameId: "game", providerGameId: "provider", week: 3, teamId: "team", teamName: "Team", opponentId: "opponent", opponentName: "Opponent",
    opponentMemberId: null, teamPregameRank: null, opponentPregameRank: null, teamRankingContextResolved: true, opponentRankingContextResolved: true,
    teamClassification: "POWER", opponentClassification: "POWER", state: "live", score: { team: 21, opponent: 14 }, lineupEntryId: "entry",
    lineupStatus: "starter", counts: true, captainApplied: false, multiplier: 1, baseProjectedPoints: 1, projectedPoints: 1,
    components: [component("WIN", 1)], period: 2, sourceFreshness: "fresh", sourceFetchedAt: "2026-09-19T18:00:00Z",
    canonicalStateFingerprint: "canonical-a", ...overrides,
  };
}

function owner(id: string, overrides: Partial<ProjectionOwnerResult> = {}): ProjectionOwnerResult {
  return {
    memberId: id, displayName: id.toUpperCase(), officialPoints: 0, liveDelta: 0, finalPendingDelta: 0, projectedTotal: 0,
    officialRank: 1, projectedRank: 1, rankMovement: 0, contributingGames: [], benchPotential: [], ...overrides,
  };
}

function projection(owners: ProjectionOwnerResult[], overrides: Partial<LiveProjectionResult> = {}): LiveProjectionResult {
  return {
    leagueId: "00000000-0000-4000-8000-000000000001", season: "2026", competitionWeek: 3,
    generatedAt: "2026-09-19T18:00:00Z", liveDataFetchedAt: "2026-09-19T17:59:00Z", freshnessState: "fresh", officialAsOf: null,
    owners, context: { tiedGames: [], staleGames: [], notStartedGames: [], integrityWarnings: [] }, ...overrides,
  };
}

function candidates(result: LiveProjectionResult, type: ChaosEventType) {
  return evaluateChaos(result).candidates.filter((item) => item.type === type);
}

function gameOwner(points: number, overrides: Partial<ProjectedGameFact> = {}, ownerOverrides: Partial<ProjectionOwnerResult> = {}) {
  const game = fact({ projectedPoints: points, baseProjectedPoints: points, components: [component(points >= 0 ? "WIN" : "LOSS", points)], ...overrides });
  return owner("owner", { liveDelta: game.counts ? points : 0, projectedTotal: game.counts ? points : 0,
    contributingGames: game.counts ? [game] : [], benchPotential: game.counts ? [] : [game], ...ownerOverrides });
}

test("Captain positive and negative thresholds use certified projected values without remultiplying", () => {
  for (const [points, severity] of [[2, "notable"], [4, "notable"], [8, "major"], [12, "chaos"]] as Array<[number, ChaosSeverity]>) {
    const game = fact({ projectedPoints: points, baseProjectedPoints: points / 2, captainApplied: true, multiplier: 2,
      components: [component("WIN", points, 2)] });
    const event = candidates(projection([owner("owner", { liveDelta: points, projectedTotal: points, contributingGames: [game] })]), "CAPTAIN_POSITIVE")[0];
    assert.equal(event?.severity, severity);
    assert.equal(event?.significance.magnitude, points);
    assert.equal(event?.facts.ruleComponents[0]?.points, points);
  }
  for (const [points, severity] of [[-2, "notable"], [-12, "chaos"]] as Array<[number, ChaosSeverity]>) {
    const game = fact({ score: { team: 10, opponent: 14 }, projectedPoints: points, baseProjectedPoints: points / 2, captainApplied: true, multiplier: 2,
      components: [component("LOSS", points, 2)] });
    assert.equal(candidates(projection([owner("owner", { liveDelta: points, projectedTotal: points, contributingGames: [game] })]), "CAPTAIN_NEGATIVE")[0]?.severity, severity);
  }
});

test("Bench positive thresholds remain explicitly non-counting and negative bench outcomes emit nothing", () => {
  for (const [points, severity] of [[1, "info"], [2, "notable"], [4, "notable"], [5, "major"], [8, "major"], [9, "chaos"], [12, "chaos"]] as Array<[number, ChaosSeverity]>) {
    const game = fact({ lineupStatus: "bench", counts: false, projectedPoints: points, baseProjectedPoints: points });
    const event = candidates(projection([owner("owner", { benchPotential: [game] })]), "BENCH_POSITIVE")[0];
    assert.equal(event?.severity, severity);
    assert.equal(event?.facts.counts, false);
  }
  const negative = fact({ lineupStatus: "bench", counts: false, projectedPoints: -6, baseProjectedPoints: -6, score: { team: 7, opponent: 28 } });
  assert.equal(candidates(projection([owner("owner", { benchPotential: [negative] })]), "BENCH_POSITIVE").length, 0);
});

test("generic scoring thresholds include suppression metadata for more specific moments", () => {
  for (const [points, severity] of [[1, "info"], [2, "notable"], [4, "notable"], [5, "major"], [8, "major"], [9, "chaos"]] as Array<[number, ChaosSeverity]>) {
    assert.equal(candidates(projection([gameOwner(points)]), "MAJOR_SCORING_SWING")[0]?.severity, severity);
  }
  const captain = fact({ projectedPoints: 8, baseProjectedPoints: 4, captainApplied: true, multiplier: 2, components: [component("WIN_OVER_TOP_15", 8, 2)] });
  const captainEvents = evaluateChaos(projection([owner("owner", { liveDelta: 8, projectedTotal: 8, contributingGames: [captain] })])).candidates;
  assert.equal(captainEvents.find((item) => item.type === "MAJOR_SCORING_SWING")?.presentation.suppressedByType, "CAPTAIN_POSITIVE");
  assert.equal(captainEvents.find((item) => item.type === "CAPTAIN_POSITIVE")?.presentation.suppressedByType, null);
});

test("five-owner and eight-owner normalized rank thresholds preserve direction", () => {
  const fresh = fact();
  const five = [owner("a", { rankMovement: 1, officialRank: 3, projectedRank: 2, contributingGames: [fresh] }), owner("b"), owner("c"), owner("d"), owner("e")];
  assert.equal(candidates(projection(five), "PROJECTED_RANK_MOVE").find((event) => event.memberId === "a")?.severity, "notable");
  five[0] = owner("a", { rankMovement: -2, officialRank: 2, projectedRank: 4, contributingGames: [fresh] });
  const down = candidates(projection(five), "PROJECTED_RANK_MOVE").find((event) => event.memberId === "a");
  assert.equal(down?.severity, "major");
  assert.deepEqual(down?.significance.reasonCodes, ["RANK_DOWN"]);

  const eight = Array.from({ length: 8 }, (_, index) => owner(String(index)));
  eight[0] = owner("0", { rankMovement: 1, officialRank: 3, projectedRank: 2, contributingGames: [fresh] });
  assert.equal(candidates(projection(eight), "PROJECTED_RANK_MOVE").find((event) => event.memberId === "0")?.severity, "info");
  eight[0] = owner("0", { rankMovement: 2, officialRank: 4, projectedRank: 2, contributingGames: [fresh] });
  assert.equal(candidates(projection(eight), "PROJECTED_RANK_MOVE").find((event) => event.memberId === "0")?.severity, "notable");
  eight[0] = owner("0", { rankMovement: 4, officialRank: 5, projectedRank: 1, contributingGames: [fresh] });
  assert.equal(candidates(projection(eight), "PROJECTED_RANK_MOVE").find((event) => event.memberId === "0")?.severity, "major");
});

test("lead changes compare complete first-place sets, including shared and sole states", () => {
  const fresh = fact();
  const soleChange = projection([
    owner("a", { officialRank: 1, projectedRank: 2, rankMovement: -1, contributingGames: [fresh] }),
    owner("b", { officialRank: 2, projectedRank: 1, rankMovement: 1 }),
    owner("c", { officialRank: 3, projectedRank: 3 }),
  ]);
  const soleEvents = candidates(soleChange, "PROJECTED_LEAD_CHANGE");
  assert.deepEqual(soleEvents.find((event) => event.memberId === "b")?.significance.reasonCodes, ["ENTERS_FIRST", "SOLE_LEAD_EMERGES"]);
  assert.equal(soleEvents.find((event) => event.memberId === "a")?.severity, "major");

  const sharedToSole = projection([
    owner("a", { officialRank: 1, projectedRank: 1, contributingGames: [fresh] }),
    owner("b", { officialRank: 1, projectedRank: 2, rankMovement: -1 }),
    owner("c", { officialRank: 3, projectedRank: 3 }),
  ]);
  assert.deepEqual(candidates(sharedToSole, "PROJECTED_LEAD_CHANGE").find((event) => event.memberId === "a")?.significance.reasonCodes, ["SOLE_LEAD_EMERGES"]);
  assert.deepEqual(candidates(sharedToSole, "PROJECTED_LEAD_CHANGE").find((event) => event.memberId === "b")?.significance.reasonCodes, ["LEAVES_FIRST", "LEAVES_FIRST_PLACE_TIE"]);

  const soleToShared = projection([
    owner("a", { officialRank: 1, projectedRank: 1, contributingGames: [fresh] }),
    owner("b", { officialRank: 2, projectedRank: 1, rankMovement: 1 }),
  ]);
  assert.ok(candidates(soleToShared, "PROJECTED_LEAD_CHANGE").every((event) => event.significance.reasonCodes.includes("ENTERS_FIRST_PLACE_TIE")));
});

test("Upset Danger uses ranking authority and period only, with bench and invalid-period behavior", () => {
  for (const period of [1, 2, 3]) {
    const game = fact({ teamPregameRank: 5, opponentPregameRank: 12, score: { team: 10, opponent: 17 }, projectedPoints: -1, baseProjectedPoints: -1, period });
    assert.equal(candidates(projection([owner("owner", { liveDelta: -1, projectedTotal: -1, contributingGames: [game] })]), "UPSET_DANGER")[0]?.severity, "notable");
  }
  const decisive = fact({ teamPregameRank: 5, opponentPregameRank: null, score: { team: 10, opponent: 17 }, projectedPoints: -1, baseProjectedPoints: -1, period: 4 });
  const decisiveEvent = candidates(projection([owner("owner", { liveDelta: -1, projectedTotal: -1, contributingGames: [decisive] })]), "UPSET_DANGER")[0];
  assert.equal(decisiveEvent?.severity, "major");
  assert.equal(decisiveEvent?.significance.lateGameBoostApplied, true);
  assert.ok(decisiveEvent?.significance.reasonCodes.includes("RANKED_TEAM_TRAILING_UNRANKED"));

  const invalid = { ...decisive, period: null };
  assert.equal(candidates(projection([owner("owner", { liveDelta: -1, projectedTotal: -1, contributingGames: [invalid] })]), "UPSET_DANGER")[0]?.severity, "notable");
  const bench = { ...decisive, lineupStatus: "bench" as const, counts: false, captainApplied: false };
  assert.equal(candidates(projection([owner("owner", { benchPotential: [bench] })]), "UPSET_DANGER")[0]?.severity, "notable");
  const unresolved = { ...decisive, opponentRankingContextResolved: false };
  assert.equal(candidates(projection([owner("owner", { contributingGames: [unresolved] })]), "UPSET_DANGER").length, 0);
});

test("G5/Power derives only from certified components and Independent does not qualify", () => {
  const g5 = fact({ teamClassification: "G5", opponentClassification: "POWER", projectedPoints: 6, baseProjectedPoints: 6,
    components: [component("WIN", 1), component("G5_WIN_OVER_P5", 5)] });
  const major = candidates(projection([owner("owner", { liveDelta: 6, projectedTotal: 6, contributingGames: [g5] })]), "G5_POWER_SWING")[0];
  assert.equal(major?.severity, "major");
  assert.deepEqual(major?.significance.reasonCodes, ["G5_WIN_OVER_POWER"]);
  const captain = { ...g5, captainApplied: true, multiplier: 2 as const, projectedPoints: 12, components: [component("WIN", 2, 2), component("G5_WIN_OVER_P5", 10, 2)] };
  assert.equal(candidates(projection([owner("owner", { liveDelta: 12, projectedTotal: 12, contributingGames: [captain] })]), "G5_POWER_SWING")[0]?.severity, "chaos");
  const independent = { ...g5, opponentClassification: "INDEPENDENT" as const, projectedPoints: 1, components: [component("WIN", 1)] };
  assert.equal(candidates(projection([owner("owner", { liveDelta: 1, projectedTotal: 1, contributingGames: [independent] })]), "G5_POWER_SWING").length, 0);
});

test("head-to-head remains context and evaluates both owners independently", () => {
  const winner = fact({ teamId: "winner", opponentId: "loser", opponentMemberId: "loser-owner", projectedPoints: 1 });
  const loser = fact({ teamId: "loser", opponentId: "winner", opponentMemberId: "winner-owner", score: { team: 14, opponent: 21 }, projectedPoints: -1, baseProjectedPoints: -1, components: [component("LOSS", -1)] });
  const result = evaluateChaos(projection([
    owner("winner-owner", { liveDelta: 1, projectedTotal: 1, contributingGames: [winner] }),
    owner("loser-owner", { liveDelta: -1, projectedTotal: -1, officialRank: 1, projectedRank: 2, rankMovement: -1, contributingGames: [loser] }),
  ])).candidates;
  const scoring = result.filter((event) => event.type === "MAJOR_SCORING_SWING");
  assert.equal(scoring.length, 2);
  assert.ok(scoring.every((event) => event.facts.headToHead && event.opponentMemberId));
  assert.equal(result.some((event) => event.type.includes("HEAD")), false);
});

test("stale facts and unavailable projections emit no candidates", () => {
  const stale = fact({ sourceFreshness: "stale" });
  assert.equal(evaluateChaos(projection([owner("owner", { liveDelta: 1, projectedTotal: 1, officialRank: 2, projectedRank: 1, rankMovement: 1, contributingGames: [stale] })], { freshnessState: "stale" })).candidates.length, 0);
  assert.equal(evaluateChaos(projection([owner("owner")], { freshnessState: "unavailable", liveDataFetchedAt: null })).candidates.length, 0);
});

test("deterministic identities ignore request time, score churn, and canonical provenance but change with material significance", () => {
  const baseGame = fact({ projectedPoints: 8, baseProjectedPoints: 4, captainApplied: true, multiplier: 2, components: [component("WIN_OVER_TOP_15", 8, 2)] });
  const first = projection([owner("owner", { liveDelta: 8, projectedTotal: 8, contributingGames: [baseGame] })]);
  const repeat = projection([owner("owner", { liveDelta: 8, projectedTotal: 8, contributingGames: [{ ...baseGame, score: { team: 42, opponent: 14 }, canonicalStateFingerprint: "canonical-b" }] })], { generatedAt: "2026-09-19T18:03:00Z" });
  const left = candidates(first, "CAPTAIN_POSITIVE")[0]!;
  const right = candidates(repeat, "CAPTAIN_POSITIVE")[0]!;
  assert.deepEqual([left.eventKey, left.eventId, left.stateFingerprint], [right.eventKey, right.eventId, right.stateFingerprint]);
  assert.notEqual(left.source.canonicalStateFingerprint, right.source.canonicalStateFingerprint);

  const changed = projection([owner("owner", { liveDelta: 12, projectedTotal: 12, contributingGames: [{ ...baseGame, projectedPoints: 12, baseProjectedPoints: 6 }] })]);
  const changedEvent = candidates(changed, "CAPTAIN_POSITIVE")[0]!;
  assert.equal(left.eventKey, changedEvent.eventKey);
  assert.notEqual(left.eventId, changedEvent.eventId);
  assert.notEqual(left.stateFingerprint, changedEvent.stateFingerprint);
});

test("TCU–UNC replay preserves ties, lead/rank meaning, final-pending identity, and official disappearance", () => {
  const members = (randy: ProjectionOwnerResult) => [randy, owner("alex")];
  const tied = projection(members(owner("randy")), { context: { tiedGames: [{ gameId: "tcu-unc", providerGameId: "401856766", state: "tied", label: "TIED — unresolved" }], staleGames: [], notStartedGames: [], integrityWarnings: [] } });
  assert.equal(evaluateChaos(tied).candidates.length, 0);

  const trailingFact = fact({ gameId: "tcu-unc", providerGameId: "401856766", week: 0, teamId: "tcu", opponentId: "unc", score: { team: 0, opponent: 3 }, projectedPoints: -1, baseProjectedPoints: -1, components: [component("LOSS", -1)] });
  const trailing = projection(members(owner("randy", { liveDelta: -1, projectedTotal: -1, officialRank: 1, projectedRank: 2, rankMovement: -1, contributingGames: [trailingFact] })), { competitionWeek: 0 });
  assert.ok(candidates(trailing, "PROJECTED_RANK_MOVE").some((event) => event.memberId === "randy"));
  assert.ok(candidates(trailing, "PROJECTED_LEAD_CHANGE").some((event) => event.memberId === "randy" && event.significance.reasonCodes.includes("LEAVES_FIRST")));

  const leadingFact = { ...trailingFact, score: { team: 10, opponent: 3 }, projectedPoints: 1, baseProjectedPoints: 1, components: [component("WIN", 1)] };
  const leading = projection([owner("randy", { liveDelta: 1, projectedTotal: 1, officialRank: 1, projectedRank: 1, contributingGames: [leadingFact] }), owner("alex", { officialRank: 1, projectedRank: 2, rankMovement: -1 })], { competitionWeek: 0 });
  assert.ok(candidates(leading, "PROJECTED_LEAD_CHANGE").some((event) => event.memberId === "randy" && event.significance.reasonCodes.includes("SOLE_LEAD_EMERGES")));

  const secondTie = projection(members(owner("randy")), { competitionWeek: 0, context: { tiedGames: [{ gameId: "tcu-unc", providerGameId: "401856766", state: "tied", label: "TIED — unresolved" }], staleGames: [], notStartedGames: [], integrityWarnings: [] } });
  assert.equal(evaluateChaos(secondTie).candidates.length, 0);

  const secondTrailing = projection(members(owner("randy", { liveDelta: -1, projectedTotal: -1, officialRank: 1, projectedRank: 2, rankMovement: -1, contributingGames: [{ ...trailingFact, score: { team: 10, opponent: 12 }, canonicalStateFingerprint: "canonical-second-loss" }] })), { competitionWeek: 0 });
  const firstLoss = candidates(trailing, "MAJOR_SCORING_SWING")[0]!;
  const secondLoss = candidates(secondTrailing, "MAJOR_SCORING_SWING")[0]!;
  assert.equal(firstLoss.eventKey, secondLoss.eventKey);
  assert.equal(firstLoss.eventId, secondLoss.eventId);

  const pending = projection(members(owner("randy", { finalPendingDelta: -1, projectedTotal: -1, officialRank: 1, projectedRank: 2, rankMovement: -1, contributingGames: [{ ...trailingFact, state: "final_pending", score: { team: 10, opponent: 15 } }] })), { competitionWeek: 0 });
  assert.equal(candidates(secondTrailing, "MAJOR_SCORING_SWING")[0]?.eventKey, candidates(pending, "MAJOR_SCORING_SWING")[0]?.eventKey);
  assert.equal(candidates(secondTrailing, "MAJOR_SCORING_SWING")[0]?.eventId, candidates(pending, "MAJOR_SCORING_SWING")[0]?.eventId);

  const official = projection([owner("randy", { officialPoints: -1, projectedTotal: -1, officialRank: 2, projectedRank: 2 }), owner("alex", { officialRank: 1, projectedRank: 1 })], { competitionWeek: 0 });
  assert.equal(evaluateChaos(official).candidates.length, 0);
});

test("Ole Miss–LSU replay keeps Captain +8 identity stable until tie and through final-pending", () => {
  const oleMiss = fact({ gameId: "ole-miss-lsu", providerGameId: "401856688", teamId: "ole-miss", opponentId: "lsu", opponentMemberId: "lennon",
    teamPregameRank: 8, opponentPregameRank: 7, score: { team: 3, opponent: 0 }, captainApplied: true, multiplier: 2,
    baseProjectedPoints: 4, projectedPoints: 8, components: [component("WIN", 2, 2), component("WIN_OVER_RANKED", 2, 2), component("WIN_OVER_TOP_15", 4, 2)] });
  const live = projection([owner("alex", { liveDelta: 8, projectedTotal: 8, officialRank: 3, projectedRank: 1, rankMovement: 2, contributingGames: [oleMiss] }), owner("lennon", { officialRank: 1, projectedRank: 2, rankMovement: -1 })]);
  const captain = candidates(live, "CAPTAIN_POSITIVE")[0]!;
  assert.deepEqual([captain.severity, captain.significance.magnitude, captain.facts.headToHead], ["major", 8, true]);

  const continuing = projection([owner("alex", { liveDelta: 8, projectedTotal: 8, officialRank: 3, projectedRank: 1, rankMovement: 2,
    contributingGames: [{ ...oleMiss, score: { team: 24, opponent: 7 }, canonicalStateFingerprint: "later" }] }), owner("lennon", { officialRank: 1, projectedRank: 2, rankMovement: -1 })]);
  assert.deepEqual(
    [candidates(live, "CAPTAIN_POSITIVE")[0]?.eventKey, candidates(live, "CAPTAIN_POSITIVE")[0]?.eventId],
    [candidates(continuing, "CAPTAIN_POSITIVE")[0]?.eventKey, candidates(continuing, "CAPTAIN_POSITIVE")[0]?.eventId],
  );
  assert.equal(evaluateChaos(projection([owner("alex"), owner("lennon")])).candidates.length, 0);

  const retake = projection([owner("alex", { liveDelta: 8, projectedTotal: 8, officialRank: 3, projectedRank: 1, rankMovement: 2,
    contributingGames: [{ ...oleMiss, score: { team: 32, opponent: 24 }, canonicalStateFingerprint: "retake" }] }), owner("lennon", { officialRank: 1, projectedRank: 2, rankMovement: -1 })]);
  assert.equal(candidates(retake, "CAPTAIN_POSITIVE")[0]?.eventKey, captain.eventKey);
  const pending = projection([owner("alex", { finalPendingDelta: 8, projectedTotal: 8, officialRank: 3, projectedRank: 1, rankMovement: 2,
    contributingGames: [{ ...oleMiss, state: "final_pending", score: { team: 32, opponent: 24 } }] }), owner("lennon", { officialRank: 1, projectedRank: 2, rankMovement: -1 })]);
  assert.equal(candidates(pending, "CAPTAIN_POSITIVE")[0]?.eventId, captain.eventId);
  assert.equal(evaluateChaos(projection([owner("alex", { officialPoints: 8, projectedTotal: 8 }), owner("lennon", { officialPoints: -1, projectedTotal: -1 })])).candidates.length, 0);
});

test("one canonical game can be undrafted, bench, starter, or Captain without cross-league identity reuse", () => {
  const canonical = fact({ gameId: "shared", providerGameId: "provider-shared", projectedPoints: 2, baseProjectedPoints: 1, components: [component("WIN", 2, 2)] });
  const undrafted = projection([owner("a")], { leagueId: "00000000-0000-4000-8000-00000000000a" });
  const bench = projection([owner("a", { benchPotential: [{ ...canonical, lineupStatus: "bench", counts: false, captainApplied: false, multiplier: 1, projectedPoints: 1 }] })], { leagueId: "00000000-0000-4000-8000-00000000000b" });
  const starter = projection([owner("a", { liveDelta: 1, projectedTotal: 1, contributingGames: [{ ...canonical, captainApplied: false, multiplier: 1, projectedPoints: 1 }] })], { leagueId: "00000000-0000-4000-8000-00000000000c" });
  const captainProjection = projection([owner("a", { liveDelta: 2, projectedTotal: 2, contributingGames: [{ ...canonical, captainApplied: true, multiplier: 2 }] })], { leagueId: "00000000-0000-4000-8000-00000000000d" });
  assert.equal(evaluateChaos(undrafted).candidates.length, 0);
  assert.equal(candidates(bench, "BENCH_POSITIVE").length, 1);
  assert.equal(candidates(starter, "MAJOR_SCORING_SWING").length, 1);
  assert.equal(candidates(captainProjection, "CAPTAIN_POSITIVE").length, 1);
  const keys = [candidates(bench, "BENCH_POSITIVE")[0]?.eventKey, candidates(starter, "MAJOR_SCORING_SWING")[0]?.eventKey, candidates(captainProjection, "CAPTAIN_POSITIVE")[0]?.eventKey];
  assert.equal(new Set(keys).size, 3);
});

test("evaluator is linear, read-only, provider-free, and exposes no contact or credential fields", () => {
  const manyFacts = Array.from({ length: 2_000 }, (_, index) => fact({ gameId: `game-${index}`, teamId: `team-${index}`, providerGameId: `provider-${index}` }));
  const large = projection([owner("owner", { liveDelta: 2_000, projectedTotal: 2_000, contributingGames: manyFacts })]);
  const started = performance.now();
  const result = evaluateChaos(large);
  const elapsed = performance.now() - started;
  assert.equal(result.candidates.filter((event) => event.type === "MAJOR_SCORING_SWING").length, 2_000);
  assert.ok(elapsed < 2_000, `focused evaluation took ${elapsed.toFixed(1)}ms`);

  const evaluator = readFileSync(new URL("../../src/lib/chaos/evaluator.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("../../src/services/liveProjectionService.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../../src/app/api/leagues/[leagueId]/live-projection/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(evaluator, /fetch\(|supabase|CFBD|email|device|credential|\.insert\(|\.delete\(|\.upsert\(/i);
  assert.doesNotMatch(service, /fetchCfbd|CFBD_API_KEY|service.role|SUPABASE_SERVICE|\.(?:insert|update|delete|upsert)\(/i);
  assert.match(route, /auth\.getUser\(\)/);
  assert.match(route, /from\("league_members"\)/);
  assert.doesNotMatch(`${evaluator}\n${service}\n${route}`, /process_cfb_game_scoring|sunday_recap_deliveries|weekly_captain_changes/i);
  assert.ok(result.candidates.every((event: ChaosCandidate) => !("email" in event) && !("device" in event)));
});
