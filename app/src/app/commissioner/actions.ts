"use server";

import { revalidatePath } from "next/cache";

import { createInvitation, revokeInvitation } from "@/services/invitationService";
import { errorMessage } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export interface InvitationActionState {
  error?: string;
  success?: string;
  invitationToken?: string;
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

  const { data: ownedLeague } = await supabase
    .from("leagues")
    .select("id")
    .eq("id", leagueId)
    .eq("commissioner_id", user.id)
    .maybeSingle();

  if (!ownedLeague) return { error: "You do not have permission to manage this league." };

  try {
    const invitation = await createInvitation(supabase, ownedLeague.id, email);
    revalidatePath("/commissioner");
    return {
      success: `Invitation created for ${invitation.invited_email}.`,
      invitationToken: invitation.invitation_token,
    };
  } catch (error) {
    return { error: invitationError(errorMessage(error)) };
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
    revalidatePath("/commissioner");
    return { success: "Invitation revoked." };
  } catch {
    return { error: "The invitation could not be revoked. Please try again." };
  }
}
