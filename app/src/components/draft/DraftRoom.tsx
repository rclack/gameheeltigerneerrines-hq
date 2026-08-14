"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { setDraftPausedAction } from "@/app/commissioner/draft-actions";
import { submitPickAction } from "@/app/draft/[draftId]/actions";
import { addQueueTeamAction, moveQueueTeamAction, removeQueueTeamAction } from "@/app/draft/[draftId]/queue-actions";
import { createClient } from "@/lib/supabase/client";
import type { DraftRoomData } from "@/services/draftService";

export default function DraftRoom({ data }: { data: DraftRoomData }) {
  const router = useRouter();
  const previousStatus = useRef(data.draft.status);
  const [search, setSearch] = useState("");
  const [conference, setConference] = useState("All");
  const [pendingTeam, setPendingTeam] = useState<string | null>(null);
  const [queuePending, setQueuePending] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissedTurn, setDismissedTurn] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  const currentParticipant = data.participants.find((participant) => participant.draft_position === data.draft.current_pick);
  const isMyTurn = data.draft.status === "live" && currentParticipant?.member.user_id === data.currentUserId;
  const isCommissioner = data.league.commissioner_id === data.currentUserId;
  const mutationsEnabled = data.draft.status !== "complete";
  const pickedTeamIds = useMemo(() => new Set(data.picks.map((pick) => pick.team_id)), [data.picks]);
  const activeQueue = useMemo(() => data.queue.filter((item) => !pickedTeamIds.has(item.team_id)), [data.queue, pickedTeamIds]);
  const queuedTeamIds = useMemo(() => new Set(activeQueue.map((item) => item.team_id)), [activeQueue]);
  const conferences = useMemo(() => ["All", ...Array.from(new Set(data.teams.map((team) => team.conference))).sort()], [data.teams]);
  const availableTeams = useMemo(() => data.teams.filter((team) => {
    const query = search.trim().toLowerCase();
    return !pickedTeamIds.has(team.id)
      && (conference === "All" || team.conference === conference)
      && (!query || team.school_name.toLowerCase().includes(query) || team.abbreviation.toLowerCase().includes(query));
  }), [conference, data.teams, pickedTeamIds, search]);
  const turnKey = `${data.draft.current_round}-${data.draft.current_pick}`;

  useEffect(() => {
    const supabase = createClient();
    const refresh = () => router.refresh();
    const channel = supabase.channel(`draft-${data.draft.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_picks", filter: `draft_id=eq.${data.draft.id}` }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "drafts", filter: `id=eq.${data.draft.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_queue_items", filter: `draft_id=eq.${data.draft.id}` }, refresh)
      .subscribe();
    const poll = window.setInterval(refresh, 5000);
    return () => { window.clearInterval(poll); void supabase.removeChannel(channel); };
  }, [data.draft.id, router]);

  useEffect(() => {
    if (previousStatus.current !== "complete" && data.draft.status === "complete") setCompleting(true);
    previousStatus.current = data.draft.status;
  }, [data.draft.status]);

  useEffect(() => {
    if (!completing) return;
    const destination = isCommissioner ? "/commissioner" : `/league/${data.league.id}`;
    const timer = window.setTimeout(() => router.push(destination), 3000);
    return () => window.clearTimeout(timer);
  }, [completing, data.league.id, isCommissioner, router]);

  async function draftTeam(teamId: string) {
    if (!isMyTurn || pendingTeam) return;
    setPendingTeam(teamId); setError(null); setMessage(null);
    const result = await submitPickAction(data.draft.id, teamId);
    setError(result.error ?? null); setMessage(result.success ?? null); setPendingTeam(null);
    router.refresh();
  }

  async function updateQueue(key: string, action: () => Promise<{ error?: string; success?: string }>) {
    if (queuePending || !mutationsEnabled) return;
    setQueuePending(key); setError(null); setMessage(null);
    const result = await action();
    setError(result.error ?? null); setMessage(result.success ?? null); setQueuePending(null); router.refresh();
  }

  async function togglePause(paused: boolean) {
    if (actionPending) return;
    setActionPending(true); setError(null); setMessage(null);
    const result = await setDraftPausedAction(data.league.id, data.draft.id, paused);
    setError(result.error ?? null); setMessage(result.success ?? null); setActionPending(false); router.refresh();
  }

  function dismissQueuePrompt() { setDismissedTurn(turnKey); }

  const recentPicks = data.draft.status === "complete" ? [...data.picks].reverse() : [...data.picks].reverse().slice(0, 8);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-blue-950"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-4 px-4 py-4 sm:flex-row sm:items-center"><div><Link href={`/league/${data.league.id}`} className="text-sm text-blue-300 hover:text-blue-200">← League Home</Link><h1 className="text-2xl font-black sm:text-3xl">{data.league.name} Draft Room</h1></div><div className="flex items-center gap-3"><span className="rounded-full bg-slate-800 px-3 py-1 text-sm font-bold capitalize">{data.draft.status.replace("_", " ")}</span>{isCommissioner && data.draft.status === "live" && <button disabled={actionPending} onClick={() => togglePause(true)} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-bold">Pause</button>}{isCommissioner && data.draft.status === "paused" && <button disabled={actionPending} onClick={() => togglePause(false)} className="rounded-lg bg-green-600 px-3 py-2 text-sm font-bold">Resume</button>}</div></div></header>

      <section className={`${isMyTurn ? "bg-orange-500 text-slate-950" : "bg-slate-900"} border-b border-slate-800`}><div className="mx-auto max-w-7xl px-4 py-4"><p className="text-xs font-black uppercase tracking-[0.2em]">{data.draft.status === "complete" ? "Draft Complete" : data.draft.status === "paused" ? "Draft Paused" : "On The Clock"}</p><div className="mt-1 flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><p className="text-2xl font-black">{currentParticipant?.profile?.display_name ?? "—"}</p><p className={isMyTurn ? "font-semibold" : "text-slate-400"}>{isMyTurn ? "Your pick — choose a team below" : currentParticipant?.member.team_name ?? "Waiting for the next selection"}</p></div><p className="font-mono text-lg font-bold">Round {data.draft.current_round} · Position {data.draft.current_pick}</p></div></div></section>

      {completing && <div role="status" className="bg-green-600 px-4 py-3 text-center font-bold">Draft complete! Returning to your {isCommissioner ? "commissioner portal" : "league"}…</div>}

      <section className="border-b border-slate-800 bg-slate-900/70"><div className="mx-auto max-w-7xl px-4 py-4"><h2 className="text-sm font-black uppercase tracking-wider text-orange-400">Recent Picks</h2><div className="mt-3 flex gap-3 overflow-x-auto pb-1">{recentPicks.length ? recentPicks.map((pick) => <div key={pick.id} className="min-w-44 rounded-lg border border-slate-700 bg-slate-900 p-3"><div className="flex justify-between gap-3"><span className="font-mono font-black text-orange-400">#{pick.overall_pick}</span><span className="text-xs text-slate-500">Round {pick.round_number}</span></div><p className="mt-1 truncate font-bold">{pick.team.school_name}</p><p className="truncate text-xs text-slate-400">{pick.participant?.profile?.display_name ?? "Owner"}</p></div>) : <p className="text-sm text-slate-500">No picks yet.</p>}</div></div></section>

      {(message || error) && <div className="mx-auto max-w-7xl px-4 pt-4">{message && <p className="rounded-lg bg-green-950 p-3 text-green-200">{message}</p>}{error && <p role="alert" className="rounded-lg bg-red-950 p-3 text-red-200">{error}</p>}</div>}

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_280px]">
        <aside className="order-4 rounded-xl border border-slate-800 bg-slate-900 p-4 lg:order-1 lg:row-span-2"><h2 className="font-black uppercase tracking-wide text-slate-300">Draft Order</h2><div className="mt-3 space-y-2">{data.participants.map((participant) => <div key={participant.id} className={`${participant.draft_position === data.draft.current_pick && data.draft.status !== "complete" ? "border-orange-500 bg-orange-500/10" : "border-slate-800"} rounded-lg border p-2.5`}><div className="flex gap-2"><span className="font-mono font-black text-slate-500">{participant.draft_position}</span><div className="min-w-0"><p className={`${participant.member.user_id === data.currentUserId ? "text-orange-400" : ""} truncate text-sm font-bold`}>{participant.profile?.display_name ?? "Owner"}{participant.member.user_id === data.currentUserId ? " (You)" : ""}</p><p className="truncate text-xs text-slate-500">{participant.member.team_name ?? "Unnamed"}</p></div></div></div>)}</div></aside>

        <section className="order-2 rounded-xl border border-slate-800 bg-slate-900 p-4 lg:order-2"><div className="flex items-center justify-between"><div><h2 className="font-black uppercase tracking-wide text-orange-400">My Queue</h2><p className="text-xs text-slate-500">Private preference list</p></div><span className="rounded-full bg-slate-800 px-2 py-1 text-xs font-bold">{activeQueue.length}</span></div><div className="mt-3 space-y-2">{activeQueue.length ? activeQueue.map((item, index) => <div key={item.id} className="flex items-center gap-2 rounded-lg bg-slate-950 p-2.5"><span className="w-5 font-mono text-sm font-black text-orange-400">{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{item.team.school_name}</p><p className="text-xs text-slate-500">{item.team.conference}</p></div>{mutationsEnabled && <div className="flex gap-1"><button aria-label={`Move ${item.team.school_name} up`} disabled={index === 0 || queuePending !== null} onClick={() => updateQueue(item.id, () => moveQueueTeamAction(data.draft.id, item.id, -1))} className="rounded bg-slate-800 px-2 py-1 text-xs disabled:opacity-30">↑</button><button aria-label={`Move ${item.team.school_name} down`} disabled={index === activeQueue.length - 1 || queuePending !== null} onClick={() => updateQueue(item.id, () => moveQueueTeamAction(data.draft.id, item.id, 1))} className="rounded bg-slate-800 px-2 py-1 text-xs disabled:opacity-30">↓</button><button aria-label={`Remove ${item.team.school_name}`} disabled={queuePending !== null} onClick={() => updateQueue(item.id, () => removeQueueTeamAction(data.draft.id, item.id))} className="rounded bg-red-950 px-2 py-1 text-xs text-red-300">×</button></div>}</div>) : <p className="text-sm text-slate-500">Add available teams below to build your preference list.</p>}</div></section>

        <section className="order-3 min-w-0 lg:order-3"><div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><div className="flex flex-col gap-3 sm:flex-row"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search FBS teams…" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 outline-none focus:border-orange-500" /><select value={conference} onChange={(event) => setConference(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5">{conferences.map((item) => <option key={item}>{item}</option>)}</select></div><p className="mt-2 text-sm text-slate-500">{availableTeams.length} available teams</p></div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">{availableTeams.map((team) => <article key={team.id} className="rounded-lg border border-slate-800 bg-slate-900 p-3 transition hover:border-slate-600"><div className="min-w-0"><p className="truncate text-base font-black">{team.school_name}</p><div className="mt-1 flex items-center gap-2 text-xs"><span className="rounded bg-slate-800 px-2 py-0.5 font-mono font-bold text-orange-300">{team.abbreviation}</span><span className="truncate text-slate-400">{team.conference}</span></div></div><div className="mt-3 flex items-center gap-2"><button disabled={!mutationsEnabled || queuedTeamIds.has(team.id) || queuePending !== null} onClick={() => updateQueue(team.id, () => addQueueTeamAction(data.draft.id, team.id))} className="flex-1 rounded border border-slate-600 px-2 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-40">{queuedTeamIds.has(team.id) ? "Queued" : "+ Queue"}</button><button disabled={!isMyTurn || pendingTeam !== null} onClick={() => draftTeam(team.id)} className="rounded bg-orange-500 px-3 py-1.5 text-xs font-black text-slate-950 hover:bg-orange-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">{pendingTeam === team.id ? "…" : "Draft"}</button></div></article>)}</div>
        </section>

        <aside className="order-5 rounded-xl border border-slate-800 bg-slate-900 p-4 lg:col-start-2 xl:order-4 xl:col-start-3 xl:row-start-1 xl:row-span-2"><h2 className="font-black uppercase tracking-wide text-slate-300">Owner Rosters</h2><div className="mt-4 space-y-4">{data.participants.map((participant) => { const ownerPicks = data.picks.filter((pick) => pick.league_member_id === participant.league_member_id); return <div key={participant.id}><p className="text-sm font-bold">{participant.profile?.display_name ?? "Owner"}</p><p className="text-xs leading-relaxed text-slate-500">{ownerPicks.length ? ownerPicks.map((pick) => pick.team.abbreviation).join(" · ") : "No teams yet"}</p></div>; })}</div></aside>
      </div>

      {isMyTurn && dismissedTurn !== turnKey && activeQueue[0] && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="queue-prompt-title"><div className="w-full max-w-md rounded-2xl border border-orange-500 bg-slate-900 p-6 shadow-2xl"><p className="text-sm font-black uppercase tracking-widest text-orange-400">You&apos;re on the clock!</p><h2 id="queue-prompt-title" className="mt-2 text-2xl font-black">{activeQueue[0].team.school_name} is first in your queue.</h2><p className="mt-2 text-slate-400">Confirm this pick or browse the available teams.</p><div className="mt-6 flex flex-col gap-3 sm:flex-row"><button disabled={pendingTeam !== null} onClick={() => draftTeam(activeQueue[0].team.id)} className="flex-1 rounded-lg bg-orange-500 px-4 py-3 font-black text-slate-950 hover:bg-orange-400 disabled:opacity-50">Draft {activeQueue[0].team.short_name}</button><button onClick={dismissQueuePrompt} className="flex-1 rounded-lg bg-slate-700 px-4 py-3 font-bold hover:bg-slate-600">Choose Another Team</button></div>{error && <p className="mt-4 text-sm text-red-300">{error}</p>}</div></div>}
    </main>
  );
}
