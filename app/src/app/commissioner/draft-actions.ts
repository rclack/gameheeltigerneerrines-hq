"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { pauseLeagueDraft, randomizeDraft, resetLeagueDraft, saveDraftRosterRules, saveManualDraftOrder, startLeagueDraft } from "@/services/draftService";
import type { RosterRuleInput } from "@/lib/draft/roster-rules";

export interface DraftSetupState { error?: string; success?: string; draftId?: string }

async function commissionerOwnsLeague(leagueId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: league } = await supabase.from("leagues").select("id").eq("id", leagueId).eq("commissioner_id", user.id).maybeSingle();
  return league ? { supabase, league } : null;
}

function setupError(message: string) {
  if (message.includes("membership is incomplete")) return "Every roster spot must have an accepted member before the draft starts.";
  if (message.includes("Pending invitations")) return "Resolve all pending invitations before starting the draft.";
  if (message.includes("complete draft order")) return "Randomize the complete draft order first.";
  if (message.includes("every accepted owner exactly once")) return "Assign every accepted owner exactly once before saving.";
  if (message.includes("Not enough active teams")) return "Seed enough active FBS teams before starting the draft.";
  if (message.includes("Roster rules cannot change after")) return "Roster rules cannot change after the draft starts. Reset the draft first if you intend to rebuild it.";
  if (message.includes("after the draft starts")) return "Draft order cannot be changed after the draft starts.";
  if (message.includes("status transition")) return "The draft cannot make that status change.";
  if (message.includes("exactly one slot")) return "Configure one roster requirement for every team each owner drafts.";
  if (message.includes("eligibility criteria")) return "Every restricted roster requirement needs at least one eligible conference or classification.";
  if (message.includes("cannot supply enough")) return "Those roster rules do not leave enough unique eligible teams for every owner.";
  return "The draft action could not be completed.";
}

export async function saveDraftRosterRulesAction(leagueId: string, slots: RosterRuleInput[]): Promise<DraftSetupState> {
  const authorized = await commissionerOwnsLeague(leagueId);
  if (!authorized) return { error: "League not found or access denied." };
  if (!Array.isArray(slots) || slots.length > 12 || slots.some((slot) => typeof slot.label !== "string" || !Array.isArray(slot.criteria))) {
    return { error: "Roster-rule configuration is invalid." };
  }
  try {
    await saveDraftRosterRules(authorized.supabase, leagueId, slots);
    revalidatePath(`/commissioner/${leagueId}`);
    return { success: slots.length ? "Draft roster rules saved." : "Draft roster restrictions removed." };
  } catch (error) {
    return { error: setupError(error instanceof Error ? error.message : "") };
  }
}

export async function saveManualDraftOrderAction(
  leagueId: string,
  memberIds: string[],
): Promise<DraftSetupState> {
  const authorized = await commissionerOwnsLeague(leagueId);
  if (!authorized) return { error: "League not found or access denied." };
  try {
    const draftId = await saveManualDraftOrder(authorized.supabase, leagueId, memberIds);
    revalidatePath(`/commissioner/${leagueId}`);
    return { success: "Manual draft order saved.", draftId };
  } catch (error) {
    return { error: setupError(error instanceof Error ? error.message : "") };
  }
}

export async function randomizeOrder(leagueId: string): Promise<DraftSetupState> {
  const authorized = await commissionerOwnsLeague(leagueId);
  if (!authorized) return { error: "League not found or access denied." };
  try {
    const draftId = await randomizeDraft(authorized.supabase, leagueId);
    revalidatePath(`/commissioner/${leagueId}`);
    return { success: "Draft order randomized.", draftId };
  } catch (error) {
    return { error: setupError(error instanceof Error ? error.message : "") };
  }
}

export async function startDraftAction(leagueId: string, draftId: string): Promise<DraftSetupState> {
  const authorized = await commissionerOwnsLeague(leagueId);
  if (!authorized) return { error: "League not found or access denied." };
  try {
    await startLeagueDraft(authorized.supabase, draftId);
    revalidatePath(`/commissioner/${leagueId}`);
    revalidatePath(`/draft/${draftId}`);
    return { success: "Draft started.", draftId };
  } catch (error) {
    return { error: setupError(error instanceof Error ? error.message : "") };
  }
}

export async function setDraftPausedAction(leagueId: string, draftId: string, paused: boolean): Promise<DraftSetupState> {
  const authorized = await commissionerOwnsLeague(leagueId);
  if (!authorized) return { error: "League not found or access denied." };
  try {
    await pauseLeagueDraft(authorized.supabase, draftId, paused);
    revalidatePath(`/commissioner/${leagueId}`);
    revalidatePath(`/draft/${draftId}`);
    return { success: paused ? "Draft paused." : "Draft resumed.", draftId };
  } catch (error) {
    return { error: setupError(error instanceof Error ? error.message : "") };
  }
}

export async function resetDraftAction(leagueId: string, draftId: string): Promise<DraftSetupState> {
  const authorized = await commissionerOwnsLeague(leagueId);
  if (!authorized) return { error: "League not found or access denied." };
  try {
    await resetLeagueDraft(authorized.supabase, draftId);
    revalidatePath(`/commissioner/${leagueId}`);
    revalidatePath(`/draft/${draftId}`);
    return { success: "Draft reset. The existing draft order was preserved.", draftId };
  } catch (error) {
    return { error: setupError(error instanceof Error ? error.message : "") };
  }
}
