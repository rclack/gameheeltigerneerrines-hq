import Link from "next/link";
import { notFound, redirect } from "next/navigation";

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

  return (
    <main className="min-h-screen bg-slate-100">
      <header className="bg-blue-950 text-white"><div className="mx-auto max-w-5xl px-6 py-6"><Link href={`/league/${leagueId}`} className="text-sm text-blue-200 hover:text-white">← League Home</Link><p className="mt-3 text-sm uppercase tracking-widest text-blue-200">Total Score</p><h1 className="text-5xl font-black">{total}</h1><p className="mt-1 text-slate-300">{membership.team_name ?? "My Pool Team"} · {league.season}</p></div></header>
      <div className="mx-auto max-w-5xl space-y-4 px-6 py-8">
        {teams.length ? teams.map((teamScore) => (
          <details key={teamScore.team.id} className="group rounded-xl bg-white p-5 shadow">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4"><div><h2 className="text-xl font-bold">{teamScore.team.school_name}</h2><p className="text-sm text-slate-500">{teamScore.events.length} scoring event{teamScore.events.length === 1 ? "" : "s"}</p></div><span className={`${teamScore.totalPoints >= 0 ? "text-green-700" : "text-red-700"} text-2xl font-black`}>{teamScore.totalPoints > 0 ? "+" : ""}{teamScore.totalPoints}</span></summary>
            <div className="mt-5 space-y-5 border-t pt-5">{teamScore.events.length ? [...new Set(teamScore.events.map((event) => event.week))].sort((a, b) => (a ?? 999) - (b ?? 999)).map((week) => <div key={week ?? "season"}><h3 className="mb-2 text-sm font-black uppercase tracking-wide text-slate-500">{week ? `Week ${week}` : "Season"}</h3>{teamScore.events.filter((event) => event.week === week).map((event) => <div key={event.id} className="flex justify-between border-b py-2 last:border-0"><div><p className="font-semibold">{event.rule.display_name}</p>{event.notes && <p className="text-sm text-slate-500">{event.notes}</p>}</div><span className={`${event.points > 0 ? "text-green-700" : "text-red-700"} font-black`}>{event.points > 0 ? "+" : ""}{event.points}</span></div>)}</div>) : <p className="text-slate-500">No scoring events yet.</p>}</div>
          </details>
        )) : <p className="rounded-xl bg-white p-6 text-slate-500 shadow">No teams have been drafted for you yet.</p>}
      </div>
    </main>
  );
}
