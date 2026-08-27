import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import TeamLogo from "@/components/team/TeamLogo";
import { createClient } from "@/lib/supabase/server";
import { getMemberScoreBreakdown } from "@/services/standingsService";

export default async function MyScorePage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/league/${leagueId}/score`)}`);
  const [{ data: league }, { data: membership }] = await Promise.all([
    supabase.from("leagues").select("*").eq("id", leagueId).maybeSingle(),
    supabase.from("league_members").select("*").eq("league_id", leagueId).eq("user_id", user.id).maybeSingle(),
  ]);
  if (!league || !membership) notFound();
  const teams = await getMemberScoreBreakdown(supabase, leagueId, membership.id);
  const total = teams.reduce((sum, team) => sum + team.totalPoints, 0);
  const activeEvents = teams.reduce((sum, team) => sum + team.events.filter((event) => event.counts_for_standings !== false).length, 0);
  const contributingTeams = teams.filter((team) => team.totalPoints !== 0).length;

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b-4 border-orange-500 bg-blue-950 text-white">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
          <Link href={`/league/${leagueId}`} className="inline-flex min-h-11 items-center text-sm font-bold text-blue-200 hover:text-white">← League Home</Link>
          <div className="mt-3 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div><p className="text-xs font-black uppercase tracking-[0.22em] text-orange-300">My scoring ledger</p><h1 className="mt-1 text-3xl font-black sm:text-4xl">{membership.team_name ?? "My Pool Team"}</h1><p className="mt-1 text-blue-200">{league.name} · {league.season} season</p></div>
            <div className="sm:text-right"><p className="text-6xl font-black leading-none">{total}</p><p className="mt-1 text-xs font-black uppercase tracking-wider text-blue-200">Total points</p></div>
          </div>
          <div className="mt-6 grid grid-cols-3 gap-2 border-t border-white/10 pt-5 sm:max-w-xl sm:gap-4">
            <div><p className="text-2xl font-black">{teams.length}</p><p className="text-xs text-blue-200">Teams owned</p></div>
            <div><p className="text-2xl font-black">{activeEvents}</p><p className="text-xs text-blue-200">Score events</p></div>
            <div><p className="text-2xl font-black">{contributingTeams}</p><p className="text-xs text-blue-200">Contributing</p></div>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-xs font-black uppercase tracking-widest text-orange-600">Team by team</p><h2 className="mt-1 text-2xl font-black text-blue-950">Where your points come from</h2></div><Link href={`/league/${leagueId}/standings`} className="inline-flex min-h-11 items-center font-bold text-blue-800 hover:text-blue-950">View league standings →</Link></div>
        {teams.length ? teams.map((teamScore) => (
          <details key={teamScore.team.id} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm open:shadow-md">
            <summary className="flex min-h-20 cursor-pointer list-none items-center justify-between gap-4 p-4 transition hover:bg-slate-50 sm:p-5"><div className="flex min-w-0 items-center gap-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100"><TeamLogo team={teamScore.team} size="md" decorative /></span><div className="min-w-0"><h3 className="truncate text-lg font-black text-blue-950 sm:text-xl">{teamScore.team.school_name}</h3><p className="text-sm text-slate-500">{teamScore.events.length ? `${teamScore.events.length} scoring event${teamScore.events.length === 1 ? "" : "s"} · tap for details` : "No scoring activity yet"}</p></div></div><div className="shrink-0 text-right"><span className={`${teamScore.totalPoints > 0 ? "text-green-700" : teamScore.totalPoints < 0 ? "text-red-700" : "text-slate-700"} text-3xl font-black`}>{teamScore.totalPoints > 0 ? "+" : ""}{teamScore.totalPoints}</span><span className="ml-2 inline-block text-slate-400 transition group-open:rotate-90" aria-hidden="true">›</span></div></summary>
            <div className="space-y-5 border-t px-4 pb-5 pt-5 sm:px-5">{teamScore.benchPoints !== 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-900">Bench · {teamScore.benchPoints > 0 ? "+" : ""}{teamScore.benchPoints} potential points · 0 counted</p>}{teamScore.events.length ? [...new Set(teamScore.events.map((event) => event.week))].sort((a, b) => (a ?? 999) - (b ?? 999)).map((week) => <div key={week ?? "season"}><h4 className="mb-2 text-sm font-black uppercase tracking-wide text-slate-500">{week !== null ? `Week ${week}` : "Season"}</h4>{teamScore.events.filter((event) => event.week === week).map((event) => { const counts = event.counts_for_standings !== false; return <div key={event.id} className="flex justify-between gap-4 border-b py-2 last:border-0"><div className="min-w-0"><p className="font-semibold">{event.rule.display_name}</p><p className={`text-xs font-black uppercase ${counts ? "text-green-700" : "text-amber-800"}`}>{counts ? "Starter · Counted" : `Bench · ${event.points > 0 ? "+" : ""}${event.points} potential · 0 counted`}</p>{event.notes && <p className="text-sm text-slate-500">{event.notes}</p>}</div><span className={`${counts ? event.points > 0 ? "text-green-700" : event.points < 0 ? "text-red-700" : "text-slate-600" : "text-slate-400"} shrink-0 font-black`}>{counts ? `${event.points > 0 ? "+" : ""}${event.points}` : "0"}</span></div>; })}</div>) : <p className="text-slate-500">No scoring events yet.</p>}</div>
          </details>
        )) : <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-7 text-center shadow-sm"><h2 className="text-xl font-black text-blue-950">Your scorecard is waiting for draft night</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">Once your college teams are drafted, their scoring activity will appear here automatically.</p><Link href={`/league/${leagueId}`} className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-blue-900 px-5 py-2.5 font-black text-white hover:bg-blue-950">Return to League Home</Link></section>}
      </div>
    </main>
  );
}
