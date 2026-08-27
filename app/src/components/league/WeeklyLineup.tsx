"use client";

import { useActionState } from "react";
import Link from "next/link";

import { swapWeeklyStarter, type LineupActionState } from "@/app/league/[leagueId]/actions";
import TeamLogo from "@/components/team/TeamLogo";
import type { WeeklyLineupDetail, WeeklyLineupEntryDetail } from "@/services/lineupService";

function kickoffLabel(value: string | null) {
  if (!value) return "No game scheduled";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function stateLabel(entry: WeeklyLineupEntryDetail, now: number) {
  if (entry.status === "no_game") return "Bye / No game";
  if (entry.gameStatus === "canceled") return "Canceled";
  if (entry.gameStatus === "postponed") return "Postponed";
  const locked = entry.locked_at !== null || (entry.lock_at !== null && new Date(entry.lock_at).getTime() <= now);
  if (locked) return "Locked";
  return "Unlocked";
}

function TeamRow({ entry, now, children }: { entry: WeeklyLineupEntryDetail; now: number; children?: React.ReactNode }) {
  const label = stateLabel(entry, now);
  const counts = entry.status === "starter";
  return <article className={`rounded-xl border p-4 ${counts ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3"><TeamLogo team={entry.team} size="md" decorative /><div className="min-w-0"><h4 className="truncate font-black text-blue-950">{entry.team.school_name}</h4><p className="text-sm text-slate-600">{kickoffLabel(entry.lock_at)}</p></div></div>
      <span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase ${label === "Locked" ? "bg-slate-800 text-white" : label === "Unlocked" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-900"}`}>{label}</span>
    </div>
    {entry.status !== "no_game" && <p className={`mt-3 text-xs font-black uppercase tracking-wide ${counts ? "text-green-700" : "text-slate-500"}`}>{counts ? "Starting — Points Count" : "Bench — Result Does Not Count"}</p>}
    {children}
  </article>;
}

export default function WeeklyLineup({ leagueId, detail, availableWeeks, nowIso }: { leagueId: string; detail: WeeklyLineupDetail; availableWeeks: number[]; nowIso: string }) {
  const [state, action, pending] = useActionState<LineupActionState, FormData>(swapWeeklyStarter, {});
  const starters = detail.entries.filter((entry) => entry.status === "starter" && entry.gameStatus !== "canceled" && entry.gameStatus !== "postponed");
  const bench = detail.entries.filter((entry) => entry.status === "bench" && entry.gameStatus !== "canceled" && entry.gameStatus !== "postponed");
  const unavailable = detail.entries.filter((entry) => entry.status === "no_game" || entry.gameStatus === "canceled");
  const now = new Date(nowIso).getTime();
  const editableStarters = starters.filter((entry) => stateLabel(entry, now) === "Unlocked");

  return <section className="rounded-2xl border-2 border-blue-300 bg-white p-5 shadow-lg" aria-labelledby="weekly-lineup-heading">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-orange-600">Week {detail.lineup.week} Lineup</p><h2 id="weekly-lineup-heading" className="mt-1 text-2xl font-black text-blue-950">This Week&apos;s Lineup</h2></div><p className="text-sm font-bold text-slate-600">Locks individually at kickoff</p></div>
    {availableWeeks.length > 1 && <nav aria-label="Choose lineup week" className="mt-4 flex flex-wrap gap-2">{availableWeeks.map((week) => <Link key={week} href={`/league/${leagueId}?lineupWeek=${week}`} aria-current={week === detail.lineup.week ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-lg px-4 py-2 text-sm font-black ${week === detail.lineup.week ? "bg-blue-900 text-white" : "border border-slate-300 bg-white text-blue-900"}`}>Week {week}</Link>)}</nav>}
    <div className="mt-5 space-y-5">
      <div><h3 className="mb-3 text-sm font-black uppercase tracking-widest text-blue-900">Starters · {starters.length}/{detail.lineup.starters_limit_snapshot}</h3><div className="grid gap-3 sm:grid-cols-2">{starters.map((entry) => <TeamRow key={entry.id} entry={entry} now={now} />)}{Array.from({ length: Math.max(0, detail.lineup.starters_limit_snapshot - starters.length) }, (_, index) => <div key={`empty-${index}`} className="rounded-xl border-2 border-dashed border-slate-300 p-4 text-sm font-bold text-slate-500">Empty starting slot</div>)}</div></div>
      <div><h3 className="mb-3 text-sm font-black uppercase tracking-widest text-slate-600">Bench · {bench.length}</h3><div className="grid gap-3 sm:grid-cols-2">{bench.map((entry) => <TeamRow key={entry.id} entry={entry} now={now}>{stateLabel(entry, now) === "Unlocked" && editableStarters.length > 0 && <form action={action} className="mt-3 grid gap-2"><input type="hidden" name="leagueId" value={leagueId}/><input type="hidden" name="lineupId" value={detail.lineup.id}/><input type="hidden" name="startTeamId" value={entry.team_id}/><label className="text-xs font-bold text-slate-600">Start instead of<select name="benchTeamId" required className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-semibold">{editableStarters.map((starter) => <option key={starter.id} value={starter.team_id}>{starter.team.school_name}</option>)}</select></label><button disabled={pending} className="min-h-11 rounded-lg bg-blue-900 px-4 py-2 font-black text-white disabled:opacity-60">{pending ? "Saving…" : "Start This Team"}</button></form>}</TeamRow>)}</div></div>
      {unavailable.length > 0 && <div><h3 className="mb-3 text-sm font-black uppercase tracking-widest text-amber-800">Unavailable</h3><div className="grid gap-3 sm:grid-cols-2">{unavailable.map((entry) => <TeamRow key={entry.id} entry={entry} now={now}/>)}</div></div>}
    </div>
    {state.error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-800">{state.error}</p>}
    {state.success && <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm font-bold text-green-800">{state.success}</p>}
  </section>;
}
