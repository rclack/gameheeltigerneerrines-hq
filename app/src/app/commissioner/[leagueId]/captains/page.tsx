import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import CaptainCorrections, { type CaptainCorrectionLineup } from "@/components/commissioner/CaptainCorrections";
import { createClient } from "@/lib/supabase/server";

export default async function CaptainCorrectionsPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/commissioner/${leagueId}/captains`)}`);
  const { data: league } = await supabase.from("leagues").select("id,name").eq("id", leagueId).eq("commissioner_id", user.id).maybeSingle();
  if (!league) notFound();
  const { data: lineups, error } = await supabase.from("weekly_lineups").select("id,week,league_member_id").eq("league_id", leagueId).order("week", { ascending: false });
  if (error) throw error;
  const memberIds = [...new Set(lineups.map((lineup) => lineup.league_member_id))];
  const [{ data: members }, { data: entries, error: entriesError }] = await Promise.all([
    supabase.from("league_members").select("id,team_name").in("id", memberIds),
    supabase.from("weekly_lineup_entries").select("id,weekly_lineup_id,team_id,status,is_captain,captain_locked_at").in("weekly_lineup_id", lineups.map((lineup) => lineup.id)),
  ]);
  if (entriesError) throw entriesError;
  const teamIds = [...new Set(entries.map((entry) => entry.team_id))];
  const { data: teams, error: teamsError } = await supabase.from("teams").select("id,school_name").in("id", teamIds);
  if (teamsError) throw teamsError;
  const memberNames = new Map((members ?? []).map((member) => [member.id, member.team_name ?? "Owner"]));
  const teamNames = new Map(teams.map((team) => [team.id, team.school_name]));
  const rows: CaptainCorrectionLineup[] = lineups.map((lineup) => ({
    id: lineup.id, week: lineup.week, ownerName: memberNames.get(lineup.league_member_id) ?? "Owner",
    entries: entries.filter((entry) => entry.weekly_lineup_id === lineup.id).map((entry) => ({ id: entry.id, teamName: teamNames.get(entry.team_id) ?? "Team", status: entry.status, isCaptain: entry.is_captain, captainLockedAt: entry.captain_locked_at })),
  }));
  return <main className="min-h-screen bg-slate-100 p-4 text-slate-950 sm:p-8"><div className="mx-auto max-w-4xl"><Link href={`/commissioner/${leagueId}/scoring`} className="font-bold text-blue-800">← Scoring Dashboard</Link><h1 className="mt-4 text-3xl font-black text-blue-950">Captain Corrections</h1><p className="mt-2 text-slate-700">{league.name} · Every correction requires a reason, preserves audit history, and stales affected game scoring for controlled reprocessing.</p><div className="mt-6"><CaptainCorrections leagueId={leagueId} lineups={rows}/></div></div></main>;
}
