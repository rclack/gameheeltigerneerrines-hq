import type { SupabaseClient } from "@supabase/supabase-js";

import type { CfbGame, Database, ExternalOpponent, Team, TeamRankingSnapshot } from "@/types/database";

export type GameParticipant =
  | { kind: "internal"; id: string; displayName: string; classification: "fbs"; team: Team }
  | { kind: "external"; id: string; displayName: string; classification: ExternalOpponent["classification"]; opponent: ExternalOpponent };

export function formatGameParticipant(participant: Pick<GameParticipant, "kind" | "displayName" | "classification">) {
  return `${participant.displayName}${participant.kind === "external" ? ` (${participant.classification.toUpperCase()})` : ""}`;
}

export type GameDetail = CfbGame & {
  homeParticipant: GameParticipant;
  awayParticipant: GameParticipant;
  rankings: TeamRankingSnapshot[];
};

export interface SaveGameInput {
  gameId: string | null;
  leagueId: string;
  season: string;
  week: number;
  gameDate: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
  status: "scheduled" | "in_progress" | "final" | "postponed" | "canceled";
  neutralSite: boolean;
  postseason: boolean;
  rankingSource: string | null;
  homeRank: number | null;
  awayRank: number | null;
}

const POSTGREST_IN_FILTER_CHUNK_SIZE = 100;

export function chunkPostgrestFilterValues<T>(values: T[], size = POSTGREST_IN_FILTER_CHUNK_SIZE) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function gameReadError(stage: string, error: { code?: string; message?: string }) {
  console.error(JSON.stringify({ event: "commissioner_game_read_failure", stage, code: error.code ?? null, message: error.message ?? "Database read failed." }));
  return new Error(`Commissioner game data could not be loaded while ${stage}.`);
}

export async function getLeagueGames(supabase: SupabaseClient<Database>, leagueId: string): Promise<GameDetail[]> {
  const { data: games, error } = await supabase.from("cfb_games").select("*").eq("league_id", leagueId).order("game_date", { ascending: false });
  if (error) throw gameReadError("loading games", error);
  if (!games.length) return [];
  const teamIds = [...new Set(games.flatMap((game) => [game.home_team_id, game.away_team_id]).filter((id): id is string => id !== null))];
  const opponentIds = [...new Set(games.flatMap((game) => [game.home_external_opponent_id, game.away_external_opponent_id]).filter((id): id is string => id !== null))];
  const [teamsResult, opponentsResult, rankingResults] = await Promise.all([
    supabase.from("teams").select("*").in("id", teamIds),
    opponentIds.length ? supabase.from("external_opponents").select("*").in("id", opponentIds) : Promise.resolve({ data: [] as ExternalOpponent[], error: null }),
    Promise.all(chunkPostgrestFilterValues(games.map((game) => game.id)).map((gameIds) =>
      supabase.from("team_ranking_snapshots").select("*").in("game_id", gameIds),
    )),
  ]);
  if (teamsResult.error) throw gameReadError("loading game teams", teamsResult.error);
  if (opponentsResult.error) throw gameReadError("loading external opponents", opponentsResult.error);
  const failedRankings = rankingResults.find((result) => result.error);
  if (failedRankings?.error) throw gameReadError("loading game rankings", failedRankings.error);
  const rankings = rankingResults.flatMap((result) => result.data ?? []);
  const teams = new Map(teamsResult.data.map((team) => [team.id, team]));
  const opponents = new Map(opponentsResult.data.map((opponent) => [opponent.id, opponent]));
  return games.flatMap((game) => {
    const participant = (teamId: string | null, opponentId: string | null): GameParticipant | null => {
      const team = teamId ? teams.get(teamId) : undefined;
      if (team) return { kind: "internal", id: team.id, displayName: team.school_name, classification: "fbs", team };
      const opponent = opponentId ? opponents.get(opponentId) : undefined;
      return opponent ? { kind: "external", id: opponent.id, displayName: opponent.display_name, classification: opponent.classification, opponent } : null;
    };
    const homeParticipant = participant(game.home_team_id, game.home_external_opponent_id);
    const awayParticipant = participant(game.away_team_id, game.away_external_opponent_id);
    return homeParticipant && awayParticipant ? [{ ...game, homeParticipant, awayParticipant, rankings: rankings.filter((rank) => rank.game_id === game.id) }] : [];
  });
}

export async function saveGame(supabase: SupabaseClient<Database>, input: SaveGameInput) {
  const { data, error } = await supabase.rpc("save_cfb_game", {
    target_game_id: input.gameId,
    target_league_id: input.leagueId,
    target_season: input.season,
    target_week: input.week,
    target_game_date: input.gameDate,
    target_home_team_id: input.homeTeamId,
    target_away_team_id: input.awayTeamId,
    target_home_score: input.homeScore,
    target_away_score: input.awayScore,
    target_status: input.status,
    target_neutral_site: input.neutralSite,
    target_postseason: input.postseason,
    target_ranking_source: input.rankingSource,
    target_home_rank: input.homeRank,
    target_away_rank: input.awayRank,
  });
  if (error) throw error;
  return data;
}

export async function scoreGame(supabase: SupabaseClient<Database>, gameId: string) {
  const { data, error } = await supabase.rpc("process_cfb_game_scoring", { target_game_id: gameId });
  if (error) throw error;
  return data;
}
