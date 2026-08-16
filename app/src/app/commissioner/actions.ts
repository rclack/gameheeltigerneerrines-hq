"use server";

import { revalidatePath } from "next/cache";

import { createInvitation, revokeInvitation } from "@/services/invitationService";
import { sendLeagueInvitationEmail } from "@/lib/email/resend";
import { errorMessage } from "@/lib/errors";
import { getSiteOrigin } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

export interface InvitationActionState {
  error?: string;
  emailError?: string;
  success?: string;
  invitationToken?: string;
}

export interface InvitationEmailActionState {
  error?: string;
  success?: string;
}

function invitationError(message: string) {
  if (message.includes("roster is full")) return "This league has no open roster spots.";
  if (message.includes("already belongs")) return "That email already belongs to a league member.";
  if (message.includes("pending invitation")) return "A pending invitation already exists for that email.";
  if (message.includes("valid email")) return "Enter a valid email address.";
  if (message.includes("access denied")) return "You do not have permission to manage this league.";
  return "The invitation could not be created. Please try again.";
}

export async function inviteOwner(
  leagueId: string,
  _previousState: InvitationActionState,
  formData: FormData,
): Promise<InvitationActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter a valid email address." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Sign in and try again." };

  const [{ data: ownedLeague }, { data: commissionerProfile }] = await Promise.all([
    supabase
    .from("leagues")
    .select("id, name, season")
    .eq("id", leagueId)
    .eq("commissioner_id", user.id)
    .maybeSingle(),
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  if (!ownedLeague) return { error: "You do not have permission to manage this league." };

  try {
    const invitation = await createInvitation(supabase, ownedLeague.id, email);
    revalidatePath(`/commissioner/${leagueId}`);

    try {
      await sendLeagueInvitationEmail({
        commissionerName: commissionerProfile?.display_name ?? "Your league commissioner",
        expiresAt: invitation.expires_at,
        invitationId: invitation.id,
        invitationUrl: `${getSiteOrigin()}/invite/${encodeURIComponent(invitation.invitation_token)}`,
        leagueName: ownedLeague.name,
        season: ownedLeague.season,
        to: invitation.invited_email,
      });

      return {
        success: `Invitation created for ${invitation.invited_email} and email sent.`,
        invitationToken: invitation.invitation_token,
      };
    } catch {
      return {
        success: `Invitation created for ${invitation.invited_email}.`,
        emailError: "The invitation email could not be sent. Copy the invite link or retry email delivery below.",
        invitationToken: invitation.invitation_token,
      };
    }
  } catch (error) {
    return { error: invitationError(errorMessage(error)) };
  }
}

export async function resendOwnerInvitationEmail(
  invitationId: string,
): Promise<InvitationEmailActionState> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invitationId)) {
    return { error: "Invitation not found or access denied." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Sign in and try again." };

  const { data: invitation } = await supabase
    .from("league_invitations")
    .select("id, league_id, invited_email, invitation_token, expires_at, status")
    .eq("id", invitationId)
    .maybeSingle();

  if (!invitation) return { error: "Invitation not found or access denied." };
  if (invitation.status !== "pending") return { error: "Only pending invitations can be emailed." };
  if (new Date(invitation.expires_at) <= new Date()) {
    return { error: "This invitation has expired. Create a new invitation instead." };
  }

  const [{ data: ownedLeague }, { data: commissionerProfile }] = await Promise.all([
    supabase
      .from("leagues")
      .select("id, name, season")
      .eq("id", invitation.league_id)
      .eq("commissioner_id", user.id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  if (!ownedLeague) return { error: "Invitation not found or access denied." };

  try {
    await sendLeagueInvitationEmail({
      commissionerName: commissionerProfile?.display_name ?? "Your league commissioner",
      expiresAt: invitation.expires_at,
      invitationId: invitation.id,
      invitationUrl: `${getSiteOrigin()}/invite/${encodeURIComponent(invitation.invitation_token)}`,
      leagueName: ownedLeague.name,
      season: ownedLeague.season,
      to: invitation.invited_email,
    });
    return { success: `Invitation email sent to ${invitation.invited_email}.` };
  } catch {
    return { error: "The invitation email could not be sent. Copy the invite link or try again later." };
  }
}

export async function revokeOwnerInvitation(
  invitationId: string,
): Promise<InvitationActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Sign in and try again." };

  const { data: invitation } = await supabase
    .from("league_invitations")
    .select("id, league_id")
    .eq("id", invitationId)
    .maybeSingle();

  if (!invitation) return { error: "Invitation not found or access denied." };

  const { data: ownedLeague } = await supabase
    .from("leagues")
    .select("id")
    .eq("id", invitation.league_id)
    .eq("commissioner_id", user.id)
    .maybeSingle();

  if (!ownedLeague) return { error: "Invitation not found or access denied." };

  try {
    const revoked = await revokeInvitation(supabase, invitation.id);
    if (!revoked) return { error: "Only pending invitations can be revoked." };
    revalidatePath(`/commissioner/${invitation.league_id}`);
    return { success: "Invitation revoked." };
  } catch {
    return { error: "The invitation could not be revoked. Please try again." };
  }
}
