import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildChaosObservation } from "../../src/lib/chaos/persistence.ts";
import { evaluateChaos } from "../../src/lib/chaos/evaluator.ts";
import type { LiveProjectionResult, ProjectedGameFact, ProjectionOwnerResult } from "../../src/lib/projection/live-projection.ts";

const migration = readFileSync(new URL("../../supabase/migrations/20261021013518_league_chaos_transition_persistence.sql", import.meta.url), "utf8");
const liveRoute = readFileSync(new URL("../../src/app/api/cron/cfbd-live/route.ts", import.meta.url), "utf8");
const syncRoute = readFileSync(new URL("../../src/app/api/cron/cfbd-sync/route.ts", import.meta.url), "utf8");
const readRoute = readFileSync(new URL("../../src/app/api/leagues/[leagueId]/chaos/route.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("../../src/services/chaosService.ts", import.meta.url), "utf8");

function game(overrides: Partial<ProjectedGameFact> = {}): ProjectedGameFact {
  return { gameId: "00000000-0000-4000-8000-000000000010", providerGameId: "provider", week: 0,
    teamId: "00000000-0000-4000-8000-000000000020", teamName: "TCU", opponentId: "00000000-0000-4000-8000-000000000030",
    opponentName: "North Carolina", opponentMemberId: null, teamPregameRank: null, opponentPregameRank: null,
    teamRankingContextResolved: true, opponentRankingContextResolved: true, teamClassification: "POWER", opponentClassification: "POWER",
    state: "live", score: { team: 14, opponent: 10 }, lineupEntryId: "entry", lineupStatus: "starter", counts: true,
    captainApplied: false, multiplier: 1, baseProjectedPoints: 1, projectedPoints: 1,
    components: [{ ruleId: "win", code: "WIN", displayName: "Win", basePoints: 1, multiplier: 1, points: 1 }], period: 3,
    sourceFreshness: "fresh", sourceFetchedAt: "2026-08-29T18:00:00Z", canonicalStateFingerprint: "canonical-a", ...overrides };
}

function owner(fact?: ProjectedGameFact): ProjectionOwnerResult {
  return { memberId: "00000000-0000-4000-8000-000000000040", displayName: "Randy", officialPoints: 0,
    liveDelta: fact?.projectedPoints ?? 0, finalPendingDelta: 0, projectedTotal: fact?.projectedPoints ?? 0,
    officialRank: 2, projectedRank: fact ? 1 : 2, rankMovement: fact ? 1 : 0,
    contributingGames: fact ? [fact] : [], benchPotential: [] };
}

function projection(fact?: ProjectedGameFact, context: LiveProjectionResult["context"] = { tiedGames: [], staleGames: [], notStartedGames: [], integrityWarnings: [] }): LiveProjectionResult {
  const result: LiveProjectionResult = { leagueId: "00000000-0000-4000-8000-000000000001", season: "2026", competitionWeek: 0,
    generatedAt: "2026-08-29T18:00:00Z", liveDataFetchedAt: fact?.sourceFetchedAt ?? "2026-08-29T18:00:00Z",
    freshnessState: "fresh", officialAsOf: null, owners: [owner(fact)], context };
  result.chaos = evaluateChaos(result);
  return result;
}

test("observation identity follows authoritative observations while evaluator episode keys remain stable", () => {
  const first = projection(game());
  const changedProvider = projection(game({ score: { team: 21, opponent: 10 }, canonicalStateFingerprint: "canonical-b" }));
  const firstCandidate = first.chaos!.candidates.find((candidate) => candidate.type === "MAJOR_SCORING_SWING")!;
  const secondCandidate = changedProvider.chaos!.candidates.find((candidate) => candidate.type === "MAJOR_SCORING_SWING")!;
  assert.equal(firstCandidate.eventKey, secondCandidate.eventKey);
  assert.equal(firstCandidate.stateFingerprint, secondCandidate.stateFingerprint);
  assert.notEqual(buildChaosObservation(first, []).observationKey, buildChaosObservation(changedProvider, []).observationKey);
});

test("recurring tied observations remain distinguishable so each active episode can resolve", () => {
  const tied = (fingerprint: string) => projection(undefined, { tiedGames: [{ gameId: game().gameId, providerGameId: "provider", state: "tied", label: "TIED", sourceFingerprint: fingerprint }], staleGames: [], notStartedGames: [], integrityWarnings: [] });
  assert.notEqual(buildChaosObservation(tied("tie-one"), []).observationKey, buildChaosObservation(tied("tie-two"), []).observationKey);
});

test("official settlement is part of observation identity without changing evaluator authority", () => {
  const live = projection(game());
  const unsettled = buildChaosObservation(live, []);
  const settled = buildChaosObservation(live, [{ id: game().gameId, scoring_fingerprint: "official-fingerprint" }]);
  assert.notEqual(unsettled.observationKey, settled.observationKey);
  assert.deepEqual(settled.settledGameIds, [game().gameId]);
});

test("migration enforces serialized idempotent episodes, append-only history, and league-scoped reads", () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /unique \(league_id, observation_key\)/);
  assert.match(migration, /unique \(event_key, episode_id, sequence\)/);
  assert.match(migration, /transition_identity text not null unique/);
  assert.match(migration, /if v_event\.event_key is null or v_event\.lifecycle_state = 'resolved'/);
  assert.match(migration, /gen_random_uuid\(\)/);
  assert.match(migration, /'suspended','resumed','resolved'/);
  assert.match(migration, /'OFFICIAL_SETTLED'/);
  assert.match(migration, /private\.is_league_member\(league_id\)/);
  assert.match(migration, /grant select on public\.league_chaos_events, public\.league_chaos_transitions to authenticated/);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete)[^;]+to authenticated/i);
  assert.match(migration, /revoke all on function public\.reconcile_league_chaos[^;]+from public, anon, authenticated/);
});

test("trusted schedulers reconcile independently without provider calls or gameplay mutation", () => {
  assert.match(liveRoute, /reconcileEnabledChaosLeagues/);
  assert.match(liveRoute, /run \? "live_poll" : "freshness"/);
  assert.match(syncRoute, /reconcileEnabledChaosLeagues\(supabase, leagueIds, "schedule_sync", true\)/);
  assert.doesNotMatch(service, /fetchCfbd|process_cfb_game_scoring|insert\([^)]*scoring_events/i);
});

test("read contract is authenticated, membership scoped, paginated, and no-store", () => {
  assert.match(readRoute, /supabase\.auth\.getUser\(\)/);
  assert.match(readRoute, /from\("league_members"\)/);
  assert.match(readRoute, /Cache-Control": "private, no-store"/);
  assert.match(service, /from\("league_chaos_transitions"\)/);
  assert.match(service, /\.eq\("league_id", leagueId\)/);
  assert.match(service, /nextCursor/);
});
