import type { ProjectedRuleComponent, TeamClassification } from "../projection/game-result.ts";
import type { ProjectionGameState, ProjectionLineupStatus } from "../projection/live-projection.ts";

export const CHAOS_EVENT_TYPES = [
  "CAPTAIN_POSITIVE",
  "CAPTAIN_NEGATIVE",
  "BENCH_POSITIVE",
  "PROJECTED_LEAD_CHANGE",
  "PROJECTED_RANK_MOVE",
  "UPSET_DANGER",
  "G5_POWER_SWING",
  "MAJOR_SCORING_SWING",
] as const;

export type ChaosEventType = typeof CHAOS_EVENT_TYPES[number];
export type ChaosSeverity = "info" | "notable" | "major" | "chaos";
export type ChaosReasonCode =
  | "CAPTAIN_COUNTING_POSITIVE"
  | "CAPTAIN_COUNTING_NEGATIVE"
  | "BENCH_POSITIVE_NON_COUNTING"
  | "ENTERS_FIRST"
  | "LEAVES_FIRST"
  | "SOLE_LEAD_EMERGES"
  | "ENTERS_FIRST_PLACE_TIE"
  | "LEAVES_FIRST_PLACE_TIE"
  | "RANK_UP"
  | "RANK_DOWN"
  | "RANKED_TEAM_TRAILING_LOWER_RANKED"
  | "RANKED_TEAM_TRAILING_UNRANKED"
  | "DECISIVE_PERIOD"
  | "G5_WIN_OVER_POWER"
  | "POWER_LOSS_TO_G5"
  | "SCORING_SWING";

export interface ChaosCandidate {
  version: 1;
  eventId: string;
  eventKey: string;
  stateFingerprint: string;
  leagueId: string;
  season: string;
  week: number;
  type: ChaosEventType;
  severity: ChaosSeverity;
  state: "active";
  transition: "candidate";
  observedAt: string;
  gameId: string | null;
  providerGameId: string | null;
  teamId: string | null;
  memberId: string;
  opponentTeamId: string | null;
  opponentMemberId: string | null;
  facts: {
    gameState: ProjectionGameState | null;
    period: number | null;
    score: { team: number; opponent: number } | null;
    lineupStatus: ProjectionLineupStatus | null;
    captain: boolean;
    counts: boolean | null;
    officialRankBefore: number;
    projectedRank: number;
    rankMovement: number;
    officialPoints: number;
    projectedTotal: number;
    projectedDelta: number;
    gameProjectedPoints: number | null;
    baseProjectedPoints: number | null;
    ruleComponents: ProjectedRuleComponent[];
    teamPregameRank: number | null;
    opponentPregameRank: number | null;
    teamClassification: TeamClassification;
    opponentClassification: TeamClassification;
    headToHead: boolean;
  };
  significance: {
    reasonCodes: ChaosReasonCode[];
    magnitude: number | null;
    rankFraction: number | null;
    lateGameBoostApplied: boolean;
  };
  presentation: {
    groupKey: string;
    priority: number;
    suppressedByType: ChaosEventType | null;
  };
  source: {
    freshness: "fresh";
    projectionGeneratedAt: string;
    liveFetchedAt: string | null;
    canonicalStateFingerprint: string | null;
  };
}

export interface ChaosEvaluationResult {
  version: 1;
  candidates: ChaosCandidate[];
}
