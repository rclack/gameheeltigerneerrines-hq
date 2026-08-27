import type { SupabaseClient } from "@supabase/supabase-js";

import { deriveStandingRows, type StandingRow } from "@/lib/league/standings-experience";
import { getDraftParticipants, getDraftPicks, getLeagueDraft } from "@/services/draftService";
import { getLeagueRoster } from "@/services/membershipService";
import { getLeagueScoringEvents, type ScoringEventDetail } from "@/services/scoringService";
import { getActiveTeams } from "@/services/teamService";
import type { Database, Team } from "@/types/database";

export type { StandingRow } from "@/lib/league/standings-experience";

export interface TeamScoreBreakdown {
  team: Team;
  totalPoints: number;
  benchPoints: number;
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
  const [roster, draft, events, teams] = await Promise.all([
    getLeagueRoster(supabase, leagueId),
    getLeagueDraft(supabase, leagueId),
    getLeagueScoringEvents(supabase, leagueId),
    getActiveTeams(supabase),
  ]);
  const availableWeeks = [...new Set(events.flatMap((event) => event.week === null ? [] : [event.week]))].sort((a, b) => a - b);
  const countingEvents = events.filter((event) => event.counts_for_standings !== false);
  const selectedWeek = requestedWeek !== undefined && requestedWeek >= 0 ? requestedWeek : (availableWeeks.at(-1) ?? 0);
  const members = roster.members.map((member) => ({
    memberId: member.id,
    userId: member.user_id,
    ownerName: member.profile?.display_name ?? "Owner",
    poolTeamName: member.team_name,
    favoriteTeamId: member.profile?.favorite_team_id ?? null,
  }));
  if (!draft) return { rows: deriveStandingRows(members, [], countingEvents, teams, selectedWeek), events: countingEvents, availableWeeks, selectedWeek };

  const participants = await getDraftParticipants(supabase, draft.id, roster.members);
  const picks = await getDraftPicks(supabase, draft.id, participants, teams);
  const rows = deriveStandingRows(members, picks, countingEvents, teams, selectedWeek);
  return { rows, events: countingEvents, availableWeeks, selectedWeek };
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
    return [{
      team,
      events: teamEvents,
      totalPoints: teamEvents.filter((event) => event.counts_for_standings !== false).reduce((sum, event) => sum + event.points, 0),
      benchPoints: teamEvents.filter((event) => event.counts_for_standings === false).reduce((sum, event) => sum + event.points, 0),
    }];
  });
}
