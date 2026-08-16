"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

import { sendLeagueRequestApprovalEmail } from "@/lib/email/resend";
import { type RosterRuleInput } from "@/lib/draft/roster-rules";
import { getSiteOrigin } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import type { Json, LeagueCreationRequest } from "@/types/database";

export interface LeagueRequestState { error?: string; success?: string; request?: LeagueCreationRequest }
export interface LeagueRequestInput { leagueName: string; season: string; ownerCount: number; teamsPerOwner: number; rosterRules: RosterRuleInput[] }

function reviewCredentials() {
  const approve = randomBytes(32).toString("hex");
  const deny = randomBytes(32).toString("hex");
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  return { approve, deny, approveHash: hash(approve), denyHash: hash(deny) };
}

function requestError(message: string) {
  if (message.includes("pending league request")) return "You already have a league request awaiting approval.";
  if (message.includes("cannot supply enough")) return "Those roster rules do not leave enough eligible teams for every owner.";
  if (message.includes("exactly one slot")) return "Configure one roster requirement for every team each owner drafts.";
  if (message.includes("eligibility criteria")) return "Every restricted roster slot needs at least one eligibility choice.";
  return "The league request could not be submitted. Check the settings and try again.";
}

function validInput(input: LeagueRequestInput) {
  return input.leagueName.trim().length >= 2 && input.leagueName.trim().length <= 100
    && /^\d{4}$/.test(input.season) && Number.isInteger(input.ownerCount) && input.ownerCount >= 4 && input.ownerCount <= 16
    && Number.isInteger(input.teamsPerOwner) && input.teamsPerOwner >= 3 && input.teamsPerOwner <= 8
    && Array.isArray(input.rosterRules) && input.rosterRules.length <= 12;
}

async function deliverRequestEmail(supabase: Awaited<ReturnType<typeof createClient>>, request: LeagueCreationRequest, credentials: ReturnType<typeof reviewCredentials>) {
  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", request.requester_id).maybeSingle();
  const origin = getSiteOrigin();
  await sendLeagueRequestApprovalEmail({
    requestId: request.id,
    notificationVersion: request.notification_version,
    requesterName: profile?.display_name ?? "League requester",
    requesterEmail: request.requester_email,
    leagueName: request.proposed_name,
    season: request.season,
    ownerCount: request.owner_count,
    teamsPerOwner: request.teams_per_owner,
    rosterRules: request.roster_rules as unknown as RosterRuleInput[],
    approveUrl: `${origin}/league-requests/review/approve/${credentials.approve}`,
    denyUrl: `${origin}/league-requests/review/deny/${credentials.deny}`,
    expiresAt: request.expires_at,
  });
}

export async function submitLeagueRequest(input: LeagueRequestInput): Promise<LeagueRequestState> {
  if (!validInput(input)) return { error: "Enter a valid league name and format." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Sign in and try again." };
  const credentials = reviewCredentials();
  const { data, error } = await supabase.rpc("create_league_creation_request", {
    target_name: input.leagueName.trim(), target_season: input.season,
    target_owner_count: input.ownerCount, target_teams_per_owner: input.teamsPerOwner,
    target_roster_rules: input.rosterRules as unknown as Json,
    target_approve_token_hash: credentials.approveHash, target_deny_token_hash: credentials.denyHash,
  });
  if (error || !data) return { error: requestError(error?.message ?? "") };
  try {
    await deliverRequestEmail(supabase, data, credentials);
    await supabase.rpc("mark_league_request_notification", { target_request_id: data.id, was_sent: true });
  } catch {
    await supabase.rpc("mark_league_request_notification", { target_request_id: data.id, was_sent: false });
    revalidatePath("/leagues");
    return { request: { ...data, notification_status: "failed" }, error: "Your request was saved, but the approval email could not be delivered. Use Retry Approval Email from My Leagues." };
  }
  revalidatePath("/leagues");
  return { request: { ...data, notification_status: "sent" }, success: "League request submitted for approval." };
}

export async function retryLeagueRequestEmail(requestId: string): Promise<LeagueRequestState> {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return { error: "Pending request not found." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Sign in and try again." };
  const credentials = reviewCredentials();
  const { data, error } = await supabase.rpc("rotate_league_creation_review_tokens", {
    target_request_id: requestId, target_approve_token_hash: credentials.approveHash, target_deny_token_hash: credentials.denyHash,
  });
  if (error || !data) return { error: "The pending request could not be prepared for retry." };
  try {
    await deliverRequestEmail(supabase, data, credentials);
    await supabase.rpc("mark_league_request_notification", { target_request_id: data.id, was_sent: true });
  } catch {
    await supabase.rpc("mark_league_request_notification", { target_request_id: data.id, was_sent: false });
    return { error: "The approval email still could not be delivered." };
  }
  revalidatePath("/leagues");
  return { success: "Approval email sent.", request: { ...data, notification_status: "sent" } };
}
