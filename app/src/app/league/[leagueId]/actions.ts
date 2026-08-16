"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { updateTeamName } from "@/services/draftService";

export interface TeamNameState { error?: string; success?: string }
export interface FavoriteTeamState { error?: string; success?: string; favoriteTeamId?: string | null }

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

export async function updateFavoriteTeam(
  leagueId: string,
  _state: FavoriteTeamState,
  formData: FormData,
): Promise<FavoriteTeamState> {
  const teamId = String(formData.get("favoriteTeamId") ?? "").trim() || null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in and try again." };

  if (teamId) {
    const { data: team, error: teamError } = await supabase
      .from("teams")
      .select("id")
      .eq("id", teamId)
      .eq("active", true)
      .maybeSingle();
    if (teamError || !team) return { error: "Choose an active FBS team." };
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ favorite_team_id: teamId })
    .eq("id", user.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: "Your favorite team could not be updated." };

  revalidatePath(`/league/${leagueId}`);
  return { success: teamId ? "Favorite team updated." : "Favorite team cleared.", favoriteTeamId: teamId };
}
