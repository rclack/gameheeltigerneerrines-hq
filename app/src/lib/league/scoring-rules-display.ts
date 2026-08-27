import type { ScoringRule } from "@/types/database";

export const SCORING_CATEGORY_ORDER = [
  "game_result",
  "postseason",
  "awards",
  "coaching",
  "statistical_bonus",
  "statistical_penalty",
] as const;

export const SCORING_CATEGORY_LABELS: Record<string, { title: string; eyebrow: string }> = {
  game_result: { title: "Game Results", eyebrow: "Every final matters" },
  postseason: { title: "Postseason", eyebrow: "Championships, bowls & CFP" },
  awards: { title: "Player Awards", eyebrow: "National recognition" },
  coaching: { title: "Coaching Changes", eyebrow: "Program consequences" },
  statistical_bonus: { title: "Season Statistical Bonuses", eyebrow: "Top-three finishes" },
  statistical_penalty: { title: "Season Statistical Penalties", eyebrow: "Bottom-three finishes" },
};

export function scoringPointsLabel(points: number) {
  return `${points > 0 ? "+" : ""}${points} ${Math.abs(points) === 1 ? "point" : "points"}`;
}

export function groupScoringRules(rules: ScoringRule[]) {
  const byCategory = new Map<string, ScoringRule[]>();
  for (const rule of rules) byCategory.set(rule.category, [...(byCategory.get(rule.category) ?? []), rule]);
  return [
    ...SCORING_CATEGORY_ORDER.filter((category) => byCategory.has(category)).map((category) => ({
      category,
      rules: byCategory.get(category) ?? [],
      ...SCORING_CATEGORY_LABELS[category],
    })),
    ...[...byCategory.entries()]
      .filter(([category]) => !SCORING_CATEGORY_ORDER.includes(category as (typeof SCORING_CATEGORY_ORDER)[number]))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, categoryRules]) => ({ category, rules: categoryRules, title: category.replaceAll("_", " "), eyebrow: "League scoring" })),
  ];
}
