import { notFound, redirect } from "next/navigation";

import ScoringDashboard from "@/components/commissioner/ScoringDashboard";
import { createClient } from "@/lib/supabase/server";
import { getLeagueDraft } from "@/services/draftService";
import { getLeagueGames } from "@/services/gameService";
import { getLeagueRoster } from "@/services/membershipService";
import { getDraftedScoringTeams, getLeagueScoringEvents, getScoringRules } from "@/services/scoringService";
import { getLeagueStandings } from "@/services/standingsService";
import { getActiveTeams } from "@/services/teamService";
import { getCfbdConfigurationStatus, getExternalSyncRuns } from "@/services/cfbdService";
import { getRecapOperations } from "@/services/recapService";
import { getLiveScoreboardPollRuns } from "@/services/liveScoreboardService";

export default async function CommissionerLeagueScoringPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/commissioner/${leagueId}/scoring`)}`);
  const { data: league } = await supabase.from("leagues").select("*").eq("id", leagueId).eq("commissioner_id", user.id).maybeSingle();
  if (!league) notFound();
  const roster = await getLeagueRoster(supabase, league.id);
  const draft = await getLeagueDraft(supabase, league.id);
  const teams = await getActiveTeams(supabase);
  const picks = draft ? await getDraftedScoringTeams(supabase, draft.id, teams) : [];
  const [rules, events, games, standings, syncRuns, recapOperations, livePollRuns] = await Promise.all([
    getScoringRules(supabase, league.id), getLeagueScoringEvents(supabase, league.id, { includeVoided: true }),
    getLeagueGames(supabase, league.id), getLeagueStandings(supabase, league.id), getExternalSyncRuns(supabase, league.id), getRecapOperations(supabase, league.id), getLiveScoreboardPollRuns(supabase),
  ]);
  const draftedTeams = picks.map((pick) => ({ team: pick.team, ownerMemberId: pick.pick.league_member_id, ownerName: roster.members.find((member) => member.id === pick.pick.league_member_id)?.profile?.display_name ?? "Owner", poolTeamName: roster.members.find((member) => member.id === pick.pick.league_member_id)?.team_name ?? null })).sort((a, b) => a.team.school_name.localeCompare(b.team.school_name));
  return <ScoringDashboard league={league} rules={rules} events={events} games={games} standings={standings} draftedTeams={draftedTeams} teams={teams} cfbdConfiguration={getCfbdConfigurationStatus()} syncRuns={syncRuns} livePollRuns={livePollRuns} recapOperations={recapOperations} />;
}
