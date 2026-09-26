import type { RecapStanding } from "./types.ts";

export function orderWeeklyResults(standings: RecapStanding[]) {
  return [...standings].sort((left, right) =>
    right.weeklyPoints - left.weeklyPoints
    || left.position - right.position
    || (left.poolTeamName ?? left.ownerName).localeCompare(right.poolTeamName ?? right.ownerName),
  );
}
