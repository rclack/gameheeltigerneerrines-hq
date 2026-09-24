import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/types/database";

type ScheduledGame = Pick<Database["public"]["Tables"]["cfb_games"]["Row"], "week" | "start_at" | "status">;

export interface WeeklyLineupPreparationResult {
  leagueId: string;
  week: number | null;
  expectedOwners: number;
  materializedOwners: number;
  alreadyCurrentOwners: number;
  failed: number;
  affectedOwnerIds: string[];
  failures: { memberId: string; category: string }[];
  ready: boolean;
}

export function selectPreparationWeek(
  games: ScheduledGame[],
  enabledFromWeek: number | null,
  now = new Date(),
) {
  if (enabledFromWeek === null) return null;
  const viable = games.filter((game) =>
    game.week >= enabledFromWeek
    && game.start_at !== null
    && !["final", "canceled", "postponed"].includes(game.status)
    && new Date(game.start_at).getTime() >= now.getTime(),
  );
  return viable.length ? Math.min(...viable.map((game) => game.week)) : null;
}

function emptyResult(leagueId: string): WeeklyLineupPreparationResult {
  return { leagueId, week: null, expectedOwners: 0, materializedOwners: 0, alreadyCurrentOwners: 0, failed: 0, affectedOwnerIds: [], failures: [], ready: true };
}

export async function prepareScheduledWeeklyLineups(
  supabase: SupabaseClient<Database>,
  leagueId: string,
  season: string,
  syncRunId: string,
  now = new Date(),
): Promise<WeeklyLineupPreparationResult> {
  const [leagueResult, gamesResult, membersResult] = await Promise.all([
    supabase.from("leagues").select("lineups_enabled_from_week").eq("id", leagueId).single(),
    supabase.from("cfb_games").select("week,start_at,status").eq("league_id", leagueId).eq("season", season),
    supabase.from("league_members").select("id").eq("league_id", leagueId),
  ]);
  if (leagueResult.error) throw leagueResult.error;
  if (gamesResult.error) throw gamesResult.error;
  if (membersResult.error) throw membersResult.error;

  const week = selectPreparationWeek(gamesResult.data, leagueResult.data.lineups_enabled_from_week, now);
  if (week === null) {
    const result = emptyResult(leagueId);
    const audit = await supabase.rpc("record_scheduled_weekly_lineup_preparation", { target_sync_run_id: syncRunId, target_summary: result as unknown as Json });
    if (audit.error) throw audit.error;
    return result;
  }

  const before = await supabase.from("weekly_lineups").select("league_member_id").eq("league_id", leagueId).eq("season", season).eq("week", week);
  if (before.error) throw before.error;
  const beforeIds = new Set(before.data.map((lineup) => lineup.league_member_id));
  const missingIds = membersResult.data.map((member) => member.id).filter((id) => !beforeIds.has(id));
  const weekGames = gamesResult.data.filter((game) => game.week === week && game.start_at !== null && !["canceled", "postponed"].includes(game.status));
  const firstKickoff = weekGames.length ? Math.min(...weekGames.map((game) => new Date(game.start_at!).getTime())) : null;

  const cutoffPassed = firstKickoff !== null && firstKickoff <= now.getTime();
  let rpcError: { message: string } | null = null;
  if (missingIds.length && !cutoffPassed) {
    const materialization = await supabase.rpc("scheduled_materialize_weekly_lineups", { target_league_id: leagueId, target_week: week });
    rpcError = materialization.error;
  }

  const after = await supabase.from("weekly_lineups").select("league_member_id").eq("league_id", leagueId).eq("season", season).eq("week", week);
  if (after.error) throw after.error;
  const afterIds = new Set(after.data.map((lineup) => lineup.league_member_id));
  const affectedOwnerIds = [...afterIds].filter((id) => !beforeIds.has(id));
  const readinessResult = await supabase.rpc("get_scheduled_weekly_lineup_readiness", { target_league_id: leagueId, target_week: week });
  if (readinessResult.error) throw readinessResult.error;
  const readiness = readinessResult.data as { ready?: boolean; failures?: { member_id?: string; category?: string }[] } | null;
  const failures = (readiness?.failures ?? []).map((failure) => ({ memberId: failure.member_id ?? "unknown", category: failure.category ?? "unknown" }));
  if (cutoffPassed) {
    for (const memberId of missingIds) if (!afterIds.has(memberId)) failures.push({ memberId, category: "week_already_started" });
  }
  if (rpcError) failures.push({ memberId: "all", category: "materialization_failed" });

  const result: WeeklyLineupPreparationResult = {
    leagueId,
    week,
    expectedOwners: membersResult.data.length,
    materializedOwners: affectedOwnerIds.length,
    alreadyCurrentOwners: beforeIds.size,
    failed: failures.length,
    affectedOwnerIds,
    failures,
    ready: readiness?.ready === true && failures.length === 0,
  };
  const audit = await supabase.rpc("record_scheduled_weekly_lineup_preparation", { target_sync_run_id: syncRunId, target_summary: result as unknown as Json });
  if (audit.error) throw audit.error;
  return result;
}
