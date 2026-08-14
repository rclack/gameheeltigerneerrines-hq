"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { updateTeamName } from "@/services/draftService";

export interface TeamNameState { error?: string; success?: string }

export async function updateOwnerTeamName(
  leagueId: string,
  _state: TeamNameState,
  formData: FormData,
): Promise<TeamNameState> {
  const teamName = String(formData.get("teamName") ?? "").trim();
  if (teamName.length < 2 || teamName.length > 80) return { error: "Team name must contain 2 to 80 characters." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in and try again." };
  try {
    await updateTeamName(supabase, leagueId, teamName);
    revalidatePath(`/league/${leagueId}`);
    return { success: "Team name updated." };
  } catch {
    return { error: "Team name could not be updated." };
  }
}
