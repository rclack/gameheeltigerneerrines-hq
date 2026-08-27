export function formatRankedTeamName(teamName: string, rank: number | null | undefined) {
  return typeof rank === "number" && Number.isInteger(rank) && rank > 0 ? `#${rank} ${teamName}` : teamName;
}
