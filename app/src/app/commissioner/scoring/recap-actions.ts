"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createCronClient } from "@/lib/supabase/cron";
import { prepareSundayRecap, RecapConfigurationError, RecapNotReadyError, sendPreparedSundayRecap } from "@/services/recapService";
import type { SundayRecap } from "@/types/database";

export interface RecapActionState { error?: string; success?: string; recap?: SundayRecap }

async function authorize(leagueId: string) {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return null;
  const leagueResult = await session.from("leagues").select("*").eq("id", leagueId).eq("commissioner_id", user.id).maybeSingle();
  return leagueResult.data ? { session, user, league: leagueResult.data } : null;
}

function refresh(leagueId: string) { revalidatePath(`/commissioner/${leagueId}/scoring`); }

export async function setSundayRecapEnabledAction(leagueId: string, enabled: boolean): Promise<RecapActionState> {
  const authorized = await authorize(leagueId);
  if (!authorized) return { error: "Only the league commissioner can change Sunday Recap settings." };
  const result = await authorized.session.rpc("set_sunday_recap_enabled", { target_league_id: leagueId, should_enable: enabled });
  if (result.error) return { error: "Sunday Recap settings could not be updated." };
  refresh(leagueId);
  return { success: enabled ? "Automatic Sunday Recap enabled." : "Automatic Sunday Recap disabled." };
}

export async function generateSundayRecapAction(leagueId: string, week: number): Promise<RecapActionState> {
  if (!Number.isInteger(week) || week < 1 || week > 25) return { error: "Choose a valid recap week." };
  const authorized = await authorize(leagueId);
  if (!authorized) return { error: "Only the league commissioner can generate this recap." };
  try {
    const recap = await prepareSundayRecap(createCronClient(), authorized.league, week, authorized.user.id);
    refresh(leagueId);
    return { success: `Week ${week} recap is ready for review.`, recap };
  } catch (error) {
    if (error instanceof RecapNotReadyError || error instanceof RecapConfigurationError) return { error: error.message };
    return { error: "Sunday Recap generation failed. The failure was recorded for retry." };
  }
}

export async function sendSundayRecapAction(leagueId: string, recapId: string): Promise<RecapActionState> {
  const authorized = await authorize(leagueId);
  if (!authorized) return { error: "Only the league commissioner can send this recap." };
  const elevated = createCronClient();
  const result = await elevated.from("sunday_recaps").select("*").eq("id", recapId).eq("league_id", leagueId).maybeSingle();
  if (result.error || !result.data) return { error: "The selected recap was not found in this league." };
  try {
    const delivery = await sendPreparedSundayRecap(elevated, result.data);
    refresh(leagueId);
    if (delivery.skipped) return { success: "This recap was already sent; no duplicate emails were created." };
    if (delivery.failed) return { error: `${delivery.sent} sent; ${delivery.failed} failed. Retry sends only to recipients who have not succeeded.` };
    return { success: `Sunday Recap sent to ${delivery.sent} league owner${delivery.sent === 1 ? "" : "s"}.` };
  } catch (error) {
    if (error instanceof RecapNotReadyError) return { error: error.message };
    return { error: "Sunday Recap delivery failed. Successful recipients remain protected from duplicates." };
  }
}
