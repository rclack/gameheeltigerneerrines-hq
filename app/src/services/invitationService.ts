import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export async function createInvitation(
  supabase: SupabaseClient<Database>,
  leagueId: string,
  email: string,
) {
  const { data, error } = await supabase.rpc("create_league_invitation", {
    target_league_id: leagueId,
    target_email: email,
  });

  if (error) throw error;
  return data;
}

export async function revokeInvitation(
  supabase: SupabaseClient<Database>,
  invitationId: string,
) {
  const { data, error } = await supabase.rpc("revoke_league_invitation", {
    target_invitation_id: invitationId,
  });

  if (error) throw error;
  return data;
}

export async function acceptInvitation(
  supabase: SupabaseClient<Database>,
  token: string,
) {
  const { data, error } = await supabase.rpc("accept_league_invitation", {
    target_token: token,
  });

  if (error) throw error;
  return data;
}

export async function getInvitationByToken(
  supabase: SupabaseClient<Database>,
  token: string,
) {
  const { data, error } = await supabase
    .from("league_invitations")
    .select("*")
    .eq("invitation_token", token)
    .maybeSingle();

  if (error) throw error;
  return data;
}
