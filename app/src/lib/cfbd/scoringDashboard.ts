import { getGameScoringState } from "./scoringState.ts";

export interface ScoringDashboardGame {
  id: string;
  week: number;
  game_date: string;
  status: string;
  home_team_id: string | null;
  away_team_id: string | null;
  rankings: Array<{ ranking_source: string }>;
  home_score: number | null;
  away_score: number | null;
  scored_at: string | null;
  scoring_fingerprint: string | null;
}

export type GameView = "attention" | "all" | `week:${number}`;

export function hasGameRankingContext(game: ScoringDashboardGame) {
  const expectedSnapshots = game.home_team_id && game.away_team_id ? 2 : 0;
  return expectedSnapshots === 0 || game.rankings.length >= expectedSnapshots;
}

export function canProcessScoring(game: ScoringDashboardGame) {
  return game.status === "final"
    && getGameScoringState(game) !== "scored"
    && hasGameRankingContext(game);
}

export type BulkScoringExclusion = "notFinal" | "alreadyCurrent" | "missingRankingContext" | "otherwiseIneligible";

export function bulkScoringExclusion(game: ScoringDashboardGame): BulkScoringExclusion | null {
  if (game.status !== "final") return "notFinal";
  if (getGameScoringState(game) === "scored") return "alreadyCurrent";
  if (!hasGameRankingContext(game)) return "missingRankingContext";
  if (game.home_score === null || game.away_score === null || game.home_score === game.away_score) return "otherwiseIneligible";
  return null;
}

export function bulkScoringPlan<T extends ScoringDashboardGame>(games: T[]) {
  const excluded = { notFinal: 0, alreadyCurrent: 0, missingRankingContext: 0, otherwiseIneligible: 0 };
  const eligible: T[] = [];
  for (const game of games) {
    const reason = bulkScoringExclusion(game);
    if (reason) excluded[reason] += 1;
    else eligible.push(game);
  }
  return { eligible, excluded };
}

export async function executeBulkScoring<T extends ScoringDashboardGame>(
  games: T[],
  score: (game: T) => Promise<number>,
) {
  const processed: Array<{ game: T; eventCount: number }> = [];
  const failed: Array<{ game: T; reason: string }> = [];
  for (const game of games) {
    try {
      processed.push({ game, eventCount: await score(game) });
    } catch (error) {
      failed.push({ game, reason: error instanceof Error ? error.message : "Unknown scoring failure." });
    }
  }
  return { processed, failed };
}

export function isGameActionable(game: ScoringDashboardGame) {
  const state = getGameScoringState(game);
  return state === "needs_scoring"
    || state === "needs_reprocessing"
    || (game.status === "final" && !hasGameRankingContext(game));
}

export function operationalWeek(games: ScoringDashboardGame[]) {
  const activeWeeks = games
    .filter((game) => game.status === "in_progress")
    .map((game) => game.week);
  if (activeWeeks.length) return Math.min(...activeWeeks);

  const upcomingWeeks = games
    .filter((game) => ["scheduled", "postponed"].includes(game.status))
    .map((game) => game.week);
  if (upcomingWeeks.length) return Math.min(...upcomingWeeks);

  const weeks = games.map((game) => game.week);
  return weeks.length ? Math.max(...weeks) : 1;
}

export function defaultGameView(games: ScoringDashboardGame[]): GameView {
  return games.some(isGameActionable) ? "attention" : `week:${operationalWeek(games)}`;
}

export function gameAttentionCounts(games: ScoringDashboardGame[]) {
  return games.reduce((counts, game) => {
    const state = getGameScoringState(game);
    if (state === "needs_scoring") counts.needsScoring += 1;
    if (state === "needs_reprocessing") counts.needsReprocessing += 1;
    if (game.status === "final" && !hasGameRankingContext(game)) counts.missingRankingContext += 1;
    if (state === "scored") counts.current += 1;
    return counts;
  }, { needsScoring: 0, needsReprocessing: 0, missingRankingContext: 0, current: 0 });
}

function priority(game: ScoringDashboardGame, currentWeek: number) {
  const state = getGameScoringState(game);
  if (state === "needs_scoring" || state === "needs_reprocessing") return 0;
  if (game.week === currentWeek) return 1;
  if (game.week > currentWeek && game.week <= currentWeek + 2) return 2;
  if (game.week < currentWeek && state === "scored") return 3;
  if (game.week < currentWeek) return 3;
  return 4;
}

export function visibleGames<T extends ScoringDashboardGame>(games: T[], view: GameView): T[] {
  const currentWeek = operationalWeek(games);
  const filtered = view === "attention"
    ? games.filter(isGameActionable)
    : view === "all"
      ? games
      : games.filter((game) => game.week === Number(view.slice(5)));

  return [...filtered].sort((left, right) => {
    if (view === "all" || view === "attention") {
      const priorityDifference = priority(left, currentWeek) - priority(right, currentWeek);
      if (priorityDifference) return priorityDifference;
    }
    return left.game_date.localeCompare(right.game_date) || left.id.localeCompare(right.id);
  });
}
