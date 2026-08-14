"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { acceptInvitation } from "@/services/invitationService";

export interface AcceptInviteState {
  error?: string;
  success?: string;
}

function acceptanceError(message: string) {
  if (message.includes("different email")) return "This invitation was sent to a different email address. Sign in with the invited email.";
  if (message.includes("expired")) return "This invitation has expired. Ask the commissioner for a new link.";
  if (message.includes("no longer pending")) return "This invitation was revoked or has already been used.";
  if (message.includes("already a member")) return "You are already a member of this league.";
  if (message.includes("roster is full")) return "This league is full. Contact the commissioner.";
  if (message.includes("not found")) return "This invitation link is invalid.";
  return "The invitation could not be accepted. Please try again.";
}

export async function acceptOwnerInvitation(
  token: string,
  previousState: AcceptInviteState,
): Promise<AcceptInviteState> {
  void previousState;
  if (!/^[a-f0-9]{64}$/.test(token)) return { error: "This invitation link is invalid." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in with the invited email before accepting." };

  let leagueId: string | null;
  try {
    leagueId = await acceptInvitation(supabase, token);
    if (!leagueId) return { error: "This invitation has expired. Ask the commissioner for a new link." };
  } catch (error) {
    return { error: acceptanceError(error instanceof Error ? error.message : "") };
  }

  revalidatePath(`/invite/${token}`);
  revalidatePath(`/league/${leagueId}`);
  redirect(`/league/${leagueId}`);
}
