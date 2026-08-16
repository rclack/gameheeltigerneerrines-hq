"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import { decideLeagueRequest } from "@/app/league-requests/review/actions";

export default function LeagueReviewDecision({ token, decision }: { token: string; decision: "approve" | "deny" }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ error?: string; success?: string; leagueId?: string }>({});
  function submit() { if (pending) return; startTransition(async () => setState(await decideLeagueRequest(token, decision))); }
  if (state.success) return <div role="status" className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5"><p className="font-bold text-emerald-900">{state.success}</p><Link href={state.leagueId ? `/commissioner/${state.leagueId}` : "/leagues"} className="mt-4 inline-block rounded-lg bg-blue-950 px-4 py-2 font-bold text-white">{state.leagueId ? "Open Commissioner HQ" : "Return to My Leagues"}</Link></div>;
  return <div className="mt-6"><button type="button" disabled={pending} onClick={submit} className={`rounded-lg px-5 py-3 font-black text-white disabled:opacity-60 ${decision === "approve" ? "bg-emerald-700 hover:bg-emerald-800" : "bg-red-700 hover:bg-red-800"}`}>{pending ? "Submitting…" : decision === "approve" ? "Approve and Create League" : "Deny Request"}</button>{state.error ? <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-800">{state.error}</p> : null}</div>;
}
