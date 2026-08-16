import type { ScoringEventDetail } from "@/services/scoringService";
import type { Team } from "@/types/database";

export interface StandingMemberInput {
  memberId: string;
  userId: string;
  ownerName: string;
  poolTeamName: string | null;
  favoriteTeamId: string | null;
}

export interface StandingPickInput {
  league_member_id: string;
  team: Team;
}

export interface StandingRow {
  rank: number;
  memberId: string;
  userId: string;
  ownerName: string;
  poolTeamName: string | null;
  totalPoints: number;
  weeklyPoints: number;
  draftedTeamCount: number;
  draftedTeams: Team[];
  favoriteTeam: Team | null;
  activeEventCount: number;
  latestEvent: ScoringEventDetail | null;
  strongestTeam: { team: Team; points: number } | null;
  pointsBehindLeader: number;
}

export function deriveStandingRows(
  members: StandingMemberInput[],
  picks: StandingPickInput[],
  events: ScoringEventDetail[],
  teams: Team[],
  selectedWeek: number,
): StandingRow[] {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const ownerByTeam = new Map(picks.map((pick) => [pick.team.id, pick.league_member_id]));
  const draftedByMember = new Map<string, Team[]>();
  const eventsByMember = new Map<string, ScoringEventDetail[]>();
  const teamPoints = new Map<string, number>();

  for (const pick of picks) {
    const drafted = draftedByMember.get(pick.league_member_id) ?? [];
    drafted.push(pick.team);
    draftedByMember.set(pick.league_member_id, drafted);
  }
  for (const event of events) {
    const memberId = ownerByTeam.get(event.team_id);
    if (!memberId) continue;
    const memberEvents = eventsByMember.get(memberId) ?? [];
    memberEvents.push(event);
    eventsByMember.set(memberId, memberEvents);
    teamPoints.set(event.team_id, (teamPoints.get(event.team_id) ?? 0) + event.points);
  }

  const rows = members.map((member) => {
    const memberEvents = eventsByMember.get(member.memberId) ?? [];
    const draftedTeams = draftedByMember.get(member.memberId) ?? [];
    const strongestTeam = memberEvents.length
      ? draftedTeams
        .map((team) => ({ team, points: teamPoints.get(team.id) ?? 0 }))
        .sort((left, right) => right.points - left.points || left.team.school_name.localeCompare(right.team.school_name))[0] ?? null
      : null;
    return {
      rank: 0,
      ...member,
      totalPoints: memberEvents.reduce((sum, event) => sum + event.points, 0),
      weeklyPoints: memberEvents.filter((event) => event.week === selectedWeek).reduce((sum, event) => sum + event.points, 0),
      draftedTeamCount: draftedTeams.length,
      draftedTeams,
      favoriteTeam: member.favoriteTeamId ? teamsById.get(member.favoriteTeamId) ?? null : null,
      activeEventCount: memberEvents.length,
      latestEvent: memberEvents[0] ?? null,
      strongestTeam,
      pointsBehindLeader: 0,
    } satisfies StandingRow;
  }).sort((left, right) => right.totalPoints - left.totalPoints || left.ownerName.localeCompare(right.ownerName));

  let previousTotal: number | null = null;
  let previousRank = 0;
  rows.forEach((row, index) => {
    if (row.totalPoints !== previousTotal) previousRank = index + 1;
    row.rank = previousRank;
    previousTotal = row.totalPoints;
  });
  const leaderTotal = rows[0]?.totalPoints ?? 0;
  for (const row of rows) row.pointsBehindLeader = leaderTotal - row.totalPoints;
  return rows;
}
