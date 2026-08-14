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
  return "Your pick could not be submitted. Refresh and try again.";
}

export async function submitPickAction(draftId: string, teamId: string): Promise<PickState> {
  if (!/^[0-9a-f-]{36}$/i.test(draftId) || !/^[0-9a-f-]{36}$/i.test(teamId)) return { error: "Invalid draft selection." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Sign in again." };
  try {
    await makeDraftPick(supabase, draftId, teamId);
    revalidatePath(`/draft/${draftId}`);
    return { success: "Pick submitted." };
  } catch (error) {
    return { error: pickError(error instanceof Error ? error.message : "") };
  }
}
