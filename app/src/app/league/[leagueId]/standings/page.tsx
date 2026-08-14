import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import ScoreActivityFeed from "@/components/scoring/ScoreActivityFeed";
import { createClient } from "@/lib/supabase/server";
import { getLeagueStandings } from "@/services/standingsService";

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

  return (
    <main className="min-h-screen bg-slate-100">
      <header className="bg-blue-950 text-white"><div className="mx-auto max-w-6xl px-6 py-6"><Link href={`/league/${leagueId}`} className="text-sm text-blue-200 hover:text-white">← League Home</Link><h1 className="mt-2 text-3xl font-bold">{league.name} Standings</h1><p className="text-slate-300">{league.season} season · Scores derived from the event ledger</p></div></header>
      <div className="mx-auto max-w-6xl space-y-8 px-6 py-8">
        <section className="rounded-xl bg-white p-6 shadow">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="text-2xl font-bold">Season Standings</h2><p className="text-sm text-slate-500">Equal totals share the same rank. No tiebreaker is applied.</p></div><form><label htmlFor="week" className="mr-2 text-sm font-semibold">Weekly points</label><select id="week" name="week" defaultValue={standings.selectedWeek} className="rounded-lg border border-slate-300 px-3 py-2">{standings.availableWeeks.length ? standings.availableWeeks.map((week) => <option key={week} value={week}>Week {week}</option>) : <option value={1}>Week 1</option>}</select><button className="ml-2 rounded-lg bg-blue-700 px-3 py-2 font-semibold text-white">View</button></form></div>
          <div className="mt-6 overflow-x-auto"><table className="w-full text-left"><thead className="border-b text-sm text-slate-500"><tr><th className="p-3">Rank</th><th className="p-3">Owner / Pool Team</th><th className="p-3 text-right">Season Total</th><th className="p-3 text-right">Week {standings.selectedWeek}</th><th className="p-3 text-right">Drafted Teams</th></tr></thead><tbody>{standings.rows.map((row) => <tr key={row.memberId} className="border-b last:border-0"><td className="p-3 text-xl font-black">{row.rank}</td><td className="p-3"><p className="font-bold">{row.poolTeamName ?? row.ownerName}</p><p className="text-sm text-slate-500">{row.ownerName}</p></td><td className="p-3 text-right text-xl font-black">{row.totalPoints}</td><td className="p-3 text-right font-bold">{row.weeklyPoints > 0 ? "+" : ""}{row.weeklyPoints}</td><td className="p-3 text-right">{row.draftedTeamCount}</td></tr>)}</tbody></table></div>
        </section>
        <section><h2 className="mb-4 text-2xl font-bold">Recent Score Activity</h2><ScoreActivityFeed events={standings.events} limit={10} /></section>
      </div>
    </main>
  );
}
