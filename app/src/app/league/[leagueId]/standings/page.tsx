import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import ScoreActivityFeed from "@/components/scoring/ScoreActivityFeed";
import TeamLogo from "@/components/team/TeamLogo";
import { favoriteTeamTheme } from "@/lib/league/favorite-team-theme";
import { createClient } from "@/lib/supabase/server";
import { getLeagueStandings } from "@/services/standingsService";

function points(value: number) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function placeLabel(rank: number, tied: boolean) {
  return `${tied ? "T-" : ""}${rank}`;
}

function placeStyle(rank: number) {
  if (rank === 1) return "border-amber-300 bg-amber-400 text-amber-950 shadow-amber-200";
  if (rank === 2) return "border-slate-300 bg-slate-200 text-slate-800 shadow-slate-200";
  if (rank === 3) return "border-orange-300 bg-orange-200 text-orange-950 shadow-orange-200";
  return "border-blue-900 bg-blue-950 text-white shadow-blue-950/20";
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

        <section className="rounded-2xl bg-white p-4 shadow sm:p-6" aria-labelledby="leaderboard-heading">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div><p className="text-xs font-black uppercase tracking-widest text-orange-600">League race</p><h2 id="leaderboard-heading" className="mt-1 text-2xl font-black">Leaderboard</h2><p className="mt-1 text-sm text-slate-500">Equal totals share a place. Total points remain the official order.</p></div>
            <form className="flex items-end gap-2">
              <label htmlFor="week" className="min-w-0 flex-1 text-sm font-bold text-slate-600">Weekly view<select id="week" name="week" defaultValue={standings.selectedWeek} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950">{standings.availableWeeks.length ? standings.availableWeeks.map((week) => <option key={week} value={week}>Week {week}</option>) : <option value={1}>Week 1</option>}</select></label>
              <button className="rounded-lg bg-blue-800 px-4 py-2 font-black text-white hover:bg-blue-900">View</button>
            </form>
          </div>

          <div className="mt-6 space-y-3">
            {standings.rows.map((row) => {
              const isCurrentOwner = row.userId === user.id;
              const tied = (rankCounts.get(row.rank) ?? 0) > 1;
              const theme = favoriteTeamTheme(row.favoriteTeam);
              return (
                <article
                  key={row.memberId}
                  className={`${isCurrentOwner ? "ring-2 ring-blue-700 ring-offset-2" : ""} relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm`}
                  style={{ borderLeftWidth: 6, borderLeftColor: row.favoriteTeam ? theme.primary : "#172554", backgroundImage: row.favoriteTeam ? `linear-gradient(105deg, ${theme.primary}12 0%, transparent 38%)` : undefined }}
                  aria-label={`${placeLabel(row.rank, tied)} place, ${row.poolTeamName ?? row.ownerName}, ${row.totalPoints} points${isCurrentOwner ? ", you" : ""}`}
                >
                  <div className="grid gap-4 p-4 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto] sm:items-center sm:p-5">
                    <div className="flex items-center justify-between sm:block">
                      <span className={`${placeStyle(row.rank)} inline-flex h-14 min-w-14 items-center justify-center rounded-xl border px-2 font-mono text-2xl font-black shadow-lg`}>{placeLabel(row.rank, tied)}</span>
                      {isCurrentOwner && <span className="rounded-full bg-blue-800 px-3 py-1 text-xs font-black uppercase tracking-wider text-white sm:hidden">You</span>}
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-xl font-black text-blue-950">{row.poolTeamName ?? row.ownerName}</h3>{isCurrentOwner && <span className="hidden rounded-full bg-blue-800 px-2.5 py-1 text-[0.65rem] font-black uppercase tracking-wider text-white sm:inline">You</span>}</div>
                      <p className="text-sm font-semibold text-slate-500">{row.poolTeamName ? row.ownerName : "Pool owner"}</p>
                      {row.favoriteTeam && <div className="mt-2 flex items-center gap-2 text-sm font-bold" style={{ color: theme.primaryText }}><TeamLogo team={row.favoriteTeam} size="sm" decorative /><span>{row.favoriteTeam.school_name}</span></div>}
                    </div>

                    <div className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-4 text-right sm:block sm:border-0 sm:pt-0">
                      <div><p className="text-4xl font-black leading-none text-blue-950">{row.totalPoints}</p><p className="mt-1 text-xs font-bold uppercase tracking-wider text-slate-500">Total points</p></div>
                      <div className="sm:mt-3"><p className={`${row.weeklyPoints < 0 ? "text-red-700" : row.weeklyPoints > 0 ? "text-green-700" : "text-slate-600"} text-xl font-black`}>{points(row.weeklyPoints)}</p><p className="text-xs text-slate-500">Week {standings.selectedWeek}</p></div>
                    </div>
                  </div>

                  <div className="grid gap-3 border-t border-slate-200 bg-slate-50/70 px-4 py-3 text-sm sm:grid-cols-3 sm:px-5">
                    <p><span className="font-black text-slate-900">Race:</span> <span className="text-slate-600">{row.pointsBehindLeader === 0 ? (tied ? "Tied for the lead" : "Leading") : `${row.pointsBehindLeader} back`}</span></p>
                    <p><span className="font-black text-slate-900">Latest:</span> <span className="text-slate-600">{row.latestEvent ? `${points(row.latestEvent.points)} · ${row.latestEvent.team.school_name} ${row.latestEvent.rule.display_name}` : "No scoring yet"}</span></p>
                    <p><span className="font-black text-slate-900">Top team:</span> <span className="text-slate-600">{row.strongestTeam ? `${row.strongestTeam.team.school_name} (${points(row.strongestTeam.points)})` : row.draftedTeamCount ? "No points yet" : "Draft pending"}</span></p>
                  </div>

                  <details className="border-t border-slate-200 px-4 py-3 sm:px-5">
                    <summary className="cursor-pointer text-sm font-black text-blue-800">View roster · {row.draftedTeamCount} teams</summary>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{row.draftedTeams.length ? row.draftedTeams.map((team) => <div key={team.id} className="flex min-w-0 items-center gap-2 rounded-lg bg-slate-100 p-2"><TeamLogo team={team} size="sm" decorative /><span className="truncate text-sm font-bold">{team.school_name}</span></div>) : <p className="text-sm text-slate-500">No teams drafted yet.</p>}</div>
                  </details>
                </article>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="activity-heading"><div className="mb-4"><p className="text-xs font-black uppercase tracking-widest text-orange-600">Why scores are moving</p><h2 id="activity-heading" className="mt-1 text-2xl font-black">Recent League Activity</h2></div><ScoreActivityFeed events={standings.events} limit={10} /></section>
      </div>
    </main>
  );
}
