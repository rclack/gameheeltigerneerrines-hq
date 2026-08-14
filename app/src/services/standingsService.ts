import type { SupabaseClient } from "@supabase/supabase-js";

import { getDraftParticipants, getDraftPicks, getLeagueDraft } from "@/services/draftService";
import { getLeagueRoster } from "@/services/membershipService";
import { getLeagueScoringEvents, type ScoringEventDetail } from "@/services/scoringService";
import { getActiveTeams } from "@/services/teamService";
import type { Database, Team } from "@/types/database";

export interface StandingRow {
  rank: number;
  memberId: string;
  ownerName: string;
  poolTeamName: string | null;
  totalPoints: number;
  weeklyPoints: number;
  draftedTeamCount: number;
}

export interface TeamScoreBreakdown {
  team: Team;
  totalPoints: number;
  events: ScoringEventDetail[];
}

export interface LeagueStandingsData {
  rows: StandingRow[];
  events: ScoringEventDetail[];
  availableWeeks: number[];
  selectedWeek: number;
}

export async function getLeagueStandings(
  supabase: SupabaseClient<Database>,
  leagueId: string,
  requestedWeek?: number,
): Promise<LeagueStandingsData> {
  const [roster, draft, events] = await Promise.all([
    getLeagueRoster(supabase, leagueId),
    getLeagueDraft(supabase, leagueId),
    getLeagueScoringEvents(supabase, leagueId),
  ]);
  const availableWeeks = [...new Set(events.flatMap((event) => event.week === null ? [] : [event.week]))].sort((a, b) => a - b);
  const selectedWeek = requestedWeek && requestedWeek > 0 ? requestedWeek : (availableWeeks.at(-1) ?? 1);
  if (!draft) return { rows: roster.members.map((member, index) => ({ rank: index + 1, memberId: member.id, ownerName: member.profile?.display_name ?? "Owner", poolTeamName: member.team_name, totalPoints: 0, weeklyPoints: 0, draftedTeamCount: 0 })), events, availableWeeks, selectedWeek };

  const teams = await getActiveTeams(supabase);
  const participants = await getDraftParticipants(supabase, draft.id, roster.members);
  const picks = await getDraftPicks(supabase, draft.id, participants, teams);
  const ownerByTeam = new Map(picks.map((pick) => [pick.team_id, pick.league_member_id]));
  const totals = new Map<string, number>();
  const weekly = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const pick of picks) counts.set(pick.league_member_id, (counts.get(pick.league_member_id) ?? 0) + 1);
  for (const event of events) {
    const memberId = ownerByTeam.get(event.team_id);
    if (!memberId) continue;
    totals.set(memberId, (totals.get(memberId) ?? 0) + event.points);
    if (event.week === selectedWeek) weekly.set(memberId, (weekly.get(memberId) ?? 0) + event.points);
  }
  const rows = roster.members.map((member) => ({
    rank: 0,
    memberId: member.id,
    ownerName: member.profile?.display_name ?? "Owner",
    poolTeamName: member.team_name,
    totalPoints: totals.get(member.id) ?? 0,
    weeklyPoints: weekly.get(member.id) ?? 0,
    draftedTeamCount: counts.get(member.id) ?? 0,
  })).sort((a, b) => b.totalPoints - a.totalPoints || a.ownerName.localeCompare(b.ownerName));
  let previousTotal: number | null = null;
  let previousRank = 0;
  rows.forEach((row, index) => {
    if (row.totalPoints !== previousTotal) previousRank = index + 1;
    row.rank = previousRank;
    previousTotal = row.totalPoints;
  });
  return { rows, events, availableWeeks, selectedWeek };
}

export async function getMemberScoreBreakdown(
  supabase: SupabaseClient<Database>,
  leagueId: string,
  memberId: string,
): Promise<TeamScoreBreakdown[]> {
  const draft = await getLeagueDraft(supabase, leagueId);
  if (!draft) return [];
  const [teams, picksResult] = await Promise.all([
    getActiveTeams(supabase),
    supabase.from("draft_picks").select("*").eq("draft_id", draft.id).eq("league_member_id", memberId).order("overall_pick"),
  ]);
  const { data: picks, error } = picksResult;
  if (error) throw error;
  const events = picks.length ? await getLeagueScoringEvents(supabase, leagueId, { teamIds: picks.map((pick) => pick.team_id) }) : [];
  const teamMap = new Map(teams.map((team) => [team.id, team]));
  return picks.flatMap((pick) => {
    const team = teamMap.get(pick.team_id);
    if (!team) return [];
    const teamEvents = events.filter((event) => event.team_id === team.id);
    return [{ team, events: teamEvents, totalPoints: teamEvents.reduce((sum, event) => sum + event.points, 0) }];
  });
}
