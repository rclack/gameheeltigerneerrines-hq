import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { evaluateProjectedGameResult, LIVE_PROJECTABLE_RULE_CODES, type GameResultTeamInput, type ProjectableRule } from "../../src/lib/projection/game-result.ts";
import { buildLiveProjection, type BuildLiveProjectionInput } from "../../src/lib/projection/live-projection.ts";

const scoringSeed = readFileSync(new URL("../../supabase/migrations/20260816000001_season_scoring.sql", import.meta.url), "utf8");
const points = new Map<string, number>(LIVE_PROJECTABLE_RULE_CODES.map((code) => {
  const match = scoringSeed.match(new RegExp(`\\('${code}',[^\\n]+,\\s*(-?\\d+)\\),?`));
  assert.ok(match, `authoritative scoring seed must define ${code}`);
  return [code, Number(match[1])] as const;
}));
const rules: ProjectableRule[] = LIVE_PROJECTABLE_RULE_CODES.map((code) => ({ id: `rule-${code}`, code, displayName: code, points: points.get(code)! }));
const power = (teamId: string, pregameRank: number | null = null): GameResultTeamInput => ({ teamId, classification: "POWER", classificationResolved: true, pregameRank, rankingContextResolved: true });
const g5 = (teamId: string, pregameRank: number | null = null): GameResultTeamInput => ({ teamId, classification: "G5", classificationResolved: true, pregameRank, rankingContextResolved: true });

test("pure evaluator matches every cumulative official game-result combination", () => {
  const ordinary = evaluateProjectedGameResult({ homeScore: 20, awayScore: 10, home: power("home"), away: power("away"), rules });
  assert.deepEqual(ordinary.home.map((item) => item.code), ["WIN"]);
  assert.deepEqual(ordinary.away.map((item) => item.code), ["LOSS"]);

  for (const [rank, expected] of [
    [20, ["WIN", "WIN_OVER_RANKED"]],
    [12, ["WIN", "WIN_OVER_RANKED", "WIN_OVER_TOP_15"]],
    [4, ["WIN", "WIN_OVER_RANKED", "WIN_OVER_TOP_15", "WIN_OVER_TOP_5"]],
  ] as const) {
    const result = evaluateProjectedGameResult({ homeScore: 24, awayScore: 20, home: power("home"), away: power("away", rank), rules });
    assert.deepEqual(result.home.map((item) => item.code), expected);
  }

  const upset = evaluateProjectedGameResult({ homeScore: 31, awayScore: 28, home: g5("g5"), away: power("power", 5), rules });
  assert.deepEqual(upset.home.map((item) => item.code), ["WIN", "WIN_OVER_RANKED", "WIN_OVER_TOP_15", "WIN_OVER_TOP_5", "G5_WIN_OVER_P5"]);
  assert.deepEqual(upset.away.map((item) => item.code), ["LOSS", "P5_LOSS_TO_G5"]);
  assert.equal(upset.home.reduce((sum, item) => sum + item.points, 0), 12);
  assert.equal(upset.away.reduce((sum, item) => sum + item.points, 0), -6);
});

test("Independent and external opponents follow official scorer boundaries", () => {
  const independent = { ...power("independent"), classification: "INDEPENDENT" as const };
  const result = evaluateProjectedGameResult({ homeScore: 17, awayScore: 14, home: g5("g5"), away: independent, rules });
  assert.deepEqual(result.home.map((item) => item.code), ["WIN"]);
  assert.deepEqual(result.away.map((item) => item.code), ["LOSS"]);
  const external = evaluateProjectedGameResult({ homeScore: 35, awayScore: 7, home: power("home"), away: { ...g5("external"), teamId: null }, rules });
  assert.deepEqual(external.home.map((item) => item.code), ["WIN"]);
  assert.deepEqual(external.away, []);
});

test("Captain doubles positive and negative components exactly once", () => {
  const result = evaluateProjectedGameResult({ homeScore: 7, awayScore: 14, home: power("power"), away: g5("g5"), rules, multiplier: 2 });
  assert.deepEqual(result.home.map((item) => [item.basePoints, item.multiplier, item.points]), [[-1, 2, -2], [-5, 2, -10]]);
  assert.deepEqual(result.away.map((item) => [item.basePoints, item.multiplier, item.points]), [[1, 2, 2], [5, 2, 10]]);
});

test("missing ranking and conference authority withholds only affected bonuses", () => {
  const result = evaluateProjectedGameResult({ homeScore: 21, awayScore: 20,
    home: { ...g5("home"), classificationResolved: false }, away: { ...power("away"), rankingContextResolved: false }, rules });
  assert.deepEqual(result.home.map((item) => item.code), ["WIN"]);
  assert.deepEqual(result.away.map((item) => item.code), ["LOSS"]);
  assert.equal(result.warnings.length, 2);
});

function fixture(overrides: Partial<BuildLiveProjectionInput> = {}): BuildLiveProjectionInput {
  return {
    leagueId: "00000000-0000-4000-8000-000000000001", season: "2026", nowMs: Date.parse("2026-08-29T17:30:00Z"),
    members: [{ id: "randy", displayName: "Randy" }, { id: "alex", displayName: "Alex" }],
    picks: [{ memberId: "randy", teamId: "tcu" }, { memberId: "alex", teamId: "usc" }],
    officialEvents: [],
    teams: [
      { id: "tcu", name: "TCU", conference: "Big 12", classification: "POWER", classificationResolved: true },
      { id: "unc", name: "North Carolina", conference: "ACC", classification: "POWER", classificationResolved: true },
      { id: "usc", name: "USC", conference: "Big Ten", classification: "POWER", classificationResolved: true },
    ],
    games: [{ id: "game", season: "2026", week: 0, externalProvider: "cfbd", externalId: "401856766", status: "scheduled", scoringFingerprint: null,
      homeTeamId: "tcu", awayTeamId: "unc", homeExternalOpponentId: null, awayExternalOpponentId: null, homeScore: null, awayScore: null }],
    liveGames: [{ provider: "cfbd", providerGameId: "401856766", status: "in_progress", homeScore: 10, awayScore: 12, fetchedAt: "2026-08-29T17:28:00Z" }],
    rankings: [
      { gameId: "game", teamId: "tcu", rank: null, capturedAt: "2026-08-28T12:00:00Z" },
      { gameId: "game", teamId: "unc", rank: null, capturedAt: "2026-08-28T12:00:00Z" },
    ],
    lineups: [{ id: "lineup-randy", memberId: "randy", week: 0, season: "2026" }, { id: "lineup-alex", memberId: "alex", week: 0, season: "2026" }],
    entries: [{ id: "entry-tcu", lineupId: "lineup-randy", teamId: "tcu", gameId: "game", status: "starter", isCaptain: false }],
    externalOpponents: [], rules,
    ...overrides,
  };
}

test("historical TCU–UNC transitions are reversible and GHTNR-style no-ownership is unaffected", () => {
  const tied = buildLiveProjection(fixture({ liveGames: [{ provider: "cfbd", providerGameId: "401856766", status: "in_progress", homeScore: 10, awayScore: 10, fetchedAt: "2026-08-29T17:24:00Z" }] }));
  assert.equal(tied.owners.find((owner) => owner.memberId === "randy")?.liveDelta, 0);
  assert.equal(tied.context.tiedGames.length, 1);
  const trailing = buildLiveProjection(fixture());
  assert.equal(trailing.owners.find((owner) => owner.memberId === "randy")?.liveDelta, -1);
  assert.equal(trailing.chaos?.version, 1);
  assert.ok(trailing.chaos?.candidates.some((event) => event.type === "MAJOR_SCORING_SWING" && event.memberId === "randy"));

  const pending = buildLiveProjection(fixture({
    games: [{ ...fixture().games[0]!, status: "final", homeScore: 10, awayScore: 15 }], liveGames: [], nowMs: Date.parse("2026-08-29T19:36:00Z"),
  }));
  assert.equal(pending.owners.find((owner) => owner.memberId === "randy")?.finalPendingDelta, -1);
  const official = buildLiveProjection(fixture({
    games: [{ ...fixture().games[0]!, status: "final", scoringFingerprint: "current", homeScore: 10, awayScore: 15 }], liveGames: [],
    officialEvents: [{ memberId: "randy", teamId: "tcu", points: -1, createdAt: "2026-08-29T20:00:00Z" }],
  }));
  const randy = official.owners.find((owner) => owner.memberId === "randy")!;
  assert.deepEqual([randy.officialPoints, randy.liveDelta, randy.finalPendingDelta, randy.projectedTotal], [-1, 0, 0, -1]);
  assert.equal(official.chaos?.candidates.length, 0);

  const unrelated = buildLiveProjection(fixture({ picks: [{ memberId: "alex", teamId: "usc" }], entries: [] }));
  assert.ok(unrelated.owners.every((owner) => owner.liveDelta === 0));
});

test("bench, Captain, missing and no-game lineup authority remain deterministic", () => {
  const bench = buildLiveProjection(fixture({ entries: [{ ...fixture().entries[0]!, status: "bench" }] }));
  const benchOwner = bench.owners.find((owner) => owner.memberId === "randy")!;
  assert.equal(benchOwner.liveDelta, 0);
  assert.equal(benchOwner.benchPotential[0]?.projectedPoints, -1);
  const captain = buildLiveProjection(fixture({ entries: [{ ...fixture().entries[0]!, isCaptain: true }] }));
  assert.equal(captain.owners.find((owner) => owner.memberId === "randy")?.liveDelta, -2);
  const noGame = buildLiveProjection(fixture({ entries: [{ ...fixture().entries[0]!, status: "no_game" }] }));
  assert.equal(noGame.owners.find((owner) => owner.memberId === "randy")?.liveDelta, 0);
  assert.match(noGame.context.integrityWarnings.join(" "), /no_game/);
  const missing = buildLiveProjection(fixture({ entries: [] }));
  assert.equal(missing.owners.find((owner) => owner.memberId === "randy")?.liveDelta, 0);
  assert.match(missing.context.integrityWarnings.join(" "), /missing or ambiguous/);
});

test("stale, malformed, scheduled and final-current states contribute zero", () => {
  const stale = buildLiveProjection(fixture({ nowMs: Date.parse("2026-08-29T18:00:00Z") }));
  assert.equal(stale.owners.find((owner) => owner.memberId === "randy")?.liveDelta, 0);
  assert.equal(stale.context.staleGames[0]?.state, "stale");
  const malformed = buildLiveProjection(fixture({ liveGames: [{ ...fixture().liveGames[0]!, homeScore: null }] }));
  assert.equal(malformed.context.staleGames[0]?.state, "malformed");
  const scheduled = buildLiveProjection(fixture({ liveGames: [{ ...fixture().liveGames[0]!, status: "scheduled", homeScore: 0, awayScore: 0 }] }));
  assert.equal(scheduled.context.notStartedGames.length, 1);
  const delayed = buildLiveProjection(fixture({ games: [{ ...fixture().games[0]!, status: "postponed" }], liveGames: [] }));
  assert.equal(delayed.context.notStartedGames[0]?.state, "delayed");
  assert.ok(delayed.owners.every((owner) => owner.liveDelta === 0));
  const current = buildLiveProjection(fixture({ games: [{ ...fixture().games[0]!, status: "final", scoringFingerprint: "current", homeScore: 10, awayScore: 15 }] }));
  assert.ok(current.owners.every((owner) => owner.liveDelta === 0 && owner.finalPendingDelta === 0));
});

test("official and projected competition ranks preserve ties independently of display ordering", () => {
  const result = buildLiveProjection(fixture({
    officialEvents: [{ memberId: "randy", teamId: "tcu", points: 1, createdAt: "2026-08-01T00:00:00Z" }, { memberId: "alex", teamId: "usc", points: 0, createdAt: "2026-08-01T00:00:00Z" }],
    liveGames: [{ ...fixture().liveGames[0]!, homeScore: 14, awayScore: 10 }],
  }));
  const randy = result.owners.find((owner) => owner.memberId === "randy")!;
  assert.equal(randy.officialRank, 1);
  assert.equal(randy.projectedRank, 1);
  assert.equal(randy.projectedTotal, 2);
});

test("maintainability guardrail binds the evaluator set to the official scorer and active rule seed", () => {
  const scorer = readFileSync(new URL("../../supabase/migrations/20260816000004_external_opponents.sql", import.meta.url), "utf8");
  for (const code of LIVE_PROJECTABLE_RULE_CODES) {
    assert.match(scoringSeed, new RegExp(`'${code}'`));
    assert.match(scorer, new RegExp(`'${code}'`));
  }
  assert.deepEqual([...points.keys()], [...LIVE_PROJECTABLE_RULE_CODES]);
});

test("authenticated route is one-league, no-store, RLS-only, and contains no mutation/provider paths", () => {
  const route = readFileSync(new URL("../../src/app/api/leagues/[leagueId]/live-projection/route.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("../../src/services/liveProjectionService.ts", import.meta.url), "utf8");
  assert.match(route, /auth\.getUser\(\)/);
  assert.match(route, /from\("league_members"\)/);
  assert.match(route, /private, no-store/);
  assert.match(route, /status: 401/);
  assert.match(route, /status: 400/);
  assert.doesNotMatch(`${route}\n${service}`, /service.role|SUPABASE_SERVICE|CFBD_API_KEY|fetchCfbd|\.rpc\(/i);
  assert.doesNotMatch(service, /\.(?:insert|update|delete|upsert)\(/);
  for (const forbidden of ["process_cfb_game_scoring", "weekly_captain_changes", "sunday_recap_deliveries"]) assert.doesNotMatch(service, new RegExp(forbidden));
  assert.doesNotMatch(service, /(?:insert|update|delete|upsert)[^\n]+scoring_fingerprint/i);
  assert.match(service, /const relevantGames = games\.filter/);
  assert.match(service, /chunks\(relevantGameIds\)/);
  assert.match(service, /chunks\(providerIds\)/);
  assert.match(service, /range\(from, from \+ 999\)/);
});
