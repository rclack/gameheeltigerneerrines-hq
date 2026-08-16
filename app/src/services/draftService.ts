import type { SupabaseClient } from "@supabase/supabase-js";

import type { RosterRuleInput, DraftRosterSlotDetail } from "@/lib/draft/roster-rules";
import type { Database, Draft, DraftPick, DraftQueueItem, DraftSlot, Json, League, LeagueMember, Profile, Team, TeamDraftRuleMembership } from "@/types/database";

export type DraftParticipant = DraftSlot & { member: LeagueMember; profile: Profile | null };
export type DraftSelection = DraftPick & { team: Team; participant: DraftParticipant | null; rosterSlot: DraftRosterSlotDetail | null };
export type DraftQueueSelection = DraftQueueItem & { team: Team };
export interface DraftTeamIntelligence {
  classification: "POWER" | "G5" | "INDEPENDENT" | null;
  priorSeason: string;
  priorRecord: { wins: number; losses: number; ties: number } | null;
  apRank: number | null;
}

export interface DraftRoomData {
  draft: Draft;
  league: League;
  participants: DraftParticipant[];
  picks: DraftSelection[];
  teams: Team[];
  currentUserId: string;
  queue: DraftQueueSelection[];
  teamIntelligence: Record<string, DraftTeamIntelligence>;
  rosterSlots: DraftRosterSlotDetail[];
  teamRuleMemberships: TeamDraftRuleMembership[];
}

export async function getDraftTeamIntelligence(
  supabase: SupabaseClient<Database>,
  league: League,
  teams: Team[],
) {
  const priorSeason = String(Number(league.season) - 1);
  const [classificationsResult, recordsResult, rankingsResult] = await Promise.all([
    supabase.from("conference_classifications").select("conference,classification").eq("season", league.season),
    supabase.rpc("get_draft_team_prior_records", { target_league_id: league.id }),
    supabase.from("team_ranking_snapshots")
      .select("team_id,rank,captured_at")
      .eq("league_id", league.id)
      .eq("season", league.season)
      .eq("ranking_source", "AP Top 25")
      .not("rank", "is", null)
      .order("captured_at", { ascending: false }),
  ]);
  if (classificationsResult.error) throw classificationsResult.error;
  if (recordsResult.error) throw recordsResult.error;
  if (rankingsResult.error) throw rankingsResult.error;

  const classificationByConference = new Map(classificationsResult.data.map((item) => [item.conference, item.classification]));
  const recordByTeam = new Map(recordsResult.data.map((item) => [item.team_id, item]));
  const rankByTeam = new Map<string, number>();
  for (const item of rankingsResult.data) {
    if (item.rank !== null && !rankByTeam.has(item.team_id)) rankByTeam.set(item.team_id, item.rank);
  }

  return Object.fromEntries(teams.map((team) => {
    const record = recordByTeam.get(team.id);
    const classification = classificationByConference.get(team.conference);
    return [team.id, {
      classification: classification === "POWER" || classification === "G5" || classification === "INDEPENDENT" ? classification : null,
      priorSeason,
      priorRecord: record ? { wins: record.wins, losses: record.losses, ties: record.ties } : null,
      apRank: rankByTeam.get(team.id) ?? null,
    } satisfies DraftTeamIntelligence];
  }));
}

export async function getLeagueDraft(supabase: SupabaseClient<Database>, leagueId: string) {
  const { data, error } = await supabase.from("drafts").select("*").eq("league_id", leagueId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getMemberDraftSlot(
  supabase: SupabaseClient<Database>,
  draftId: string,
  leagueMemberId: string,
) {
  const { data, error } = await supabase
    .from("draft_slots")
    .select("*")
    .eq("draft_id", draftId)
    .eq("league_member_id", leagueMemberId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getDraftPickCount(supabase: SupabaseClient<Database>, draftId: string) {
  const { count, error } = await supabase.from("draft_picks").select("id", { count: "exact", head: true }).eq("draft_id", draftId);
  if (error) throw error;
  return count ?? 0;
}

export async function getDraftParticipants(
  supabase: SupabaseClient<Database>,
  draftId: string,
  members: Array<LeagueMember & { profile: Profile | null }>,
) {
  const { data, error } = await supabase
    .from("draft_slots")
    .select("*")
    .eq("draft_id", draftId)
    .order("draft_position");
  if (error) throw error;
  const byId = new Map(members.map((member) => [member.id, member]));
  return data.flatMap((slot) => {
    const member = byId.get(slot.league_member_id);
    return member ? [{ ...slot, member, profile: member.profile }] : [];
  });
}

export async function getDraftPicks(
  supabase: SupabaseClient<Database>,
  draftId: string,
  participants: DraftParticipant[],
  teams: Team[],
  rosterSlots: DraftRosterSlotDetail[] = [],
) {
  const { data, error } = await supabase
    .from("draft_picks")
    .select("*")
    .eq("draft_id", draftId)
    .order("overall_pick");
  if (error) throw error;
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const participantByMember = new Map(participants.map((participant) => [participant.league_member_id, participant]));
  const rosterSlotById = new Map(rosterSlots.map((slot) => [slot.id, slot]));
  return data.flatMap((pick) => {
    const team = teamById.get(pick.team_id);
    return team ? [{ ...pick, team, participant: participantByMember.get(pick.league_member_id) ?? null, rosterSlot: pick.roster_slot_id ? rosterSlotById.get(pick.roster_slot_id) ?? null : null }] : [];
  });
}

export async function getMyDraftQueue(
  supabase: SupabaseClient<Database>,
  draftId: string,
  teams: Team[],
) {
  const { data, error } = await supabase
    .from("draft_queue_items")
    .select("*")
    .eq("draft_id", draftId)
    .order("queue_position");
  if (error) throw error;
  const teamById = new Map(teams.map((team) => [team.id, team]));
  return data.flatMap((item) => {
    const team = teamById.get(item.team_id);
    return team ? [{ ...item, team }] : [];
  });
}

export async function addDraftQueueTeam(supabase: SupabaseClient<Database>, draftId: string, teamId: string) {
  const { data, error } = await supabase.rpc("add_team_to_my_draft_queue", { target_draft_id: draftId, target_team_id: teamId });
  if (error) throw error;
  return data;
}

export async function removeDraftQueueTeam(supabase: SupabaseClient<Database>, queueItemId: string) {
  const { data, error } = await supabase.rpc("remove_team_from_my_draft_queue", { target_queue_item_id: queueItemId });
  if (error) throw error;
  return data;
}

export async function moveDraftQueueTeam(supabase: SupabaseClient<Database>, queueItemId: string, direction: -1 | 1) {
  const { data, error } = await supabase.rpc("move_team_in_my_draft_queue", { target_queue_item_id: queueItemId, move_direction: direction });
  if (error) throw error;
  return data;
}

export async function randomizeDraft(supabase: SupabaseClient<Database>, leagueId: string) {
  const { data, error } = await supabase.rpc("randomize_draft_order", { target_league_id: leagueId });
  if (error) throw error;
  return data;
}

export async function saveManualDraftOrder(
  supabase: SupabaseClient<Database>,
  leagueId: string,
  memberIds: string[],
) {
  const { data, error } = await supabase.rpc("set_manual_draft_order", {
    target_league_id: leagueId,
    target_member_ids: memberIds,
  });
  if (error) throw error;
  return data;
}

export async function startLeagueDraft(supabase: SupabaseClient<Database>, draftId: string) {
  const { data, error } = await supabase.rpc("start_draft", { target_draft_id: draftId });
  if (error) throw error;
  return data;
}

export async function resetLeagueDraft(supabase: SupabaseClient<Database>, draftId: string) {
  const { data, error } = await supabase.rpc("reset_draft", { target_draft_id: draftId });
  if (error) throw error;
  return data;
}

export async function pauseLeagueDraft(supabase: SupabaseClient<Database>, draftId: string, paused: boolean) {
  const { data, error } = await supabase.rpc("set_draft_paused", { target_draft_id: draftId, should_pause: paused });
  if (error) throw error;
  return data;
}

export async function makeDraftPick(supabase: SupabaseClient<Database>, draftId: string, teamId: string, rosterSlotId: string | null) {
  const { data, error } = await supabase.rpc("submit_draft_pick", { target_draft_id: draftId, target_team_id: teamId, target_roster_slot_id: rosterSlotId });
  if (error) throw error;
  return data;
}

export async function getDraftRosterRules(supabase: SupabaseClient<Database>, leagueId: string) {
  const [slotsResult, criteriaResult] = await Promise.all([
    supabase.from("league_draft_roster_slots").select("*").eq("league_id", leagueId).order("slot_position"),
    supabase.from("league_draft_roster_slot_criteria").select("*"),
  ]);
  if (slotsResult.error) throw slotsResult.error;
  if (criteriaResult.error) throw criteriaResult.error;
  const criteriaBySlot = new Map<string, typeof criteriaResult.data>();
  for (const criterion of criteriaResult.data) {
    const existing = criteriaBySlot.get(criterion.roster_slot_id) ?? [];
    existing.push(criterion);
    criteriaBySlot.set(criterion.roster_slot_id, existing);
  }
  return slotsResult.data.map((slot) => ({ ...slot, criteria: criteriaBySlot.get(slot.id) ?? [] }));
}

export async function getTeamDraftRuleMemberships(supabase: SupabaseClient<Database>, season: string) {
  const { data, error } = await supabase.from("team_draft_rule_memberships").select("*").eq("season", season);
  if (error) throw error;
  return data;
}

export async function saveDraftRosterRules(supabase: SupabaseClient<Database>, leagueId: string, slots: RosterRuleInput[]) {
  const { data, error } = await supabase.rpc("save_draft_roster_rules", { target_league_id: leagueId, target_slots: slots as unknown as Json });
  if (error) throw error;
  return data;
}

export async function updateTeamName(supabase: SupabaseClient<Database>, leagueId: string, teamName: string) {
  const { data, error } = await supabase.rpc("update_my_team_name", { target_league_id: leagueId, new_team_name: teamName });
  if (error) throw error;
  return data;
}
