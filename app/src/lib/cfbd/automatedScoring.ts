import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/types/database";

const MAX_FINAL_GAMES_PER_SWEEP = 1000;
const POSTGREST_IN_CHUNK_SIZE = 100;

export interface AutomatedScoringGame {
  id: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home_team_id: string | null;
  away_team_id: string | null;
  scoring_fingerprint: string | null;
  scored_at: string | null;
}

export type AutomatedScoringFailureCategory =
  | "database_read"
  | "database_write"
  | "invalid_final"
  | "missing_ranking_context"
  | "sweep_limit_exceeded"
  | "unauthorized"
  | "unknown";

export interface AutomatedScoringFailure {
  gameId: string;
  category: AutomatedScoringFailureCategory;
}

export interface AutomatedScoringSweepResult {
  leagueId: string;
  syncRunId: string;
  finalGamesExamined: number;
  alreadyCurrent: number;
  newlyScored: number;
  reprocessed: number;
  failed: number;
  failures: AutomatedScoringFailure[];
}

export function automatedScoringEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function hasRequiredRankingContext(game: AutomatedScoringGame, rankedTeamIds: ReadonlySet<string>) {
  const internalTeamIds = [game.home_team_id, game.away_team_id].filter((id): id is string => Boolean(id));
  return internalTeamIds.every((teamId) => rankedTeamIds.has(`${game.id}:${teamId}`));
}

export function scoringFailureCategory(error: unknown): AutomatedScoringFailureCategory {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (code === "42501") return "unauthorized";
  if (code === "P0001") return "invalid_final";
  if (code) return "database_write";
  return "unknown";
}

function chunks<T>(values: T[], size = POSTGREST_IN_CHUNK_SIZE) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function auditSummary(result: AutomatedScoringSweepResult): Json {
  return {
    final_games_examined: result.finalGamesExamined,
    already_scoring_current: result.alreadyCurrent,
    newly_scored: result.newlyScored,
    reprocessed: result.reprocessed,
    failed: result.failed,
    failures: result.failures.map((failure) => ({ game_id: failure.gameId, category: failure.category })),
  };
}

export async function executeAutomatedScoringGames(
  pending: AutomatedScoringGame[],
  rankingKeys: ReadonlySet<string>,
  score: (gameId: string) => Promise<{ error: unknown | null }>,
) {
  const outcome = { newlyScored: 0, reprocessed: 0, failures: [] as AutomatedScoringFailure[] };
  for (const game of pending) {
    if (game.home_score === null || game.away_score === null || game.home_score === game.away_score) {
      outcome.failures.push({ gameId: game.id, category: "invalid_final" });
      continue;
    }
    if (!hasRequiredRankingContext(game, rankingKeys)) {
      outcome.failures.push({ gameId: game.id, category: "missing_ranking_context" });
      continue;
    }
    const scoring = await score(game.id);
    if (scoring.error) {
      outcome.failures.push({ gameId: game.id, category: scoringFailureCategory(scoring.error) });
      continue;
    }
    if (game.scored_at !== null) outcome.reprocessed += 1;
    else outcome.newlyScored += 1;
  }
  return outcome;
}

export async function runAutomatedScoringSweep(
  supabase: SupabaseClient<Database>,
  leagueId: string,
  season: string,
  syncRunId: string,
): Promise<AutomatedScoringSweepResult> {
  const result: AutomatedScoringSweepResult = {
    leagueId,
    syncRunId,
    finalGamesExamined: 0,
    alreadyCurrent: 0,
    newlyScored: 0,
    reprocessed: 0,
    failed: 0,
    failures: [],
  };

  const gamesResult = await supabase
    .from("cfb_games")
    .select("id,status,home_score,away_score,home_team_id,away_team_id,scoring_fingerprint,scored_at")
    .eq("league_id", leagueId)
    .eq("season", season)
    .eq("status", "final")
    .order("game_date", { ascending: true })
    .order("id", { ascending: true })
    .limit(MAX_FINAL_GAMES_PER_SWEEP + 1);

  if (gamesResult.error) throw gamesResult.error;
  if (gamesResult.data.length > MAX_FINAL_GAMES_PER_SWEEP) {
    result.failed = 1;
    result.failures.push({ gameId: "sweep", category: "sweep_limit_exceeded" });
    await supabase.rpc("record_scheduled_scoring_sweep", { target_sync_run_id: syncRunId, target_summary: auditSummary(result) });
    return result;
  }

  const games = gamesResult.data as AutomatedScoringGame[];
  result.finalGamesExamined = games.length;
  const pending = games.filter((game) => {
    if (game.scoring_fingerprint) {
      result.alreadyCurrent += 1;
      return false;
    }
    return true;
  });

  const rankingKeys = new Set<string>();
  for (const gameChunk of chunks(pending.map((game) => game.id))) {
    const rankingResult = await supabase.from("team_ranking_snapshots").select("game_id,team_id").in("game_id", gameChunk);
    if (rankingResult.error) throw rankingResult.error;
    for (const ranking of rankingResult.data) rankingKeys.add(`${ranking.game_id}:${ranking.team_id}`);
  }

  const execution = await executeAutomatedScoringGames(pending, rankingKeys, async (gameId) => {
    const scoring = await supabase.rpc("scheduled_process_cfb_game_scoring", { target_game_id: gameId });
    return { error: scoring.error };
  });
  result.newlyScored = execution.newlyScored;
  result.reprocessed = execution.reprocessed;
  result.failures.push(...execution.failures);

  result.failed = result.failures.length;
  const audit = await supabase.rpc("record_scheduled_scoring_sweep", {
    target_sync_run_id: syncRunId,
    target_summary: auditSummary(result),
  });
  if (audit.error) throw audit.error;
  return result;
}
