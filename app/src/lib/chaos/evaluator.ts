import { createHash } from "node:crypto";

import type { LiveProjectionResult, ProjectedGameFact, ProjectionOwnerResult } from "../projection/live-projection.ts";
import type { ChaosCandidate, ChaosEvaluationResult, ChaosEventType, ChaosReasonCode, ChaosSeverity } from "./types.ts";

const SEVERITY_ORDER: Record<ChaosSeverity, number> = { info: 0, notable: 1, major: 2, chaos: 3 };
const PRESENTATION_PRIORITY: Record<ChaosEventType, number> = {
  CAPTAIN_POSITIVE: 400,
  CAPTAIN_NEGATIVE: 400,
  G5_POWER_SWING: 350,
  PROJECTED_LEAD_CHANGE: 300,
  BENCH_POSITIVE: 260,
  UPSET_DANGER: 240,
  PROJECTED_RANK_MOVE: 200,
  MAJOR_SCORING_SWING: 100,
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function deterministicId(prefix: string, value: unknown) {
  return `${prefix}_${digest(value).slice(0, 32)}`;
}

function captainPositiveSeverity(points: number): ChaosSeverity {
  if (points >= 12) return "chaos";
  if (points >= 8) return "major";
  return "notable";
}

function captainNegativeSeverity(points: number): ChaosSeverity {
  return points <= -12 ? "chaos" : "notable";
}

function magnitudeSeverity(points: number): ChaosSeverity {
  const magnitude = Math.abs(points);
  if (magnitude >= 9) return "chaos";
  if (magnitude >= 5) return "major";
  if (magnitude >= 2) return "notable";
  return "info";
}

function benchSeverity(points: number): ChaosSeverity {
  if (points >= 9) return "chaos";
  if (points >= 5) return "major";
  if (points >= 2) return "notable";
  return "info";
}

function rankSeverity(fraction: number): ChaosSeverity {
  if (fraction >= 0.5) return "major";
  if (fraction >= 0.25) return "notable";
  return "info";
}

function increaseSeverity(severity: ChaosSeverity) {
  return (Object.entries(SEVERITY_ORDER).find(([, value]) => value === Math.min(3, SEVERITY_ORDER[severity] + 1))?.[0] ?? severity) as ChaosSeverity;
}

function groupKey(projection: LiveProjectionResult, owner: ProjectionOwnerResult, game: ProjectedGameFact | null) {
  return ["chaos-group-v1", projection.leagueId, game?.gameId ?? "standings", owner.memberId, game?.teamId ?? "member"].join(":");
}

function candidate(input: {
  projection: LiveProjectionResult;
  owner: ProjectionOwnerResult;
  game?: ProjectedGameFact;
  type: ChaosEventType;
  severity: ChaosSeverity;
  reasonCodes: ChaosReasonCode[];
  magnitude?: number | null;
  rankFraction?: number | null;
  lateGameBoostApplied?: boolean;
  direction?: string;
  suppressedByType?: ChaosEventType | null;
}): ChaosCandidate {
  const { projection, owner, game = null, type, severity } = input;
  const reasons = [...new Set(input.reasonCodes)].sort() as ChaosReasonCode[];
  const identity = {
    version: 1,
    leagueId: projection.leagueId,
    type,
    gameId: game?.gameId ?? null,
    memberId: owner.memberId,
    teamId: game?.teamId ?? null,
    direction: input.direction ?? null,
  };
  const eventKey = deterministicId("chaos_key", identity);
  const material = {
    type,
    severity,
    reasonCodes: reasons,
    magnitude: input.magnitude ?? null,
    projectedRank: owner.projectedRank,
    rankMovement: owner.rankMovement,
    gameProjectedPoints: game?.projectedPoints ?? null,
    gameState: game?.state ?? null,
    active: true,
  };
  const stateFingerprint = digest(material);
  const activationMaterial = {
    type,
    severity,
    reasonCodes: reasons,
    magnitude: input.magnitude ?? null,
    projectedRank: owner.projectedRank,
    rankMovement: owner.rankMovement,
    gameProjectedPoints: game?.projectedPoints ?? null,
  };
  return {
    version: 1,
    eventId: deterministicId("chaos_candidate", { eventKey, activationMaterial }),
    eventKey,
    stateFingerprint,
    leagueId: projection.leagueId,
    season: projection.season,
    week: game?.week ?? projection.competitionWeek,
    type,
    severity,
    state: "active",
    transition: "candidate",
    observedAt: projection.generatedAt,
    gameId: game?.gameId ?? null,
    providerGameId: game?.providerGameId ?? null,
    teamId: game?.teamId ?? null,
    memberId: owner.memberId,
    opponentTeamId: game?.opponentId ?? null,
    opponentMemberId: game?.opponentMemberId ?? null,
    facts: {
      gameState: game?.state ?? null,
      period: game?.period ?? null,
      score: game?.score ?? null,
      lineupStatus: game?.lineupStatus ?? null,
      captain: game?.captainApplied ?? false,
      counts: game?.counts ?? null,
      officialRankBefore: owner.officialRank,
      projectedRank: owner.projectedRank,
      rankMovement: owner.rankMovement,
      officialPoints: owner.officialPoints,
      projectedTotal: owner.projectedTotal,
      projectedDelta: owner.liveDelta + owner.finalPendingDelta,
      gameProjectedPoints: game?.projectedPoints ?? null,
      baseProjectedPoints: game?.baseProjectedPoints ?? null,
      ruleComponents: game?.components ?? [],
      teamPregameRank: game?.teamPregameRank ?? null,
      opponentPregameRank: game?.opponentPregameRank ?? null,
      teamClassification: game?.teamClassification ?? null,
      opponentClassification: game?.opponentClassification ?? null,
      headToHead: Boolean(game?.opponentMemberId),
    },
    significance: {
      reasonCodes: reasons,
      magnitude: input.magnitude ?? null,
      rankFraction: input.rankFraction ?? null,
      lateGameBoostApplied: input.lateGameBoostApplied ?? false,
    },
    presentation: {
      groupKey: groupKey(projection, owner, game),
      priority: PRESENTATION_PRIORITY[type],
      suppressedByType: input.suppressedByType ?? null,
    },
    source: {
      freshness: "fresh",
      projectionGeneratedAt: projection.generatedAt,
      liveFetchedAt: game?.sourceFetchedAt ?? projection.liveDataFetchedAt,
      canonicalStateFingerprint: game?.canonicalStateFingerprint ?? null,
    },
  };
}

function evaluateGame(projection: LiveProjectionResult, owner: ProjectionOwnerResult, game: ProjectedGameFact) {
  if (game.sourceFreshness !== "fresh") return [];
  const result: ChaosCandidate[] = [];
  const captainType = game.counts && game.captainApplied && game.projectedPoints !== 0
    ? game.projectedPoints > 0 ? "CAPTAIN_POSITIVE" : "CAPTAIN_NEGATIVE"
    : null;
  const hasG5Win = game.components.some((component) => component.code === "G5_WIN_OVER_P5");
  const hasPowerLoss = game.components.some((component) => component.code === "P5_LOSS_TO_G5");
  const hasG5Swing = hasG5Win || hasPowerLoss;

  if (captainType) {
    result.push(candidate({
      projection, owner, game, type: captainType,
      severity: game.projectedPoints > 0 ? captainPositiveSeverity(game.projectedPoints) : captainNegativeSeverity(game.projectedPoints),
      reasonCodes: [game.projectedPoints > 0 ? "CAPTAIN_COUNTING_POSITIVE" : "CAPTAIN_COUNTING_NEGATIVE"],
      magnitude: game.projectedPoints,
      direction: game.projectedPoints > 0 ? "positive" : "negative",
    }));
  }

  if (game.lineupStatus === "bench" && game.projectedPoints > 0) {
    result.push(candidate({ projection, owner, game, type: "BENCH_POSITIVE", severity: benchSeverity(game.projectedPoints),
      reasonCodes: ["BENCH_POSITIVE_NON_COUNTING"], magnitude: game.projectedPoints, direction: "positive" }));
  }

  if (hasG5Swing) {
    const primaryCaptain = captainType ?? null;
    result.push(candidate({ projection, owner, game, type: "G5_POWER_SWING",
      severity: game.captainApplied || Math.abs(game.projectedPoints) >= 9 ? "chaos" : "major",
      reasonCodes: [hasG5Win ? "G5_WIN_OVER_POWER" : "POWER_LOSS_TO_G5"], magnitude: game.projectedPoints,
      direction: hasG5Win ? "positive" : "negative", suppressedByType: primaryCaptain }));
  }

  const upsetEligible = game.state === "live" && game.teamPregameRank !== null
    && game.teamRankingContextResolved && game.opponentRankingContextResolved
    && game.score.team < game.score.opponent
    && (game.opponentPregameRank === null || game.opponentPregameRank > game.teamPregameRank);
  if (upsetEligible) {
    const decisive = game.period !== null && Number.isInteger(game.period) && game.period >= 4;
    let severity: ChaosSeverity = game.lineupStatus === "bench" ? "info" : game.captainApplied ? "major" : "notable";
    if (decisive) severity = increaseSeverity(severity);
    result.push(candidate({ projection, owner, game, type: "UPSET_DANGER", severity,
      reasonCodes: [game.opponentPregameRank === null ? "RANKED_TEAM_TRAILING_UNRANKED" : "RANKED_TEAM_TRAILING_LOWER_RANKED", ...(decisive ? ["DECISIVE_PERIOD" as const] : [])],
      magnitude: game.projectedPoints, lateGameBoostApplied: decisive, direction: "trailing" }));
  }

  if (game.counts && game.projectedPoints !== 0) {
    result.push(candidate({ projection, owner, game, type: "MAJOR_SCORING_SWING", severity: magnitudeSeverity(game.projectedPoints),
      reasonCodes: ["SCORING_SWING"], magnitude: game.projectedPoints,
      direction: game.projectedPoints > 0 ? "positive" : "negative",
      suppressedByType: captainType ?? (hasG5Swing ? "G5_POWER_SWING" : null) }));
  }
  return result;
}

function evaluateLeadChanges(projection: LiveProjectionResult) {
  const officialFirst = new Set(projection.owners.filter((owner) => owner.officialRank === 1).map((owner) => owner.memberId));
  const projectedFirst = new Set(projection.owners.filter((owner) => owner.projectedRank === 1).map((owner) => owner.memberId));
  const result: ChaosCandidate[] = [];
  for (const owner of projection.owners) {
    const official = officialFirst.has(owner.memberId);
    const projected = projectedFirst.has(owner.memberId);
    const reasons: ChaosReasonCode[] = [];
    let severity: ChaosSeverity = "notable";
    if (!official && projected) {
      reasons.push("ENTERS_FIRST");
      if (projectedFirst.size === 1) { reasons.push("SOLE_LEAD_EMERGES"); severity = "major"; }
      else reasons.push("ENTERS_FIRST_PLACE_TIE");
    } else if (official && !projected) {
      reasons.push("LEAVES_FIRST");
      if (officialFirst.size === 1) severity = "major";
      else reasons.push("LEAVES_FIRST_PLACE_TIE");
    } else if (official && projected && officialFirst.size > 1 && projectedFirst.size === 1) {
      reasons.push("SOLE_LEAD_EMERGES"); severity = "major";
    } else if (official && projected && officialFirst.size === 1 && projectedFirst.size > 1) {
      reasons.push("ENTERS_FIRST_PLACE_TIE");
    }
    if (reasons.length) result.push(candidate({ projection, owner, type: "PROJECTED_LEAD_CHANGE", severity, reasonCodes: reasons,
      direction: reasons.join("+") }));
  }
  return result;
}

function evaluateRankMoves(projection: LiveProjectionResult) {
  const denominator = Math.max(1, projection.owners.length - 1);
  return projection.owners.flatMap((owner) => {
    if (owner.rankMovement === 0) return [];
    const fraction = Math.abs(owner.rankMovement) / denominator;
    return [candidate({ projection, owner, type: "PROJECTED_RANK_MOVE", severity: rankSeverity(fraction),
      reasonCodes: [owner.rankMovement > 0 ? "RANK_UP" : "RANK_DOWN"], magnitude: owner.rankMovement,
      rankFraction: fraction, direction: owner.rankMovement > 0 ? "up" : "down" })];
  });
}

export function evaluateChaos(projection: LiveProjectionResult): ChaosEvaluationResult {
  const gameCandidates = projection.owners.flatMap((owner) => [
    ...owner.contributingGames.flatMap((game) => evaluateGame(projection, owner, game)),
    ...owner.benchPotential.flatMap((game) => evaluateGame(projection, owner, game)),
  ]);
  const hasFreshMaterialFacts = projection.owners.some((owner) => [...owner.contributingGames, ...owner.benchPotential]
    .some((game) => game.sourceFreshness === "fresh"));
  const standingsCandidates = hasFreshMaterialFacts
    ? [...evaluateLeadChanges(projection), ...evaluateRankMoves(projection)]
    : [];
  const candidates = [...gameCandidates, ...standingsCandidates]
    .sort((left, right) => SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity]
      || right.presentation.priority - left.presentation.priority
      || left.type.localeCompare(right.type)
      || left.eventKey.localeCompare(right.eventKey));
  return { version: 1, candidates };
}
