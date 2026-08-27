"use client";

import { useActionState } from "react";

import { correctCaptain, type CaptainCorrectionState } from "@/app/commissioner/[leagueId]/captains/actions";

export interface CaptainCorrectionLineup {
  id: string;
  week: number;
  ownerName: string;
  entries: Array<{ id: string; teamName: string; status: string; isCaptain: boolean; captainLockedAt: string | null }>;
}

export default function CaptainCorrections({ leagueId, lineups }: { leagueId: string; lineups: CaptainCorrectionLineup[] }) {
  const [state, action, pending] = useActionState<CaptainCorrectionState, FormData>(correctCaptain, {});
  return <div className="space-y-5">
    {(state.error || state.success) && <p role={state.error ? "alert" : "status"} className={`${state.error ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"} rounded-lg p-3 font-bold`}>{state.error ?? state.success}</p>}
    {lineups.map((lineup) => <form action={action} key={lineup.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <input type="hidden" name="leagueId" value={leagueId}/><input type="hidden" name="lineupId" value={lineup.id}/>
      <h2 className="font-black text-blue-950">Week {lineup.week} · {lineup.ownerName}</h2>
      <p className="mt-1 text-sm text-slate-600">Current: {lineup.entries.find((entry) => entry.isCaptain)?.teamName ?? "No Captain"}</p>
      <label className="mt-3 block text-sm font-bold">Correct Captain<select name="entryId" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3"><option value="">No Captain</option>{lineup.entries.filter((entry) => entry.status === "starter").map((entry) => <option key={entry.id} value={entry.id}>{entry.teamName}{entry.captainLockedAt ? " · locked" : ""}</option>)}</select></label>
      <label className="mt-3 block text-sm font-bold">Audit reason<textarea name="reason" required minLength={2} maxLength={500} className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 p-3"/></label>
      <button disabled={pending} className="mt-3 min-h-11 w-full rounded-lg bg-blue-900 px-4 py-2 font-black text-white disabled:opacity-60 sm:w-auto">{pending ? "Saving…" : "Apply Audited Correction"}</button>
    </form>)}
  </div>;
}
