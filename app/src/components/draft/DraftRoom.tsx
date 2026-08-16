"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { setDraftPausedAction } from "@/app/commissioner/draft-actions";
import { submitPickAction } from "@/app/draft/[draftId]/actions";
import { addQueueTeamAction, moveQueueTeamAction, removeQueueTeamAction } from "@/app/draft/[draftId]/queue-actions";
import CompletedDraftResults from "@/components/draft/CompletedDraftResults";
import { createClient } from "@/lib/supabase/client";
import { remainingEligibleSlots } from "@/lib/draft/roster-rules";
import type { DraftRoomData } from "@/services/draftService";

function classificationLabel(value: "POWER" | "G5" | "INDEPENDENT" | null) {
  if (value === "POWER") return "Power";
  if (value === "INDEPENDENT") return "Independent";
  return value ?? "Tier unavailable";
}

function recordLabel(record: { wins: number; losses: number; ties: number } | null) {
  if (!record) return "Unavailable";
  return `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""}`;
}

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
  const [slotChoiceTeamId, setSlotChoiceTeamId] = useState<string | null>(null);

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
  const totalPicks = data.league.owner_count * data.league.teams_per_owner;
  const completedPicks = data.picks.length;
  const overallPick = Math.min(completedPicks + 1, totalPicks);
  const progressPercent = totalPicks ? Math.round((completedPicks / totalPicks) * 100) : 0;
  const myParticipant = data.participants.find((participant) => participant.member.user_id === data.currentUserId);
  const myMemberId = myParticipant?.league_member_id;
  const myPicks = useMemo(() => myMemberId ? data.picks.filter((pick) => pick.league_member_id === myMemberId) : [], [data.picks, myMemberId]);
  const myFilledSlotIds = useMemo(() => new Set(myPicks.flatMap((pick) => pick.roster_slot_id ? [pick.roster_slot_id] : [])), [myPicks]);
  const eligibleSlotsForTeam = (teamId: string) => {
    const team = data.teams.find((item) => item.id === teamId);
    if (!team || !data.rosterSlots.length) return [];
    return remainingEligibleSlots({ team, classification: data.teamIntelligence[team.id]?.classification ?? null, memberships: data.teamRuleMemberships, slots: data.rosterSlots, filledSlotIds: myFilledSlotIds });
  };
  const queuePromptTeam = activeQueue.find((item) => !data.rosterSlots.length || eligibleSlotsForTeam(item.team.id).length > 0);

  useEffect(() => {
    if (data.draft.status === "complete") return;

    const supabase = createClient();
    const refresh = () => router.refresh();
    const channel = supabase.channel(`draft-${data.draft.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_picks", filter: `draft_id=eq.${data.draft.id}` }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "drafts", filter: `id=eq.${data.draft.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_queue_items", filter: `draft_id=eq.${data.draft.id}` }, refresh)
      .subscribe();
    const poll = window.setInterval(refresh, 5000);
    return () => { window.clearInterval(poll); void supabase.removeChannel(channel); };
  }, [data.draft.id, data.draft.status, router]);

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

  async function draftTeam(teamId: string, rosterSlotId: string | null = null) {
    if (!isMyTurn || pendingTeam) return;
    const eligibleSlots = eligibleSlotsForTeam(teamId);
    if (data.rosterSlots.length && !rosterSlotId) {
      if (!eligibleSlots.length) { setError("That team cannot fill any of your remaining roster requirements."); return; }
      if (eligibleSlots.length > 1) { setSlotChoiceTeamId(teamId); return; }
      rosterSlotId = eligibleSlots[0].id;
    }
    setPendingTeam(teamId); setError(null); setMessage(null);
    const result = await submitPickAction(data.draft.id, teamId, rosterSlotId);
    setError(result.error ?? null); setMessage(result.success ?? null); setPendingTeam(null);
    if (!result.error) setSlotChoiceTeamId(null);
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

  if (data.draft.status === "complete") {
    return <CompletedDraftResults data={data} returningToLeague={completing} />;
  }

  const recentPicks = [...data.picks].reverse().slice(0, 8);
  const turnLabel = data.draft.status === "paused" ? "Draft paused" : data.draft.status === "not_started" ? "Draft order set" : isMyTurn ? "You are on the clock" : "On the clock";
  const turnDescription = data.draft.status === "paused"
    ? "Selections are temporarily paused. The board remains available to review."
    : data.draft.status === "not_started"
      ? "The room is ready. Build your private queue while the commissioner prepares to start."
      : isMyTurn
        ? "Make your selection below or draft the first team in your private queue."
        : `${currentParticipant?.member.team_name ?? "This owner"} is choosing now.`;

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-white/10 bg-[#071d3d]"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-4 px-4 py-4 sm:flex-row sm:items-center sm:px-6"><div><Link href={`/league/${data.league.id}`} className="text-sm font-semibold text-blue-300 hover:text-blue-200">← League Home</Link><h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">{data.league.name} Draft Room</h1></div><div className="flex items-center gap-3"><span className="rounded-full border border-white/10 bg-slate-900/70 px-3 py-1 text-xs font-black uppercase tracking-wider text-blue-100">{data.draft.status.replace("_", " ")}</span>{isCommissioner && data.draft.status === "live" && <button disabled={actionPending} onClick={() => togglePause(true)} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-bold transition hover:bg-red-500 disabled:opacity-50">Pause</button>}{isCommissioner && data.draft.status === "paused" && <button disabled={actionPending} onClick={() => togglePause(false)} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold transition hover:bg-emerald-500 disabled:opacity-50">Resume</button>}</div></div></header>

      <section className={`${isMyTurn ? "border-orange-300 bg-orange-500 text-slate-950" : "border-orange-500/30 bg-blue-950 text-white"} border-b-2`} aria-labelledby="turn-heading"><div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6"><div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div className="min-w-0"><p className={`${isMyTurn ? "text-slate-800" : "text-orange-300"} text-xs font-black uppercase tracking-[0.22em]`}>{turnLabel}</p><div className="mt-2 flex flex-wrap items-center gap-3"><h2 id="turn-heading" className="text-3xl font-black tracking-tight sm:text-4xl">{data.draft.status === "not_started" ? "Draft night is ready" : currentParticipant?.profile?.display_name ?? "Waiting for the next owner"}</h2>{isMyTurn && <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-black uppercase tracking-wider text-orange-300">Your pick</span>}</div><p className={`${isMyTurn ? "text-slate-800" : "text-blue-100"} mt-2 max-w-2xl text-sm font-semibold sm:text-base`}>{turnDescription}</p>{isMyTurn && <a href="#available-teams" className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-black text-white shadow-lg transition hover:bg-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">Choose a team ↓</a>}</div><dl className={`${isMyTurn ? "border-slate-900/20 bg-white/35" : "border-white/10 bg-slate-950/35"} grid shrink-0 grid-cols-3 gap-4 rounded-xl border px-4 py-3 sm:min-w-96`}><div><dt className="text-[0.65rem] font-black uppercase tracking-wider opacity-70">Round</dt><dd className="mt-0.5 font-mono text-2xl font-black">{data.draft.current_round}</dd></div><div><dt className="text-[0.65rem] font-black uppercase tracking-wider opacity-70">Overall pick</dt><dd className="mt-0.5 font-mono text-2xl font-black">#{overallPick}</dd></div><div><dt className="text-[0.65rem] font-black uppercase tracking-wider opacity-70">Draft slot</dt><dd className="mt-0.5 font-mono text-2xl font-black">#{data.draft.current_pick}</dd></div></dl></div><div className="mt-5"><div className="flex items-center justify-between text-xs font-bold"><span>{completedPicks} of {totalPicks} selections complete</span><span>{progressPercent}%</span></div><div className={`${isMyTurn ? "bg-slate-900/20" : "bg-slate-950"} mt-2 h-2 overflow-hidden rounded-full`} role="progressbar" aria-label="Draft progress" aria-valuemin={0} aria-valuemax={totalPicks} aria-valuenow={completedPicks}><div className={`${isMyTurn ? "bg-slate-950" : "bg-orange-500"} h-full rounded-full transition-[width] duration-300`} style={{ width: `${progressPercent}%` }} /></div></div></div></section>

      {completing && <div role="status" className="bg-green-600 px-4 py-3 text-center font-bold">Draft complete! Returning to your {isCommissioner ? "commissioner portal" : "league"}…</div>}

      {data.rosterSlots.length ? <p className="border-b border-blue-800 bg-blue-950 px-4 py-3 text-center text-xs font-semibold text-blue-100"><strong className="text-orange-300">Independent Team Rule:</strong> Notre Dame is officially Independent and may fill ACC/Power; UConn is officially Independent and may fill G5. Both may fill an Independent or unrestricted slot.</p> : null}

      <section className="border-b border-slate-800 bg-slate-900/70" aria-labelledby="recent-picks-heading"><div className="mx-auto max-w-7xl px-4 py-4 sm:px-6"><div className="flex items-center justify-between gap-3"><h2 id="recent-picks-heading" className="text-sm font-black uppercase tracking-wider text-orange-400">Recent Picks</h2>{recentPicks.length > 0 && <span className="text-xs font-semibold text-slate-500">Newest first</span>}</div><div className="mt-3 flex snap-x gap-3 overflow-x-auto pb-2">{recentPicks.length ? recentPicks.map((pick, index) => <article key={pick.id} className={`${index === 0 ? "border-orange-400 bg-orange-500/10 shadow-md shadow-orange-950/20" : "border-slate-700 bg-slate-900"} min-w-52 snap-start rounded-xl border p-3.5`}><div className="flex items-center justify-between gap-3"><span className="font-mono text-sm font-black text-orange-400">Pick #{pick.overall_pick}</span><span className={`${index === 0 ? "bg-orange-400 text-slate-950" : "bg-slate-800 text-slate-400"} rounded-full px-2 py-0.5 text-[0.65rem] font-black uppercase tracking-wider`}>{index === 0 ? "Just drafted" : `Round ${pick.round_number}`}</span></div><p className="mt-2 truncate text-lg font-black">{pick.team.school_name}</p><p className="mt-0.5 truncate text-sm text-slate-400">{pick.participant?.profile?.display_name ?? "Owner"} · Round {pick.round_number}</p>{pick.rosterSlot ? <p className="mt-1 text-xs font-bold text-blue-300">Filled: {pick.rosterSlot.label}</p> : null}</article>) : <p className="rounded-lg border border-dashed border-slate-700 px-4 py-3 text-sm text-slate-500">The first selection will appear here when the draft begins.</p>}</div></div></section>

      {(message || error) && <div className="mx-auto max-w-7xl px-4 pt-4">{message && <p className="rounded-lg bg-green-950 p-3 text-green-200">{message}</p>}{error && <p role="alert" className="rounded-lg bg-red-950 p-3 text-red-200">{error}</p>}</div>}

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_280px]">
        <aside className="order-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-lg lg:order-1 lg:row-span-2"><div className="flex items-center justify-between"><h2 className="font-black uppercase tracking-wide text-slate-300">Draft Order</h2><span className="text-xs font-bold text-slate-500">Slot</span></div><div className="mt-3 space-y-2">{data.participants.map((participant) => { const isCurrent = participant.draft_position === data.draft.current_pick && data.draft.status !== "not_started"; return <div key={participant.id} className={`${isCurrent ? "border-orange-400 bg-orange-500/10 shadow-sm" : "border-slate-800 bg-slate-950/40"} rounded-xl border p-2.5`}><div className="flex items-center gap-2.5"><span className={`${isCurrent ? "bg-orange-400 text-slate-950" : "bg-slate-800 text-slate-400"} flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-black`}>{participant.draft_position}</span><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><p className={`${participant.member.user_id === data.currentUserId ? "text-orange-300" : "text-slate-200"} truncate text-sm font-bold`}>{participant.profile?.display_name ?? "Owner"}</p>{participant.member.user_id === data.currentUserId && <span className="text-[0.6rem] font-black uppercase text-orange-400">You</span>}</div><p className="truncate text-xs text-slate-500">{participant.member.team_name ?? "Unnamed"}</p></div>{isCurrent && <span className="h-2 w-2 shrink-0 rounded-full bg-orange-400" aria-label="On the clock" />}</div></div>; })}</div></aside>

        <section className={`${isMyTurn ? "border-orange-400 ring-1 ring-orange-400/30" : "border-slate-800"} order-2 overflow-hidden rounded-2xl border bg-slate-900 shadow-lg lg:order-2`}><div className="grid divide-y divide-slate-800 md:grid-cols-2 md:divide-x md:divide-y-0"><div className="p-4"><div className="flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-orange-400">My Queue</p><h2 className="mt-1 text-xl font-black">Next choices</h2><p className="mt-0.5 text-xs text-slate-500">Private to you · top choice first</p></div><span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs font-black text-slate-300">{activeQueue.length}</span></div><ol className="mt-4 space-y-2">{activeQueue.length ? activeQueue.map((item, index) => { const eligible = eligibleSlotsForTeam(item.team.id); const noLongerFits = data.rosterSlots.length > 0 && eligible.length === 0; return <li key={item.id} className={`${noLongerFits ? "border-red-800 bg-red-950/30" : index === 0 ? "border-orange-400/50 bg-orange-500/10" : "border-slate-800 bg-slate-950/70"} flex items-center gap-2 rounded-xl border p-2.5`}><span className={`${index === 0 && !noLongerFits ? "bg-orange-400 text-slate-950" : "bg-slate-800 text-slate-400"} flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-black`}>{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-black">{item.team.school_name}</p><p className={`text-xs ${noLongerFits ? "font-bold text-red-300" : "text-slate-500"}`}>{noLongerFits ? "No longer fits your remaining slots" : eligible.length ? eligible.map((slot) => slot.label).join(" · ") : item.team.conference}</p></div>{mutationsEnabled && <div className="flex gap-1"><button aria-label={`Move ${item.team.school_name} up`} disabled={index === 0 || queuePending !== null} onClick={() => updateQueue(item.id, () => moveQueueTeamAction(data.draft.id, item.id, -1))} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 text-sm font-bold disabled:opacity-30">↑</button><button aria-label={`Move ${item.team.school_name} down`} disabled={index === activeQueue.length - 1 || queuePending !== null} onClick={() => updateQueue(item.id, () => moveQueueTeamAction(data.draft.id, item.id, 1))} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 text-sm font-bold disabled:opacity-30">↓</button><button aria-label={`Remove ${item.team.school_name}`} disabled={queuePending !== null} onClick={() => updateQueue(item.id, () => removeQueueTeamAction(data.draft.id, item.id))} className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-950 text-sm font-black text-red-300 disabled:opacity-30">×</button></div>}</li>; }) : <li className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-4 text-sm text-slate-500">Queue teams below so your favorites stay close when your turn arrives.</li>}</ol></div><div className="p-4"><div className="flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-blue-300">My Roster</p><h2 className="mt-1 text-xl font-black">{myPicks.length} of {data.league.teams_per_owner} teams</h2></div><span className="font-mono text-2xl font-black text-slate-700">{myParticipant ? `#${myParticipant.draft_position}` : "—"}</span></div>{data.rosterSlots.length ? <ol className="mt-4 space-y-1.5">{data.rosterSlots.map((slot) => { const pick = myPicks.find((item) => item.roster_slot_id === slot.id); return <li key={slot.id} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm ${pick ? "bg-emerald-950/40 text-emerald-200" : "bg-slate-950/70 text-slate-400"}`}><span aria-hidden="true">{pick ? "✓" : "○"}</span><span className="font-bold">{slot.label}</span>{pick ? <span className="ml-auto truncate text-xs">{pick.team.school_name}</span> : null}</li>; })}</ol> : myPicks.length ? <ol className="mt-4 grid gap-2">{myPicks.map((pick) => <li key={pick.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3"><p className="truncate font-black text-slate-100">{pick.team.school_name}</p><p className="mt-1 text-xs text-slate-500">Round {pick.round_number} · Pick #{pick.overall_pick}</p></li>)}</ol> : <div className="mt-4 rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-4"><p className="font-bold text-slate-300">Your roster starts here.</p><p className="mt-1 text-sm text-slate-500">Your drafted teams will stay visible throughout the draft.</p></div>}</div></div></section>

        <section id="available-teams" className="order-3 min-w-0 scroll-mt-4 lg:order-3" aria-labelledby="available-teams-heading"><div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-lg"><div className="flex items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-orange-400">Draft pool</p><h2 id="available-teams-heading" className="mt-1 text-2xl font-black">Available Teams</h2></div><span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-black text-slate-300">{availableTeams.length} available</span></div><div className="mt-4 flex flex-col gap-3 sm:flex-row"><label className="min-w-0 flex-1"><span className="sr-only">Search available teams</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search FBS teams…" className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 outline-none transition focus:border-orange-500 focus:ring-1 focus:ring-orange-500" /></label><label><span className="sr-only">Filter by conference</span><select value={conference} onChange={(event) => setConference(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 outline-none focus:border-orange-500 sm:w-auto">{conferences.map((item) => <option key={item}>{item}</option>)}</select></label></div></div>
          <div className="mt-3 grid items-start gap-3 sm:grid-cols-2 2xl:grid-cols-3">{availableTeams.map((team) => { const intelligence = data.teamIntelligence[team.id]; const eligible = eligibleSlotsForTeam(team.id); const ineligible = data.rosterSlots.length > 0 && eligible.length === 0; return <article key={team.id} className={`${ineligible ? "border-slate-800 bg-slate-950/60 opacity-70" : queuedTeamIds.has(team.id) ? "border-blue-500/50 bg-blue-950/35" : "border-slate-800 bg-slate-900"} rounded-xl border p-3.5 shadow-sm`}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-lg font-black">{team.school_name}</p><p className="mt-0.5 truncate text-xs font-semibold text-slate-400">{team.conference} · {classificationLabel(intelligence?.classification ?? null)}</p></div>{intelligence?.apRank ? <span className="shrink-0 rounded-full bg-orange-500/15 px-2 py-1 text-xs font-black text-orange-300">AP #{intelligence.apRank}</span> : null}</div><div className="mt-3 flex flex-wrap gap-1.5 text-xs">{ineligible ? <span className="rounded-md bg-red-950 px-2 py-1 font-bold text-red-300">No remaining roster fit</span> : eligible.length ? eligible.map((slot) => <span key={slot.id} className="rounded-md bg-emerald-950 px-2 py-1 font-bold text-emerald-300">Fits {slot.label}</span>) : <span className="rounded-md bg-slate-800 px-2 py-1 font-bold text-slate-300">Unrestricted</span>}</div><details className="group mt-3 rounded-lg bg-slate-950/70"><summary className="cursor-pointer list-none px-2.5 py-2 text-xs font-bold text-blue-300">Team details ›</summary><dl className="grid grid-cols-2 gap-3 border-t border-slate-800 px-2.5 py-2.5 text-xs"><div><dt className="text-slate-500">Conference</dt><dd className="font-bold">{team.conference}</dd></div><div><dt className="text-slate-500">Classification</dt><dd className="font-bold">{classificationLabel(intelligence?.classification ?? null)}</dd></div><div><dt className="text-slate-500">{intelligence?.priorSeason ?? "Prior"} record</dt><dd className="font-bold">{recordLabel(intelligence?.priorRecord ?? null)}</dd></div><div><dt className="text-slate-500">AP ranking</dt><dd className="font-bold">{intelligence?.apRank ? `#${intelligence.apRank}` : "Unavailable"}</dd></div></dl></details><div className="mt-3 flex items-center gap-2"><button disabled={!mutationsEnabled || ineligible || queuedTeamIds.has(team.id) || queuePending !== null} onClick={() => updateQueue(team.id, () => addQueueTeamAction(data.draft.id, team.id))} className="min-h-10 flex-1 rounded-lg border border-slate-600 px-3 py-2 text-xs font-black disabled:opacity-40">{queuedTeamIds.has(team.id) ? "✓ Queued" : "+ Add to queue"}</button><button disabled={!isMyTurn || ineligible || pendingTeam !== null} onClick={() => draftTeam(team.id)} className="min-h-10 rounded-lg bg-orange-500 px-4 py-2 text-xs font-black text-slate-950 disabled:bg-slate-700 disabled:text-slate-400">{pendingTeam === team.id ? "Drafting…" : isMyTurn ? "Draft team" : "Draft"}</button></div></article>; })}</div>
          {!availableTeams.length && <div className="mt-3 rounded-2xl border border-dashed border-slate-700 bg-slate-900 p-8 text-center"><p className="font-black text-slate-300">No available teams match.</p><p className="mt-1 text-sm text-slate-500">Try another school name or conference.</p></div>}
        </section>

        <aside className="order-5 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-lg lg:col-start-2 xl:order-4 xl:col-start-3 xl:row-start-1 xl:row-span-2"><p className="text-xs font-black uppercase tracking-[0.18em] text-blue-300">League view</p><h2 className="mt-1 text-xl font-black">Owner Rosters</h2><div className="mt-4 space-y-3">{data.participants.map((participant) => { const ownerPicks = data.picks.filter((pick) => pick.league_member_id === participant.league_member_id); const isMe = participant.member.user_id === data.currentUserId; return <div key={participant.id} className={`${isMe ? "border-orange-400/40 bg-orange-500/10" : "border-slate-800 bg-slate-950/50"} rounded-xl border p-3`}><div className="flex items-center justify-between gap-2"><p className={`${isMe ? "text-orange-300" : "text-slate-200"} truncate text-sm font-black`}>{participant.profile?.display_name ?? "Owner"}{isMe ? " · You" : ""}</p><span className="text-xs font-bold text-slate-500">{ownerPicks.length}/{data.league.teams_per_owner}</span></div><p className="mt-1 text-xs leading-relaxed text-slate-500">{ownerPicks.length ? ownerPicks.map((pick) => pick.team.abbreviation).join(" · ") : "No teams drafted yet"}</p></div>; })}</div></aside>
      </div>

      {isMyTurn && dismissedTurn !== turnKey && queuePromptTeam && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="queue-prompt-title"><div className="w-full max-w-md rounded-2xl border border-orange-500 bg-slate-900 p-6 shadow-2xl"><p className="text-sm font-black uppercase tracking-widest text-orange-400">You&apos;re on the clock!</p><h2 id="queue-prompt-title" className="mt-2 text-2xl font-black">{queuePromptTeam.team.school_name} is your highest legal queued choice.</h2><p className="mt-2 text-slate-400">Confirm this pick or browse the available teams.</p><div className="mt-6 flex flex-col gap-3 sm:flex-row"><button disabled={pendingTeam !== null} onClick={() => draftTeam(queuePromptTeam.team.id)} className="flex-1 rounded-lg bg-orange-500 px-4 py-3 font-black text-slate-950 hover:bg-orange-400 disabled:opacity-50">Draft {queuePromptTeam.team.short_name}</button><button onClick={dismissQueuePrompt} className="flex-1 rounded-lg bg-slate-700 px-4 py-3 font-bold hover:bg-slate-600">Choose Another Team</button></div>{error && <p className="mt-4 text-sm text-red-300">{error}</p>}</div></div>}
      {slotChoiceTeamId ? <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-labelledby="slot-choice-title"><div className="w-full max-w-md rounded-2xl border border-orange-400 bg-slate-900 p-6 shadow-2xl"><p className="text-xs font-black uppercase tracking-widest text-orange-400">Record this pick</p><h2 id="slot-choice-title" className="mt-2 text-2xl font-black">Which roster slot does {data.teams.find((team) => team.id === slotChoiceTeamId)?.school_name} fill?</h2><p className="mt-2 text-sm text-slate-400">This assignment is permanent and will not be reshuffled later.</p><div className="mt-5 grid gap-2">{eligibleSlotsForTeam(slotChoiceTeamId).map((slot) => <button key={slot.id} disabled={pendingTeam !== null} onClick={() => draftTeam(slotChoiceTeamId, slot.id)} className="min-h-12 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-left font-black text-white hover:border-orange-400">{slot.label}</button>)}</div><button disabled={pendingTeam !== null} onClick={() => setSlotChoiceTeamId(null)} className="mt-4 w-full rounded-lg bg-slate-700 px-4 py-3 font-bold">Cancel</button></div></div> : null}
    </main>
  );
}
