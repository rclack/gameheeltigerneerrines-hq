import type { Metadata } from "next";
import { redirect } from "next/navigation";

import LeagueReviewDecision from "@/components/commissioner/LeagueReviewDecision";
import { rulesSummary, type RosterRuleInput } from "@/lib/draft/roster-rules";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "League Request Review", robots: { index: false, follow: false } };

export default async function LeagueRequestReviewPage({ params }: { params: Promise<{ decision: string; token: string }> }) {
  const { decision, token } = await params;
  const returnPath = `/league-requests/review/${decision}/${token}`;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnPath)}`);
  const validDecision = decision === "approve" || decision === "deny";
  const reviewDecision: "approve" | "deny" = decision === "deny" ? "deny" : "approve";
  const { data } = validDecision && /^[0-9a-f]{64}$/.test(token) ? await supabase.rpc("inspect_league_creation_review", { target_token: token, target_decision: decision }) : { data: null };
  const request = data?.[0];
  return <main className="min-h-screen bg-slate-100 px-4 py-16 text-slate-950"><div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8"><p className="text-xs font-black uppercase tracking-[0.18em] text-orange-700">Site administrator review</p><h1 className="mt-2 text-3xl font-black text-blue-950">{reviewDecision === "deny" ? "Review league denial" : "Review league approval"}</h1>{request ? <><p className="mt-3 text-sm leading-6 text-slate-600">This page is confirmation-only. No decision has been made yet.</p><dl className="mt-6 grid gap-4 rounded-xl bg-slate-50 p-5 sm:grid-cols-2"><div><dt className="text-xs font-black uppercase text-slate-500">Requester</dt><dd className="mt-1 font-bold">{request.requester_name}<br /><span className="font-normal text-slate-600">{request.requester_email}</span></dd></div><div><dt className="text-xs font-black uppercase text-slate-500">League</dt><dd className="mt-1 font-bold">{request.proposed_name}</dd></div><div><dt className="text-xs font-black uppercase text-slate-500">Format</dt><dd className="mt-1 font-bold">{request.season} · {request.owner_count} owners · {request.teams_per_owner} teams each</dd></div><div><dt className="text-xs font-black uppercase text-slate-500">Roster rules</dt><dd className="mt-1 font-bold">{rulesSummary(request.roster_rules as unknown as RosterRuleInput[])}</dd></div></dl><LeagueReviewDecision token={token} decision={reviewDecision} /></> : <p role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5 font-bold text-red-800">This review link is invalid, expired, already used, or unavailable to this account.</p>}</div></main>;
}
