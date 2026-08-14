import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import TeamNameForm from "@/components/league/TeamNameForm";
import { createClient } from "@/lib/supabase/server";
import { getDraftParticipants, getDraftPicks, getLeagueDraft, getMemberDraftSlot } from "@/services/draftService";
import { getLeagueRoster } from "@/services/membershipService";
import { getActiveTeams } from "@/services/teamService";

export default async function LeaguePage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/league/${leagueId}`)}`);

  const { data: league } = await supabase.from("leagues").select("*").eq("id", leagueId).maybeSingle();
  if (!league) notFound();
  const { data: membership } = await supabase.from("league_members").select("*").eq("league_id", leagueId).eq("user_id", user.id).maybeSingle();
  if (!membership) notFound();

  const roster = await getLeagueRoster(supabase, league.id);
  const draft = await getLeagueDraft(supabase, league.id);
  const [participants, mySlot] = draft
    ? await Promise.all([
        getDraftParticipants(supabase, draft.id, roster.members),
        getMemberDraftSlot(supabase, draft.id, membership.id),
      ])
    : [[], null];
  const teams = draft ? await getActiveTeams(supabase) : [];
  const picks = draft ? await getDraftPicks(supabase, draft.id, participants, teams) : [];
  const myPicks = picks.filter((pick) => pick.league_member_id === membership.id);
  const draftStatus = !draft
    ? "Not Set Up"
    : draft.status === "not_started"
      ? "Ready"
      : draft.status.charAt(0).toUpperCase() + draft.status.slice(1);
  const draftIsPrimary = draft?.status === "live";
  const draftActionLabel = draft?.status === "complete" ? "View Draft Results" : "Enter Draft Room";

  return (
    <main className="min-h-screen bg-slate-100">
      <header className="bg-blue-950 text-white"><div className="mx-auto flex max-w-6xl flex-col justify-between gap-4 px-6 py-6 sm:flex-row sm:items-center"><div><p className="text-sm text-blue-200">{league.season} College Football Pool</p><h1 className="text-3xl font-bold">{league.name}</h1></div>{league.commissioner_id === user.id && <Link href="/commissioner" className="rounded-lg bg-white px-4 py-2 text-center font-bold text-blue-950 transition hover:bg-blue-100">Commissioner Admin</Link>}</div></header>
      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-3">
        <section className="space-y-6 lg:col-span-2">
          <nav className="grid gap-3 sm:grid-cols-3" aria-label="League navigation">
            <Link href={`/league/${league.id}/standings`} className="rounded-xl bg-purple-600 px-4 py-3 text-center font-bold text-white shadow hover:bg-purple-700">Standings</Link>
            <Link href={`/league/${league.id}/score`} className="rounded-xl bg-green-700 px-4 py-3 text-center font-bold text-white shadow hover:bg-green-800">My Score</Link>
            {draft && draft.status !== "not_started" ? <Link href={`/draft/${draft.id}`} className="rounded-xl bg-orange-500 px-4 py-3 text-center font-bold text-white shadow hover:bg-orange-600">Draft Results</Link> : <span className="rounded-xl bg-slate-300 px-4 py-3 text-center font-bold text-slate-600">Draft Results</span>}
          </nav>
          <div className={`${draftIsPrimary ? "border-2 border-orange-500 shadow-xl shadow-orange-100" : "shadow"} rounded-xl bg-white p-6`}>
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <h2 className="text-2xl font-bold">Draft</h2>
              {draftIsPrimary && <span className="w-fit rounded-full bg-orange-100 px-3 py-1 text-sm font-black uppercase tracking-wide text-orange-700">Live Now</span>}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg bg-slate-100 p-3"><p className="text-xs text-slate-500">Status</p><p className="font-bold">{draftStatus}</p></div>
              <div className="rounded-lg bg-slate-100 p-3"><p className="text-xs text-slate-500">Your position</p><p className="font-bold">{mySlot ? `#${mySlot.draft_position}` : "TBD"}</p></div>
              <div className="rounded-lg bg-slate-100 p-3"><p className="text-xs text-slate-500">Rounds</p><p className="font-bold">{league.teams_per_owner}</p></div>
              <div className="rounded-lg bg-slate-100 p-3"><p className="text-xs text-slate-500">Your picks</p><p className="font-bold">{myPicks.length}</p></div>
            </div>
            {draft?.status === "not_started" && (
              <p className="mt-5 rounded-lg bg-blue-50 p-4 font-medium text-blue-800">Draft order is ready. The draft has not started yet.</p>
            )}
            {draft?.status === "paused" && (
              <p className="mt-5 rounded-lg bg-amber-50 p-4 font-bold text-amber-800">Draft Paused — you can still enter and review the board.</p>
            )}
            {draft && draft.status !== "not_started" && (
              <Link
                href={`/draft/${draft.id}`}
                className={`${draftIsPrimary ? "bg-orange-500 px-7 py-4 text-lg shadow-lg hover:bg-orange-600" : "bg-blue-700 px-5 py-3 hover:bg-blue-800"} mt-5 block rounded-lg text-center font-bold text-white transition sm:inline-block`}
              >
                {draftActionLabel} →
              </Link>
            )}
          </div>
          <div className="rounded-xl bg-white p-6 shadow"><h2 className="text-xl font-bold">Your College Teams</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{myPicks.length ? myPicks.map((pick) => <div key={pick.id} className="rounded-lg bg-slate-100 p-4"><p className="font-bold">{pick.team.school_name}</p><p className="text-sm text-slate-500">Round {pick.round_number} · Pick {pick.overall_pick}</p></div>) : <p className="text-slate-500">No teams drafted yet.</p>}</div></div>
        </section>
        <aside className="space-y-6">
          <div className="rounded-xl bg-white p-6 shadow"><TeamNameForm leagueId={league.id} initialName={membership.team_name} /></div>
          <div className="rounded-xl bg-white p-6 shadow"><h2 className="text-xl font-bold">League Roster</h2><div className="mt-4 space-y-3">{roster.members.map((member) => <div key={member.id}><p className="font-semibold">{member.profile?.display_name ?? "Owner"}</p><p className="text-sm text-slate-500">{member.team_name ?? "Team name not set"}</p></div>)}</div></div>
          {league.commissioner_id === user.id && <Link href="/commissioner" className="block rounded-lg border-2 border-blue-700 px-4 py-3 text-center font-bold text-blue-800 hover:bg-blue-50">Commissioner Admin</Link>}
        </aside>
      </div>
    </main>
  );
}
