import type { SupabaseClient } from "@supabase/supabase-js";

import type { CfbGame, Database, Team, TeamRankingSnapshot } from "@/types/database";

export type GameDetail = CfbGame & {
  homeTeam: Team;
  awayTeam: Team;
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
  status: "scheduled" | "final" | "canceled";
  neutralSite: boolean;
  postseason: boolean;
  rankingSource: string | null;
  homeRank: number | null;
  awayRank: number | null;
}

export async function getLeagueGames(supabase: SupabaseClient<Database>, leagueId: string): Promise<GameDetail[]> {
  const { data: games, error } = await supabase.from("cfb_games").select("*").eq("league_id", leagueId).order("game_date", { ascending: false });
  if (error) throw error;
  if (!games.length) return [];
  const teamIds = [...new Set(games.flatMap((game) => [game.home_team_id, game.away_team_id]))];
  const [teamsResult, rankingsResult] = await Promise.all([
    supabase.from("teams").select("*").in("id", teamIds),
    supabase.from("team_ranking_snapshots").select("*").in("game_id", games.map((game) => game.id)),
  ]);
  if (teamsResult.error) throw teamsResult.error;
  if (rankingsResult.error) throw rankingsResult.error;
  const teams = new Map(teamsResult.data.map((team) => [team.id, team]));
  return games.flatMap((game) => {
    const homeTeam = teams.get(game.home_team_id);
    const awayTeam = teams.get(game.away_team_id);
    return homeTeam && awayTeam ? [{ ...game, homeTeam, awayTeam, rankings: rankingsResult.data.filter((rank) => rank.game_id === game.id) }] : [];
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
