import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CfbdError, fetchCfbdFbsTeams, fetchCfbdGames, fetchCfbdRankings, testCfbdConnection } from "@/lib/cfbd/client";
import { buildTeamMappingAudit } from "@/lib/cfbd/mapping";
import { normalizeCfbdGame } from "@/lib/cfbd/normalization";
import { prepareCfbdSchedule } from "@/lib/cfbd/schedule";
import { buildRankingSnapshots, getCfpFirstRankingsAt } from "@/lib/cfbd/rankings";
import { CfbdSyncError, databaseSyncError, syncFailureSummary, type CfbdSyncStage, type SyncProgress } from "@/lib/cfbd/diagnostics";
import type { Database, ExternalSyncRun, Json, Team } from "@/types/database";

export type CfbdConnectionStatus = "connected" | "not_configured" | "authentication_failed" | "rate_limited" | "provider_error";

export function getCfbdConfigurationStatus() { return process.env.CFBD_API_KEY ? "configured" as const : "not_configured" as const; }

export async function checkCfbdConnection(): Promise<{ status: CfbdConnectionStatus; message: string }> {
  try {
    await testCfbdConnection();
    return { status: "connected", message: "CFBD authentication succeeded." };
  } catch (error) {
    const code = error instanceof CfbdError ? error.code : "provider_error";
    return { status: code === "invalid_response" ? "provider_error" : code, message: error instanceof Error ? error.message : "CFBD connection failed." };
  }
}

export async function getExternalSyncRuns(supabase: SupabaseClient<Database>, leagueId: string, limit = 10) {
  const { data, error } = await supabase.from("external_sync_runs").select("*").eq("league_id", leagueId).order("started_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

async function beginSync(supabase: SupabaseClient<Database>, leagueId: string, scheduled: boolean) {
  const args = { target_league_id: leagueId, target_provider: "cfbd", target_sync_type: "schedule" };
  const { data, error } = scheduled
    ? await supabase.rpc("scheduled_begin_external_sync", args)
    : await supabase.rpc("begin_external_sync", args);
  if (error) throw error;
  return data;
}

function providerSyncError(stage: CfbdSyncStage, error: unknown) {
  if (error instanceof CfbdSyncError) return error;
  const operation = stage === "fetching_teams" ? "fetching teams" : stage === "fetching_rankings" ? "fetching rankings" : "fetching games";
  if (error instanceof CfbdError) {
    return new CfbdSyncError(stage, error.code, `CFBD schedule synchronization failed while ${operation}: ${error.message}`, { cause: error });
  }
  return new CfbdSyncError(stage, "invalid_response", `CFBD schedule synchronization failed while ${operation}: provider response could not be processed.`, { cause: error });
}

async function failSync(supabase: SupabaseClient<Database>, runId: string, error: CfbdSyncError, progress: SyncProgress, scheduled: boolean) {
  const args = { target_sync_run_id: runId, target_summary: syncFailureSummary(error, progress) };
  const result = scheduled
    ? await supabase.rpc("scheduled_fail_external_sync", args)
    : await supabase.rpc("fail_external_sync", args);
  if (result.error) console.error("CFBD schedule sync audit update failed", { stage: "recording_failure", category: "database_error", detail: result.error.message });
}

async function syncCfbdScheduleInternal(supabase: SupabaseClient<Database>, leagueId: string, season: string, scheduled: boolean): Promise<ExternalSyncRun> {
  const progress: SyncProgress = { teamsFetched: 0, gamesFetched: 0, rankingWeeksFetched: 0, mappingsCreated: 0, gamesMapped: 0, gamesUnmapped: 0 };
  let run: ExternalSyncRun;
  try {
    run = await beginSync(supabase, leagueId, scheduled);
  } catch (error) {
    throw databaseSyncError("audit_creation", error);
  }
  try {
    let externalTeams;
    try { externalTeams = await fetchCfbdFbsTeams(season); }
    catch (error) { throw providerSyncError("fetching_teams", error); }
    progress.teamsFetched = externalTeams.length;

    let externalGames;
    try { externalGames = await fetchCfbdGames(season); }
    catch (error) { throw providerSyncError("fetching_games", error); }
    progress.gamesFetched = externalGames.length;

    let rankingWeeks;
    try { rankingWeeks = await fetchCfbdRankings(season); }
    catch (error) { throw providerSyncError("fetching_rankings", error); }
    progress.rankingWeeksFetched = rankingWeeks.length;

    const [internalResult, persistedResult] = await Promise.all([
      supabase.from("teams").select("*").eq("active", true),
      supabase.from("external_team_mappings").select("team_id,external_team_id,external_name").eq("provider", "cfbd"),
    ]);
    if (internalResult.error) throw databaseSyncError("loading_database_context", internalResult.error);
    if (persistedResult.error) throw databaseSyncError("loading_database_context", persistedResult.error);

    let audit;
    try { audit = buildTeamMappingAudit(internalResult.data as Team[], externalTeams, persistedResult.data); }
    catch (error) { throw new CfbdSyncError("mapping_teams", "mapping_error", "CFBD schedule synchronization failed while mapping teams: provider teams could not be mapped.", { cause: error }); }
    progress.mappingsCreated = audit.created.length;
    if (audit.created.length) {
      const mappingArgs = { target_league_id: leagueId, target_provider: "cfbd", target_mappings: audit.created as unknown as Json };
      const { error } = scheduled
        ? await supabase.rpc("scheduled_save_external_team_mappings", mappingArgs)
        : await supabase.rpc("save_external_team_mappings", mappingArgs);
      if (error) throw databaseSyncError("saving_team_mappings", error);
    }
    const allMappings = [...persistedResult.data, ...audit.created];
    const byId = new Map(allMappings.map((mapping) => [mapping.external_team_id, mapping.team_id]));
    const fbsExternalIds = new Set(externalTeams.map((team) => String(team.id)));
    const prepared = prepareCfbdSchedule(externalGames.map(normalizeCfbdGame), fbsExternalIds, byId);
    let rankingResult;
    try {
      rankingResult = buildRankingSnapshots(externalGames.map(normalizeCfbdGame), prepared.games, rankingWeeks, getCfpFirstRankingsAt(season));
    } catch (error) {
      throw new CfbdSyncError("fetching_rankings", "invalid_response", error instanceof Error ? error.message : "CFBD rankings could not be interpreted.", { cause: error });
    }
    progress.gamesMapped = prepared.games.length;
    progress.gamesUnmapped = prepared.unresolvedGames.length;
    const summary = {
      mappings_created: audit.created.length,
      unmapped_internal_count: audit.unmappedInternal.length,
      unmatched_cfbd_count: audit.unmatchedExternal.length,
      ambiguous_count: audit.ambiguous.length,
      ambiguous: audit.ambiguous,
      unmapped_games: prepared.unresolvedGames,
      external_opponent_count: prepared.externalOpponents.length,
      unsupported_non_fbs_game_count: 0,
      unsupported_non_fbs_games: [],
      unresolved_fbs_mapping_game_count: prepared.unresolvedGames.length,
      unresolved_fbs_mapping_games: prepared.unresolvedGames,
      ranking_weeks_fetched: rankingWeeks.length,
      ranking_snapshots_prepared: rankingResult.snapshots.length,
      ranking_context_unavailable_count: rankingResult.missing.length,
      ranking_context_unavailable_games: rankingResult.missing,
    };
    const gameArgs = { target_sync_run_id: run.id, target_games: prepared.games as unknown as Json, target_external_opponents: prepared.externalOpponents as unknown as Json, target_mapping_summary: summary as unknown as Json };
    const { error } = scheduled
      ? await supabase.rpc("scheduled_apply_external_game_sync", gameArgs)
      : await supabase.rpc("apply_external_game_sync", gameArgs);
    if (error) throw databaseSyncError("importing_games", error);
    const rankingArgs = {
      target_sync_run_id: run.id,
      target_snapshots: rankingResult.snapshots as unknown as Json,
      target_missing_count: rankingResult.missing.length,
    };
    const rankingApply = scheduled
      ? await supabase.rpc("scheduled_apply_cfb_ranking_snapshot_sync", rankingArgs)
      : await supabase.rpc("apply_cfb_ranking_snapshot_sync", rankingArgs);
    if (rankingApply.error) throw databaseSyncError("importing_rankings", rankingApply.error);
    return rankingApply.data;
  } catch (error) {
    const failure = error instanceof CfbdSyncError ? error : new CfbdSyncError("mapping_teams", "internal_error", "CFBD schedule synchronization failed while preparing games: provider data could not be processed.", { cause: error });
    await failSync(supabase, run.id, failure, progress, scheduled);
    throw failure;
  }
}

export function syncCfbdSchedule(supabase: SupabaseClient<Database>, leagueId: string, season: string) {
  return syncCfbdScheduleInternal(supabase, leagueId, season, false);
}

export function syncScheduledCfbdSchedule(supabase: SupabaseClient<Database>, leagueId: string, season: string) {
  return syncCfbdScheduleInternal(supabase, leagueId, season, true);
}
