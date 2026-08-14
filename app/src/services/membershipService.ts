import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, LeagueInvitation, LeagueMember, Profile } from "@/types/database";

export type MemberWithProfile = LeagueMember & { profile: Profile | null };

export interface LeagueRoster {
  members: MemberWithProfile[];
  invitations: LeagueInvitation[];
}

export async function getLeagueRoster(
  supabase: SupabaseClient<Database>,
  leagueId: string,
): Promise<LeagueRoster> {
  const [membersResult, invitationsResult] = await Promise.all([
    supabase
      .from("league_members")
      .select("*")
      .eq("league_id", leagueId)
      .order("created_at", { ascending: true }),
    supabase
      .from("league_invitations")
      .select("*")
      .eq("league_id", leagueId)
      .order("created_at", { ascending: false }),
  ]);

  if (membersResult.error) throw membersResult.error;
  if (invitationsResult.error) throw invitationsResult.error;

  const userIds = membersResult.data.map((member) => member.user_id);
  const profilesResult = userIds.length
    ? await supabase.from("profiles").select("*").in("id", userIds)
    : { data: [], error: null };

  if (profilesResult.error) throw profilesResult.error;
  const profiles = new Map(profilesResult.data.map((profile) => [profile.id, profile]));

  return {
    members: membersResult.data.map((member) => ({
      ...member,
      profile: profiles.get(member.user_id) ?? null,
    })),
    invitations: invitationsResult.data,
  };
}
