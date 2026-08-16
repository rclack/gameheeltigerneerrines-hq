"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export interface LeagueReviewState { error?: string; success?: string; leagueId?: string }

export async function decideLeagueRequest(token: string, decision: "approve" | "deny"): Promise<LeagueReviewState> {
  if (!/^[0-9a-f]{64}$/.test(token) || !["approve", "deny"].includes(decision)) return { error: "This review link is invalid or unavailable." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in as the designated site administrator." };
  const { data, error } = await supabase.rpc("decide_league_creation_request", { target_token: token, target_decision: decision });
  if (error) {
    const message = error.message.includes("expired") ? "This review link has expired." : error.message.includes("administrator") ? "This account is not authorized to review league requests." : "This review link is invalid, expired, or already used.";
    return { error: message };
  }
  revalidatePath("/leagues");
  if (data) revalidatePath(`/commissioner/${data}`);
  redirect(`/league-requests/review/complete?decision=${decision}`);
}
