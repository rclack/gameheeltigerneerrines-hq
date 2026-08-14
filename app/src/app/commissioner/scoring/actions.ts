"use server";

import { revalidatePath } from "next/cache";

import { saveGame, scoreGame, type SaveGameInput } from "@/services/gameService";
import { addManualScoringEvent, voidManualScoringEvent } from "@/services/scoringService";
import { createClient } from "@/lib/supabase/server";

export interface ScoringActionState { error?: string; success?: string }

async function authorizedClient(leagueId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: league } = await supabase.from("leagues").select("id").eq("id", leagueId).eq("commissioner_id", user.id).maybeSingle();
  return league ? supabase : null;
}

function refreshScoring(leagueId: string) {
  revalidatePath("/commissioner");
  revalidatePath("/commissioner/scoring");
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
