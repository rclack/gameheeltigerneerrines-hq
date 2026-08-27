import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Team } from "@/types/database";

export type WeeklyLineup = Database["public"]["Tables"]["weekly_lineups"]["Row"];
export type WeeklyLineupEntry = Database["public"]["Tables"]["weekly_lineup_entries"]["Row"];

export interface WeeklyLineupEntryDetail extends WeeklyLineupEntry {
  team: Team;
  gameStatus: string | null;
}

export interface WeeklyLineupDetail {
  lineup: WeeklyLineup;
  entries: WeeklyLineupEntryDetail[];
}

export async function getMyMaterializedLineupWeeks(
  supabase: SupabaseClient<Database>,
  leagueId: string,
  memberId: string,
) {
  const { data, error } = await supabase
    .from("weekly_lineups")
    .select("week")
    .eq("league_id", leagueId)
    .eq("league_member_id", memberId)
    .order("week");
  if (error) throw error;
  return [...new Set(data.map((lineup) => lineup.week))];
}

export async function getOrMaterializeMyWeeklyLineup(
  supabase: SupabaseClient<Database>,
  leagueId: string,
  memberId: string,
  week: number,
): Promise<WeeklyLineupDetail | null> {
  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("season,starters_per_week,lineups_enabled_from_week")
    .eq("id", leagueId)
    .single();
  if (leagueError) throw leagueError;
  if (league.starters_per_week === null || league.lineups_enabled_from_week === null || week < league.lineups_enabled_from_week) return null;

  const { error: materializeError } = await supabase.rpc("materialize_weekly_lineup", {
    target_league_id: leagueId,
    target_week: week,
    target_member_id: memberId,
  });
  if (materializeError) {
    if (materializeError.message.includes("Draft must be complete")) return null;
    throw materializeError;
  }

  const { data: lineup, error: lineupError } = await supabase
    .from("weekly_lineups")
    .select("*")
    .eq("league_id", leagueId)
    .eq("league_member_id", memberId)
    .eq("season", league.season)
    .eq("week", week)
    .single();
  if (lineupError) throw lineupError;

  const { data: entries, error: entriesError } = await supabase
    .from("weekly_lineup_entries")
    .select("*")
    .eq("weekly_lineup_id", lineup.id)
    .order("lock_at", { ascending: true, nullsFirst: false })
    .order("team_id");
  if (entriesError) throw entriesError;
  const teamIds = entries.map((entry) => entry.team_id);
  const gameIds = entries.flatMap((entry) => entry.game_id ? [entry.game_id] : []);
  const [teamsResult, gamesResult] = await Promise.all([
    supabase.from("teams").select("*").in("id", teamIds),
    gameIds.length ? supabase.from("cfb_games").select("id,status").in("id", gameIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (teamsResult.error) throw teamsResult.error;
  if (gamesResult.error) throw gamesResult.error;
  const teams = new Map(teamsResult.data.map((team) => [team.id, team]));
  const statuses = new Map(gamesResult.data.map((game) => [game.id, game.status]));
  return {
    lineup,
    entries: entries.flatMap((entry) => {
      const team = teams.get(entry.team_id);
      return team ? [{ ...entry, team, gameStatus: entry.game_id ? statuses.get(entry.game_id) ?? null : null }] : [];
    }),
  };
}

export async function saveMyWeeklyStarters(
  supabase: SupabaseClient<Database>,
  lineupId: string,
  starterTeamIds: string[],
  requestKey: string,
) {
  const { data, error } = await supabase.rpc("set_weekly_lineup_starters", {
    target_lineup_id: lineupId,
    target_starter_team_ids: starterTeamIds,
    target_request_key: requestKey,
  });
  if (error) throw error;
  if (data === null) throw new Error("A requested team has already locked");
  return data;
}
