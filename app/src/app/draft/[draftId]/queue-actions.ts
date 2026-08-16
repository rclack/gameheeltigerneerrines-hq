"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { addDraftQueueTeam, moveDraftQueueTeam, removeDraftQueueTeam } from "@/services/draftService";

export interface QueueActionState { error?: string; success?: string }

function queueError(message: string) {
  if (message.includes("already in your queue")) return "That team is already in your queue.";
  if (message.includes("already been drafted") || message.includes("unavailable")) return "That team is no longer available.";
  if (message.includes("Completed drafts")) return "A completed draft queue cannot be changed.";
  if (message.includes("membership")) return "You are not a member of this draft.";
  if (message.includes("remaining roster slot")) return "That team cannot fill any of your remaining roster requirements.";
  return "Your queue could not be updated. Refresh and try again.";
}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? supabase : null;
}

export async function addQueueTeamAction(draftId: string, teamId: string): Promise<QueueActionState> {
  const supabase = await authenticatedClient();
  if (!supabase) return { error: "Your session expired." };
  try {
    await addDraftQueueTeam(supabase, draftId, teamId);
    revalidatePath(`/draft/${draftId}`);
    return { success: "Added to your queue." };
  } catch (error) { return { error: queueError(error instanceof Error ? error.message : "") }; }
}

export async function removeQueueTeamAction(draftId: string, queueItemId: string): Promise<QueueActionState> {
  const supabase = await authenticatedClient();
  if (!supabase) return { error: "Your session expired." };
  try {
    await removeDraftQueueTeam(supabase, queueItemId);
    revalidatePath(`/draft/${draftId}`);
    return { success: "Removed from your queue." };
  } catch (error) { return { error: queueError(error instanceof Error ? error.message : "") }; }
}

export async function moveQueueTeamAction(draftId: string, queueItemId: string, direction: -1 | 1): Promise<QueueActionState> {
  const supabase = await authenticatedClient();
  if (!supabase) return { error: "Your session expired." };
  try {
    await moveDraftQueueTeam(supabase, queueItemId, direction);
    revalidatePath(`/draft/${draftId}`);
    return { success: "Queue order updated." };
  } catch (error) { return { error: queueError(error instanceof Error ? error.message : "") }; }
}
