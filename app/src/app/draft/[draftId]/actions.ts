"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { makeDraftPick } from "@/services/draftService";

export interface PickState { error?: string; success?: string }

function pickError(message: string) {
  if (message.includes("not your turn")) return "It is not your turn.";
  if (message.includes("already been drafted") || message.includes("duplicate")) return "That team was just drafted. Choose another team.";
  if (message.includes("not live")) return "The draft is not currently live.";
  if (message.includes("unavailable")) return "That team is unavailable.";
  if (message.includes("Choose the roster slot")) return "Choose which remaining roster requirement this team fills.";
  if (message.includes("already filled")) return "That roster requirement is already filled.";
  if (message.includes("not eligible")) return "That team cannot fill the selected roster requirement.";
  if (message.includes("not part of this league")) return "That roster requirement is invalid.";
  return "Your pick could not be submitted. Refresh and try again.";
}

export async function submitPickAction(draftId: string, teamId: string, rosterSlotId: string | null = null): Promise<PickState> {
  if (!/^[0-9a-f-]{36}$/i.test(draftId) || !/^[0-9a-f-]{36}$/i.test(teamId)) return { error: "Invalid draft selection." };
  if (rosterSlotId !== null && !/^[0-9a-f-]{36}$/i.test(rosterSlotId)) return { error: "Invalid roster requirement." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Sign in again." };
  try {
    await makeDraftPick(supabase, draftId, teamId, rosterSlotId);
    revalidatePath(`/draft/${draftId}`);
    return { success: "Pick submitted." };
  } catch (error) {
    return { error: pickError(error instanceof Error ? error.message : "") };
  }
}
