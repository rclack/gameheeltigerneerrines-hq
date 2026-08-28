"use server";

import { revalidatePath } from "next/cache";

import { getLeagueGames, saveGame, scoreGame, type GameDetail, type SaveGameInput } from "@/services/gameService";
import { addManualScoringEvent, voidManualScoringEvent } from "@/services/scoringService";
import { createClient } from "@/lib/supabase/server";
import { checkCfbdConnection, syncCfbdSchedule } from "@/services/cfbdService";
import { CfbdSyncError } from "@/lib/cfbd/diagnostics";
import { bulkScoringPlan, executeBulkScoring } from "@/lib/cfbd/scoringDashboard";
import { configuredCronLeagueIds } from "@/lib/cfbd/cron";
import { createCronClient } from "@/lib/supabase/cron";
import { pollLiveScoreboard } from "@/services/liveScoreboardService";

export interface ScoringActionState { error?: string; success?: string }
export interface BulkScoringActionState {
  error?: string;
  processed?: Array<{ gameId: string; label: string; eventCount: number }>;
  failed?: Array<{ gameId: string; label: string; reason: string }>;
  excluded?: { notFinal: number; alreadyCurrent: number; missingRankingContext: number; otherwiseIneligible: number };
}

async function authorizedClient(leagueId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: league } = await supabase.from("leagues").select("id").eq("id", leagueId).eq("commissioner_id", user.id).maybeSingle();
  return league ? supabase : null;
}

function refreshScoring(leagueId: string) {
  revalidatePath(`/commissioner/${leagueId}`);
  revalidatePath(`/commissioner/${leagueId}/scoring`);
  revalidatePath(`/league/${leagueId}`);
  revalidatePath(`/league/${leagueId}/standings`);
  revalidatePath(`/league/${leagueId}/score`);
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("not drafted")) return "That team was not drafted in this league.";
  if (message.includes("inactive")) return "That scoring rule is inactive.";
  if (message.includes("completed")) return "Only a completed, non-tied game can be scored.";
  if (message.includes("ranking source")) return "Provide a ranking source when entering a rank.";
  if (message.includes("access denied")) return "You do not have permission to score this league.";
  return "The scoring action could not be completed.";
}

export async function addManualEventAction(leagueId: string, input: { teamId: string; ruleId: string; week: number | null; eventDate: string | null; notes: string | null }): Promise<ScoringActionState> {
  const supabase = await authorizedClient(leagueId);
  if (!supabase) return { error: "You do not have permission to score this league." };
  try {
    await addManualScoringEvent(supabase, { leagueId, ...input });
    refreshScoring(leagueId);
    return { success: "Scoring event added to the ledger." };
  } catch (error) { return { error: safeError(error) }; }
}

export async function voidManualEventAction(leagueId: string, eventId: string, reason: string): Promise<ScoringActionState> {
  const supabase = await authorizedClient(leagueId);
  if (!supabase) return { error: "You do not have permission to score this league." };
  try {
    await voidManualScoringEvent(supabase, eventId, reason);
    refreshScoring(leagueId);
    return { success: "Manual event voided; its audit record was preserved." };
  } catch (error) { return { error: safeError(error) }; }
}

export async function saveGameAction(leagueId: string, input: SaveGameInput): Promise<ScoringActionState> {
  if (input.leagueId !== leagueId) return { error: "League mismatch." };
  const supabase = await authorizedClient(leagueId);
  if (!supabase) return { error: "You do not have permission to manage games for this league." };
  try {
    await saveGame(supabase, input);
    refreshScoring(leagueId);
    return { success: input.gameId ? "Game updated." : "Game added." };
  } catch (error) { return { error: safeError(error) }; }
}

export async function scoreGameAction(leagueId: string, gameId: string): Promise<ScoringActionState> {
  const supabase = await authorizedClient(leagueId);
  if (!supabase) return { error: "You do not have permission to score games for this league." };
  try {
    const count = await scoreGame(supabase, gameId);
    refreshScoring(leagueId);
    return { success: `Game scoring is current (${count} active event${count === 1 ? "" : "s"}).` };
  } catch (error) { return { error: safeError(error) }; }
}

function gameLabel(game: GameDetail) {
  return `Week ${game.week}: ${game.awayParticipant.displayName} at ${game.homeParticipant.displayName}`;
}

export async function scoreEligibleFinalsAction(leagueId: string): Promise<BulkScoringActionState> {
  const supabase = await authorizedClient(leagueId);
  if (!supabase) return { error: "You do not have permission to score games for this league." };
  try {
    const games = await getLeagueGames(supabase, leagueId);
    const plan = bulkScoringPlan(games);
    const result = await executeBulkScoring(plan.eligible, async (game) => {
      try {
        return await scoreGame(supabase, game.id);
      } catch (error) {
        throw new Error(safeError(error));
      }
    });
    refreshScoring(leagueId);
    return {
      processed: result.processed.map(({ game, eventCount }) => ({ gameId: game.id, label: gameLabel(game), eventCount })),
      failed: result.failed.map(({ game, reason }) => ({ gameId: game.id, label: gameLabel(game), reason })),
      excluded: plan.excluded,
    };
  } catch (error) {
    return { error: safeError(error) };
  }
}

export async function testCfbdConnectionAction(leagueId: string): Promise<ScoringActionState> {
  const supabase = await authorizedClient(leagueId);
  if (!supabase) return { error: "You do not have permission to test providers for this league." };
  const result = await checkCfbdConnection();
  return result.status === "connected" ? { success: result.message } : { error: result.message };
}

export async function pollCfbdLiveScoreboardAction(leagueId: string): Promise<ScoringActionState> {
  const authorized = await authorizedClient(leagueId);
  if (!authorized) return { error: "You do not have permission to test live providers for this league." };
  try {
    const leagueIds = configuredCronLeagueIds(process.env.CFBD_CRON_LEAGUE_IDS);
    const run = await pollLiveScoreboard(createCronClient(), leagueIds, "manual");
    revalidatePath(`/commissioner/${leagueId}/scoring`);
    return run ? { success: `Live scoreboard poll succeeded: ${run.relevant_game_count} relevant, ${run.changed_game_count} changed, ${run.unchanged_game_count} unchanged, ${run.provider_calls} provider calls.` } : { success: "Live scoreboard poll was not due." };
  } catch {
    return { error: "Live scoreboard polling failed. Review the protected poll diagnostics." };
  }
}

export async function syncCfbdScheduleAction(leagueId: string): Promise<ScoringActionState> {
  const supabase = await authorizedClient(leagueId);
  if (!supabase) return { error: "You do not have permission to synchronize this league." };
  try {
    const { data: league, error } = await supabase.from("leagues").select("season").eq("id", leagueId).single();
    if (error) throw error;
    const run = await syncCfbdSchedule(supabase, leagueId, league.season);
    refreshScoring(leagueId);
    return { success: `CFBD sync ${run.status}: ${run.created_count} created, ${run.updated_count} updated, ${run.unchanged_count} unchanged, ${run.skipped_count} skipped.` };
  } catch (error) {
    refreshScoring(leagueId);
    if (error instanceof CfbdSyncError) return { error: error.userMessage };
    return { error: "CFBD schedule synchronization failed. The failed attempt is available in the sync audit." };
  }
}
