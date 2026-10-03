export const LIVE_PROJECTABLE_RULE_CODES = [
  "WIN",
  "LOSS",
  "WIN_OVER_RANKED",
  "WIN_OVER_TOP_15",
  "WIN_OVER_TOP_5",
  "G5_WIN_OVER_P5",
  "P5_LOSS_TO_G5",
] as const;

export type LiveProjectableRuleCode = typeof LIVE_PROJECTABLE_RULE_CODES[number];
export type TeamClassification = "POWER" | "G5" | "INDEPENDENT" | null;

export interface ProjectableRule {
  id: string;
  code: string;
  displayName: string;
  points: number;
}

export interface GameResultTeamInput {
  teamId: string | null;
  classification: TeamClassification;
  pregameRank: number | null;
  rankingContextResolved: boolean;
  classificationResolved: boolean;
}

export interface GameResultEvaluationInput {
  homeScore: number;
  awayScore: number;
  home: GameResultTeamInput;
  away: GameResultTeamInput;
  rules: readonly ProjectableRule[];
  multiplier?: 1 | 2;
}

export interface ProjectedRuleComponent {
  ruleId: string;
  code: LiveProjectableRuleCode;
  displayName: string;
  basePoints: number;
  multiplier: 1 | 2;
  points: number;
}

export interface GameResultEvaluation {
  tied: boolean;
  home: ProjectedRuleComponent[];
  away: ProjectedRuleComponent[];
  warnings: string[];
}

function ruleMap(rules: readonly ProjectableRule[]) {
  return new Map(rules
    .filter((rule): rule is ProjectableRule & { code: LiveProjectableRuleCode } =>
      LIVE_PROJECTABLE_RULE_CODES.includes(rule.code as LiveProjectableRuleCode))
    .map((rule) => [rule.code, rule]));
}

function component(
  rules: Map<LiveProjectableRuleCode, ProjectableRule>,
  code: LiveProjectableRuleCode,
  multiplier: 1 | 2,
) {
  const rule = rules.get(code);
  return rule ? {
    ruleId: rule.id,
    code,
    displayName: rule.displayName,
    basePoints: rule.points,
    multiplier,
    points: rule.points * multiplier,
  } satisfies ProjectedRuleComponent : null;
}

export function evaluateProjectedGameResult(input: GameResultEvaluationInput): GameResultEvaluation {
  if (!Number.isInteger(input.homeScore) || !Number.isInteger(input.awayScore)
    || input.homeScore < 0 || input.awayScore < 0) {
    throw new Error("Projected game scores must be complete nonnegative integers.");
  }
  if (input.homeScore === input.awayScore) return { tied: true, home: [], away: [], warnings: [] };

  const rules = ruleMap(input.rules);
  const multiplier = input.multiplier ?? 1;
  const homeWon = input.homeScore > input.awayScore;
  const winner = homeWon ? input.home : input.away;
  const loser = homeWon ? input.away : input.home;
  const winnerComponents: ProjectedRuleComponent[] = [];
  const loserComponents: ProjectedRuleComponent[] = [];
  const warnings: string[] = [];
  const add = (target: ProjectedRuleComponent[], code: LiveProjectableRuleCode) => {
    const value = component(rules, code, multiplier);
    if (value) target.push(value);
    else warnings.push(`Active scoring rule ${code} is unavailable.`);
  };

  if (winner.teamId) add(winnerComponents, "WIN");
  if (loser.teamId) add(loserComponents, "LOSS");

  if (winner.teamId && loser.teamId) {
    if (!loser.rankingContextResolved) warnings.push("Authoritative opponent ranking context is missing; ranked-win bonuses were withheld.");
    else if (loser.pregameRank !== null) {
      add(winnerComponents, "WIN_OVER_RANKED");
      if (loser.pregameRank <= 15) add(winnerComponents, "WIN_OVER_TOP_15");
      if (loser.pregameRank <= 5) add(winnerComponents, "WIN_OVER_TOP_5");
    }
    if (!winner.classificationResolved || !loser.classificationResolved) {
      warnings.push("Authoritative conference classification is missing; Power/G5 components were withheld.");
    } else if (winner.classification === "G5" && loser.classification === "POWER") {
      add(winnerComponents, "G5_WIN_OVER_P5");
      add(loserComponents, "P5_LOSS_TO_G5");
    }
  }

  return {
    tied: false,
    home: homeWon ? winnerComponents : loserComponents,
    away: homeWon ? loserComponents : winnerComponents,
    warnings: [...new Set(warnings)],
  };
}
