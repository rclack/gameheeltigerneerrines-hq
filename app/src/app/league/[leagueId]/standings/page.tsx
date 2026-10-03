import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import StandingsLeaderboard from "@/components/league/StandingsLeaderboard";
import ScoreActivityFeed from "@/components/scoring/ScoreActivityFeed";
import { createClient } from "@/lib/supabase/server";
import { getLeagueStandings } from "@/services/standingsService";

function points(value: number) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function placeLabel(rank: number, tied: boolean) {
  return `${tied ? "T-" : ""}${rank}`;
}

export default async function StandingsPage({ params, searchParams }: { params: Promise<{ leagueId: string }>; searchParams: Promise<{ week?: string }> }) {
  const { leagueId } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/league/${leagueId}/standings`)}`);
  const { data: league } = await supabase.from("leagues").select("*").eq("id", leagueId).maybeSingle();
  if (!league) notFound();
  const requestedWeek = query.week ? Number(query.week) : undefined;
  const standings = await getLeagueStandings(supabase, leagueId, Number.isInteger(requestedWeek) ? requestedWeek : undefined);
  const currentOwner = standings.rows.find((row) => row.userId === user.id) ?? null;
  const leaders = standings.rows.filter((row) => row.rank === 1);
  const rankCounts = new Map<number, number>();
  for (const row of standings.rows) rankCounts.set(row.rank, (rankCounts.get(row.rank) ?? 0) + 1);

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b-4 border-orange-500 bg-blue-950 text-white">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          <Link href={`/league/${leagueId}`} className="text-sm font-bold text-blue-200 hover:text-white">← League Home</Link>
          <div className="mt-4 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div><p className="text-xs font-black uppercase tracking-[0.22em] text-orange-300">Saturday Scoreboard</p><h1 className="mt-1 text-3xl font-black sm:text-4xl">{league.name} Standings</h1><p className="mt-1 text-blue-200">{league.season} season · Active scoring ledger</p></div>
            <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 sm:max-w-sm sm:text-right"><p className="text-xs font-black uppercase tracking-wider text-orange-300">{leaders.length > 1 ? "Tied for the lead" : "League leader"}</p><p className="mt-1 font-black">{leaders.map((row) => row.poolTeamName ?? row.ownerName).join(" · ") || "Season pending"}</p><p className="text-sm text-blue-200">{leaders[0]?.totalPoints ?? 0} points</p></div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:px-6 sm:py-8">
        {currentOwner && (
          <section className="grid gap-4 rounded-2xl border-2 border-blue-800 bg-white p-5 shadow-lg sm:grid-cols-[1fr_auto] sm:items-center" aria-labelledby="your-standing-heading">
            <div><p className="text-xs font-black uppercase tracking-widest text-orange-600">Your position</p><h2 id="your-standing-heading" className="mt-1 text-2xl font-black">{placeLabel(currentOwner.rank, (rankCounts.get(currentOwner.rank) ?? 0) > 1)} place · {currentOwner.totalPoints} points</h2><p className="mt-1 text-sm text-slate-600">{currentOwner.pointsBehindLeader === 0 ? "You are setting the pace." : `${currentOwner.pointsBehindLeader} ${currentOwner.pointsBehindLeader === 1 ? "point" : "points"} behind the lead.`}</p></div>
            <div className="grid grid-cols-2 gap-2 text-center"><div className="rounded-lg bg-blue-50 px-4 py-3"><p className="text-xl font-black text-blue-950">{points(currentOwner.weeklyPoints)}</p><p className="text-xs text-slate-500">Week {standings.selectedWeek}</p></div><div className="rounded-lg bg-slate-100 px-4 py-3"><p className="text-xl font-black">{currentOwner.activeEventCount}</p><p className="text-xs text-slate-500">Score events</p></div></div>
          </section>
        )}

        <StandingsLeaderboard
          leagueId={leagueId}
          rows={standings.rows.map((row) => ({
            rank: row.rank, memberId: row.memberId, userId: row.userId, ownerName: row.ownerName, poolTeamName: row.poolTeamName,
            totalPoints: row.totalPoints, weeklyPoints: row.weeklyPoints, draftedTeamCount: row.draftedTeamCount,
            draftedTeams: row.draftedTeams, favoriteTeam: row.favoriteTeam, pointsBehindLeader: row.pointsBehindLeader,
            latestEvent: row.latestEvent ? { points: row.latestEvent.points, teamName: row.latestEvent.team.school_name, ruleName: row.latestEvent.rule.display_name } : null,
            strongestTeam: row.strongestTeam ? { teamName: row.strongestTeam.team.school_name, points: row.strongestTeam.points } : null,
          }))}
          currentUserId={user.id}
          selectedWeek={standings.selectedWeek}
          availableWeeks={standings.availableWeeks}
        />

        <section aria-labelledby="activity-heading"><div className="mb-4"><p className="text-xs font-black uppercase tracking-widest text-orange-600">Why scores are moving</p><h2 id="activity-heading" className="mt-1 text-2xl font-black">Recent League Activity</h2></div><ScoreActivityFeed events={standings.events} limit={10} /></section>
      </div>
    </main>
  );
}
