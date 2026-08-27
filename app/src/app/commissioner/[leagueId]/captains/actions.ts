"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export interface CaptainCorrectionState { error?: string; success?: string }

export async function correctCaptain(_state: CaptainCorrectionState, formData: FormData): Promise<CaptainCorrectionState> {
  const leagueId = String(formData.get("leagueId") ?? "");
  const lineupId = String(formData.get("lineupId") ?? "");
  const entryValue = String(formData.get("entryId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!leagueId || !lineupId || reason.length < 2) return { error: "A correction reason is required." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in and try again." };
  const { data: league } = await supabase.from("leagues").select("id").eq("id", leagueId).eq("commissioner_id", user.id).maybeSingle();
  if (!league) return { error: "Only the league commissioner can correct Captain history." };
  const { error } = await supabase.rpc("correct_weekly_lineup_captain", {
    target_lineup_id: lineupId,
    target_entry_id: entryValue || null,
    target_reason: reason,
  });
  if (error) return { error: error.message.includes("opportunities remaining") ? "That team has no Captain opportunities remaining." : "Captain correction failed. No scoring was changed." };
  revalidatePath(`/commissioner/${leagueId}/captains`);
  revalidatePath(`/commissioner/${leagueId}/scoring`);
  revalidatePath(`/league/${leagueId}`);
  revalidatePath(`/league/${leagueId}/score`);
  revalidatePath(`/league/${leagueId}/standings`);
  return { success: "Captain history corrected. Affected scoring is stale and requires controlled reprocessing." };
}
