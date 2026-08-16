import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildSundayRecapEmail } from "@/lib/email/sundayRecapEmail";
import { sendSundayRecapEmail } from "@/lib/email/resend";
import { assessRecapReadiness, buildVerifiedRecapPayload } from "@/lib/recap/dataset";
import { generateRecapNarrative, SUNDAY_RECAP_MODEL } from "@/lib/recap/narrative";
import { pendingRecapRecipients } from "@/lib/recap/delivery";
import { asJson, type RecapNarrative, type VerifiedRecapPayload } from "@/lib/recap/types";
import { getSiteOrigin } from "@/lib/site-url";
import { getDraftParticipants, getDraftPicks, getLeagueDraft } from "@/services/draftService";
import { getLeagueGames } from "@/services/gameService";
import { getLeagueRoster } from "@/services/membershipService";
import { getLeagueScoringEvents } from "@/services/scoringService";
import { getActiveTeams } from "@/services/teamService";
import type { Database, League, SundayRecap } from "@/types/database";

export class RecapNotReadyError extends Error {}
export class RecapConfigurationError extends Error {}

function recapPayload(value: Database["public"]["Tables"]["sunday_recaps"]["Row"]["factual_payload"]) {
  return value as unknown as VerifiedRecapPayload;
}

function recapNarrative(value: Database["public"]["Tables"]["sunday_recaps"]["Row"]["narrative"]) {
  return value as unknown as RecapNarrative | null;
}

export async function getRecapOperations(supabase: SupabaseClient<Database>, leagueId: string) {
  const [settingResult, recapResult, weeksResult] = await Promise.all([
    supabase.from("league_recap_settings").select("*").eq("league_id", leagueId).maybeSingle(),
    supabase.from("sunday_recaps").select("*").eq("league_id", leagueId).order("season", { ascending: false }).order("week", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("cfb_games").select("week").eq("league_id", leagueId).order("week"),
  ]);
  if (settingResult.error) throw settingResult.error;
  if (recapResult.error) throw recapResult.error;
  if (weeksResult.error) throw weeksResult.error;
  return { enabled: settingResult.data?.enabled ?? false, lastRecap: recapResult.data, availableWeeks: [...new Set(weeksResult.data.map((row) => row.week))] };
}

export async function prepareSundayRecap(
  supabase: SupabaseClient<Database>,
  league: League,
  week: number,
  generatedBy: string | null,
  generate: (payload: VerifiedRecapPayload) => Promise<RecapNarrative> = generateRecapNarrative,
) {
  const [roster, draft, teams, games, events] = await Promise.all([
    getLeagueRoster(supabase, league.id),
    getLeagueDraft(supabase, league.id),
    getActiveTeams(supabase),
    getLeagueGames(supabase, league.id),
    getLeagueScoringEvents(supabase, league.id),
  ]);
  if (!draft || draft.status !== "complete") throw new RecapNotReadyError("The league draft is not complete.");
  const readiness = assessRecapReadiness(games, week);
  if (!readiness.ready) throw new RecapNotReadyError(readiness.reason ?? "Weekly scoring is not ready.");
  const participants = await getDraftParticipants(supabase, draft.id, roster.members);
  const picks = await getDraftPicks(supabase, draft.id, participants, teams);
  const { data: snapshots, error: snapshotError } = await supabase.rpc("create_weekly_recap_snapshot", { target_league_id: league.id, target_week: week });
  if (snapshotError) throw snapshotError;
  if (snapshots.length !== roster.members.length) throw new RecapNotReadyError("The weekly standings snapshot is incomplete.");
  const payload = buildVerifiedRecapPayload({
    league,
    week,
    snapshots,
    members: roster.members.map((member) => ({ ...member, ownerName: member.profile?.display_name ?? "Owner" })),
    picks,
    events,
    games,
  });

  const { data: inserted, error: insertError } = await supabase.from("sunday_recaps").insert({ league_id: league.id, season: league.season, week, factual_payload: asJson(payload), generated_by: generatedBy }).select("*").maybeSingle();
  if (insertError && insertError.code !== "23505") throw insertError;
  let recap = inserted;
  if (!recap) {
    const existing = await supabase.from("sunday_recaps").select("*").eq("league_id", league.id).eq("season", league.season).eq("week", week).single();
    if (existing.error) throw existing.error;
    recap = existing.data;
  }
  if (recap.narrative && ["generated", "sending", "sent", "failed"].includes(recap.status)) return recap;

  const claim = await supabase.from("sunday_recaps").update({ status: "generating", factual_payload: asJson(payload), error_message: null }).eq("id", recap.id).in("status", ["draft", "failed"]).is("narrative", null).select("*").maybeSingle();
  if (claim.error) throw claim.error;
  if (!claim.data) {
    const latest = await supabase.from("sunday_recaps").select("*").eq("id", recap.id).single();
    if (latest.error) throw latest.error;
    return latest.data;
  }

  try {
    const narrative = await generate(payload);
    const saved = await supabase.from("sunday_recaps").update({ status: "generated", narrative: asJson(narrative), model: SUNDAY_RECAP_MODEL, generated_at: new Date().toISOString(), error_message: null }).eq("id", recap.id).eq("status", "generating").select("*").single();
    if (saved.error) throw saved.error;
    return saved.data;
  } catch (error) {
    const configuration = error instanceof Error && error.message.includes("not configured");
    await supabase.from("sunday_recaps").update({ status: "failed", error_message: configuration ? "AI generation is not configured." : "AI narrative generation failed." }).eq("id", recap.id).eq("status", "generating");
    if (configuration) throw new RecapConfigurationError("Sunday Recap AI is not configured.");
    throw error;
  }
}

export async function sendPreparedSundayRecap(
  supabase: SupabaseClient<Database>,
  recap: SundayRecap,
  deliver: typeof sendSundayRecapEmail = sendSundayRecapEmail,
) {
  if (!recap.narrative) throw new RecapNotReadyError("Generate the recap before sending it.");
  if (recap.status === "sent") return { sent: 0, failed: 0, skipped: true };
  const claim = await supabase.from("sunday_recaps").update({ status: "sending", error_message: null }).eq("id", recap.id).in("status", ["generated", "failed"]).select("*").maybeSingle();
  if (claim.error) throw claim.error;
  if (!claim.data) return { sent: 0, failed: 0, skipped: true };

  try {
    const [leagueResult, membersResult, existingResult] = await Promise.all([
      supabase.from("leagues").select("*").eq("id", recap.league_id).single(),
      supabase.from("league_members").select("*").eq("league_id", recap.league_id),
      supabase.from("sunday_recap_deliveries").select("*").eq("recap_id", recap.id),
    ]);
    if (leagueResult.error) throw leagueResult.error;
    if (membersResult.error) throw membersResult.error;
    if (existingResult.error) throw existingResult.error;
    const pendingMemberIds = new Set(pendingRecapRecipients(membersResult.data.map((member) => member.id), existingResult.data));
    const email = buildSundayRecapEmail({ payload: recapPayload(recap.factual_payload), narrative: recapNarrative(recap.narrative)!, leagueUrl: `${getSiteOrigin()}/league/${recap.league_id}` });
    let sent = 0;
    let failed = 0;
    for (const member of membersResult.data) {
      if (!pendingMemberIds.has(member.id)) continue;
      const userResult = await supabase.auth.admin.getUserById(member.user_id);
      const recipient = userResult.data.user?.email;
      if (userResult.error || !recipient || !/^\S+@\S+\.\S+$/.test(recipient)) {
        failed += 1;
        const deliveryResult = await supabase.from("sunday_recap_deliveries").upsert({ recap_id: recap.id, league_member_id: member.id, status: "failed", error_message: "No valid account email is available." }, { onConflict: "recap_id,league_member_id" });
        if (deliveryResult.error) throw deliveryResult.error;
        continue;
      }
      try {
        const messageId = await deliver({ recapId: recap.id, memberId: member.id, to: recipient, ...email });
        const deliveryResult = await supabase.from("sunday_recap_deliveries").upsert({ recap_id: recap.id, league_member_id: member.id, status: "sent", provider_message_id: messageId, error_message: null, sent_at: new Date().toISOString() }, { onConflict: "recap_id,league_member_id" });
        if (deliveryResult.error) throw deliveryResult.error;
        sent += 1;
      } catch {
        failed += 1;
        const deliveryResult = await supabase.from("sunday_recap_deliveries").upsert({ recap_id: recap.id, league_member_id: member.id, status: "failed", error_message: "Email delivery failed." }, { onConflict: "recap_id,league_member_id" });
        if (deliveryResult.error) throw deliveryResult.error;
      }
    }
    const finalize = await supabase.from("sunday_recaps").update({ status: failed ? "failed" : "sent", error_message: failed ? `${failed} recipient delivery failed.` : null, sent_at: failed ? null : new Date().toISOString() }).eq("id", recap.id).eq("status", "sending");
    if (finalize.error) throw finalize.error;
    return { sent, failed, skipped: false };
  } catch (error) {
    await supabase.from("sunday_recaps").update({ status: "failed", error_message: "Recap delivery could not complete." }).eq("id", recap.id).eq("status", "sending");
    throw error;
  }
}

export function isSundayInEastern(value: Date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(value) === "Sun";
}

export async function latestRecapWeek(supabase: SupabaseClient<Database>, league: League) {
  const format = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const now = new Date();
  const easternDate = format(now);
  const cutoff = format(new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000));
  const result = await supabase.from("cfb_games").select("week").eq("league_id", league.id).eq("season", league.season).gte("game_date", cutoff).lt("game_date", easternDate).order("game_date", { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw result.error;
  return result.data?.week ?? null;
}
