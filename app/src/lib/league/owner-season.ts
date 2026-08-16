import type { DraftSelection } from "@/services/draftService";
import type { GameDetail } from "@/services/gameService";
import type { ScoringEventDetail } from "@/services/scoringService";

export interface TeamSeasonRecord { wins: number; losses: number; ties: number }

function gameTime(game: GameDetail) {
  return new Date(game.start_at ?? `${game.game_date}T12:00:00Z`).getTime();
}

export function getTeamSeasonRecord(games: GameDetail[], teamId: string): TeamSeasonRecord {
  const record = { wins: 0, losses: 0, ties: 0 };
  for (const game of games) {
    if (game.status !== "final" || game.home_score === null || game.away_score === null) continue;
    const isHome = game.home_team_id === teamId;
    const isAway = game.away_team_id === teamId;
    if (!isHome && !isAway) continue;
    const teamScore = isHome ? game.home_score : game.away_score;
    const opponentScore = isHome ? game.away_score : game.home_score;
    if (teamScore > opponentScore) record.wins += 1;
    else if (teamScore < opponentScore) record.losses += 1;
    else record.ties += 1;
  }
  return record;
}

export function selectRelevantOwnerGames(games: GameDetail[], teamIds: string[], now: Date, limit = 6) {
  const owned = new Set(teamIds);
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`).getTime();
  return games
    .filter((game) => owned.has(game.home_team_id ?? "") || owned.has(game.away_team_id ?? ""))
    .filter((game) => game.status === "in_progress" || ((game.status === "scheduled" || game.status === "postponed") && gameTime(game) >= today))
    .sort((left, right) => {
      const liveDifference = Number(right.status === "in_progress") - Number(left.status === "in_progress");
      return liveDifference || gameTime(left) - gameTime(right) || left.id.localeCompare(right.id);
    })
    .slice(0, limit);
}

export function ownerScoringSummary(picks: DraftSelection[], events: ScoringEventDetail[]) {
  const teamIds = new Set(picks.map((pick) => pick.team_id));
  const totals = new Map<string, number>();
  const recent: ScoringEventDetail[] = [];
  for (const event of events) {
    if (!teamIds.has(event.team_id)) continue;
    totals.set(event.team_id, (totals.get(event.team_id) ?? 0) + event.points);
    recent.push(event);
  }
  return { totals, recent };
}

export function recordLabel(record: TeamSeasonRecord) {
  return `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""}`;
}
