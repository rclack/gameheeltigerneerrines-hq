"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { generateSundayRecapAction, sendSundayRecapAction, setSundayRecapEnabledAction } from "@/app/commissioner/scoring/recap-actions";
import Button from "@/components/ui/Button";
import type { RecapNarrative, VerifiedRecapPayload } from "@/lib/recap/types";
import type { SundayRecap } from "@/types/database";

interface Props { leagueId: string; enabled: boolean; lastRecap: SundayRecap | null; availableWeeks: number[] }

function timestamp(value: string | null) { return value ? new Date(value).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC") : "Never"; }

export default function SundayRecapControl({ leagueId, enabled, lastRecap, availableWeeks }: Props) {
  const router = useRouter();
  const [selectedWeek, setSelectedWeek] = useState(lastRecap?.week ?? availableWeeks.at(-1) ?? 0);
  const [recap, setRecap] = useState(lastRecap);
  const [pending, setPending] = useState(false);
  const [confirmingSend, setConfirmingSend] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const payload = recap?.factual_payload as unknown as VerifiedRecapPayload | undefined;
  const narrative = recap?.narrative as unknown as RecapNarrative | undefined;

  async function run(action: () => Promise<{ error?: string; success?: string; recap?: SundayRecap }>) {
    if (pending) return null;
    setPending(true); setMessage(null); setError(null);
    const result = await action();
    setPending(false); setMessage(result.success ?? null); setError(result.error ?? null);
    if (result.recap) setRecap(result.recap);
    if (!result.error) router.refresh();
    return result;
  }

  async function send() {
    if (!recap) return;
    const result = await run(() => sendSundayRecapAction(leagueId, recap.id));
    if (!result?.error) setConfirmingSend(false);
  }

  return (
    <section className="overflow-hidden rounded-xl border border-blue-200 bg-white shadow" aria-labelledby="sunday-recap-title">
      <div className="bg-[#061a38] p-5 text-white sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">Owner engagement</p><h2 id="sunday-recap-title" className="mt-1 text-2xl font-black">AI Sunday Recap</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100">The application freezes every score, result, ranking, and standings fact. AI adds only the sportswriter flavor.</p></div>
          <button type="button" role="switch" aria-checked={enabled} disabled={pending} onClick={() => run(() => setSundayRecapEnabledAction(leagueId, !enabled))} className={`inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-black ${enabled ? "bg-emerald-500 text-white" : "bg-white/10 text-blue-100"}`}>{enabled ? "Automatic: On" : "Automatic: Off"}</button>
        </div>
      </div>
      <div className="p-5 sm:p-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold">Recap week<select value={selectedWeek} onChange={(event) => setSelectedWeek(Number(event.target.value))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2.5">{availableWeeks.map((week) => <option key={week} value={week}>Week {week}</option>)}</select></label><div className="rounded-lg bg-slate-100 p-3 text-sm"><p className="font-black text-slate-950">Last status: <span className="capitalize">{recap?.status ?? "Not generated"}</span></p><p className="mt-1 text-slate-600">Generated {timestamp(recap?.generated_at ?? null)}</p>{recap?.sent_at ? <p className="text-slate-600">Sent {timestamp(recap.sent_at)}</p> : null}</div></div>
          <div className="grid gap-2 sm:flex"><Button className="sm:w-auto" variant="info" disabled={pending || !availableWeeks.length} onClick={() => run(() => generateSundayRecapAction(leagueId, selectedWeek))}>{pending ? "Working…" : recap?.week === selectedWeek && narrative ? "Open Preview" : "Generate Preview"}</Button><Button className="sm:w-auto" variant="sports" disabled={pending || !narrative || recap?.status === "sent"} onClick={() => setConfirmingSend(true)}>Send to Owners</Button></div>
        </div>
        {message ? <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{message}</p> : null}
        {error ? <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p> : null}
        {payload && narrative && recap?.week === selectedWeek ? <article className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5"><p className="text-xs font-black uppercase tracking-wide text-orange-700">Email preview · Week {payload.league.week}</p><h3 className="mt-1 text-xl font-black">{payload.league.name} Week {payload.league.week}: {narrative.subjectHook}</h3><p className="mt-3 text-sm leading-6 text-slate-700">{narrative.opening}</p><div className="mt-4 space-y-3">{narrative.stories.map((story) => { const fact = payload.facts.find((item) => item.id === story.factId); return fact ? <div key={story.factId} className="rounded-lg bg-white p-3"><p className="text-xs font-black uppercase tracking-wide text-orange-700">{fact.label}</p><p className="mt-1 font-bold">{fact.text}</p><p className="mt-1 text-sm italic text-slate-600">{story.reaction}</p></div> : null; })}</div><h4 className="mt-5 font-black">Standings</h4><ol className="mt-2 space-y-1 text-sm">{payload.standings.map((row) => <li key={row.memberId} className="flex justify-between gap-3"><span>#{row.position} {row.poolTeamName ?? row.ownerName}</span><span className="font-black">{row.totalPoints}</span></li>)}</ol><p className="mt-4 text-sm text-slate-700">{narrative.closing}</p></article> : null}
      </div>
      {confirmingSend && recap ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="send-recap-title"><div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"><p className="text-xs font-black uppercase tracking-wide text-orange-700">Final send check</p><h3 id="send-recap-title" className="mt-1 text-xl font-black">Email Week {recap.week} Recap?</h3><p className="mt-3 text-sm leading-6 text-slate-700">This sends the reviewed recap to accepted league owners with valid account emails. Retries will skip anyone already sent successfully.</p><div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button className="sm:w-auto" variant="secondary" disabled={pending} onClick={() => setConfirmingSend(false)}>Cancel</Button><Button className="sm:w-auto" variant="sports" disabled={pending} onClick={send}>{pending ? "Sending…" : "Send Recap"}</Button></div></div></div> : null}
    </section>
  );
}
