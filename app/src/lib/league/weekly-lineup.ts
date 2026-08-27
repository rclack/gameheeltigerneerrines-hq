export interface LineupCandidate { teamId: string; kickoffAt: string | null; gameId: string | null; gameStatus: string | null }
export interface AutomaticLineupSelection extends LineupCandidate { status: "starter" | "bench" | "no_game"; source: "week0_auto" | "week1_auto" | "carry_forward" | "bye_replacement" }

function eligible(candidate: LineupCandidate) {
  return candidate.gameId !== null && candidate.kickoffAt !== null && candidate.gameStatus !== "canceled" && candidate.gameStatus !== "postponed";
}

export function automaticWeeklyLineup(candidates: LineupCandidate[], startersLimit: number, priorStarterTeamIds: string[] = [], initialSource: "week0_auto" | "week1_auto" = "week1_auto"): AutomaticLineupSelection[] {
  if (!Number.isInteger(startersLimit) || startersLimit < 1) throw new Error("Starter limit must be positive.");
  if (new Set(candidates.map((candidate) => candidate.teamId)).size !== candidates.length) throw new Error("Each owned team must appear exactly once.");
  const prior = new Set(priorStarterTeamIds);
  const sorted = candidates.filter(eligible).sort((left, right) => Number(prior.has(right.teamId)) - Number(prior.has(left.teamId)) || left.kickoffAt!.localeCompare(right.kickoffAt!) || left.gameId!.localeCompare(right.gameId!) || left.teamId.localeCompare(right.teamId));
  const starterIds = new Set(sorted.slice(0, startersLimit).map((candidate) => candidate.teamId));
  return candidates.map((candidate) => ({ ...candidate, status: !eligible(candidate) ? "no_game" : starterIds.has(candidate.teamId) ? "starter" : "bench", source: priorStarterTeamIds.length === 0 ? initialSource : prior.has(candidate.teamId) && eligible(candidate) ? "carry_forward" : "bye_replacement" }));
}

export function countingPoints(events: Array<{ points: number; counts_for_standings?: boolean }>) {
  return events.filter((event) => event.counts_for_standings !== false).reduce((total, event) => total + event.points, 0);
}
