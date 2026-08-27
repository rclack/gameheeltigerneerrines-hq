"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { updateTeamName } from "@/services/draftService";
import { saveMyWeeklyCaptain, saveMyWeeklyStarters } from "@/services/lineupService";

export interface TeamNameState { error?: string; success?: string }
export interface FavoriteTeamState { error?: string; success?: string; favoriteTeamId?: string | null }
export interface LineupActionState { error?: string; success?: string }

export async function setWeeklyCaptain(_state: LineupActionState, formData: FormData): Promise<LineupActionState> {
  const leagueId = String(formData.get("leagueId") ?? "");
  const lineupId = String(formData.get("lineupId") ?? "");
  const intent = String(formData.get("captainIntent") ?? "select");
  const entryId = intent === "clear" ? null : String(formData.get("entryId") ?? "");
  if (!leagueId || !lineupId || (intent !== "clear" && !entryId)) return { error: "Choose a valid Captain." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in and try again." };
  try {
    await saveMyWeeklyCaptain(supabase, lineupId, entryId, crypto.randomUUID());
    revalidatePath(`/league/${leagueId}`);
    revalidatePath(`/league/${leagueId}/score`);
    return { success: entryId ? "Captain saved." : "Captain cleared." };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    if (message.includes("locked")) return { error: "That Captain has locked at kickoff. Refresh to see the current lineup." };
    if (message.includes("opportunities remaining")) return { error: "That team has no Captain opportunities remaining." };
    return { error: "Your Captain choice could not be saved." };
  }
}

export async function swapWeeklyStarter(_state: LineupActionState, formData: FormData): Promise<LineupActionState> {
  const leagueId = String(formData.get("leagueId") ?? "");
  const lineupId = String(formData.get("lineupId") ?? "");
  const startTeamId = String(formData.get("startTeamId") ?? "");
  const benchTeamId = String(formData.get("benchTeamId") ?? "");
  if (!leagueId || !lineupId || !startTeamId || !benchTeamId || startTeamId === benchTeamId) return { error: "Choose a valid starter swap." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in and try again." };
  const { data: entries, error } = await supabase.from("weekly_lineup_entries").select("team_id,status").eq("weekly_lineup_id", lineupId);
  if (error) return { error: "Your lineup could not be loaded." };
  const starterIds = entries.filter((entry) => entry.status === "starter").map((entry) => entry.team_id);
  if (!starterIds.includes(benchTeamId) || entries.find((entry) => entry.team_id === startTeamId)?.status !== "bench") return { error: "That swap is no longer available. Refresh and try again." };
  try {
    await saveMyWeeklyStarters(supabase, lineupId, [...starterIds.filter((id) => id !== benchTeamId), startTeamId], crypto.randomUUID());
    revalidatePath(`/league/${leagueId}`);
    revalidatePath(`/league/${leagueId}/score`);
    revalidatePath(`/league/${leagueId}/standings`);
    return { success: "Lineup saved." };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    return { error: message.includes("locked") ? "That team has locked at kickoff. Refresh to see the current lineup." : "Your lineup could not be saved." };
  }
}

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
  const shouldClear = formData.get("favoriteTeamIntent") === "clear";
  const teamId = shouldClear ? null : String(formData.get("favoriteTeamId") ?? "").trim() || null;
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
