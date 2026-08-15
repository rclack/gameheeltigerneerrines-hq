"use client";

import Link from "next/link";
import { useState } from "react";

import { randomizeOrder, resetDraftAction, setDraftPausedAction, startDraftAction } from "@/app/commissioner/draft-actions";
import Button from "@/components/ui/Button";
import type { Draft, LeagueInvitation } from "@/types/database";
import type { DraftParticipant } from "@/services/draftService";
import type { MemberWithProfile } from "@/services/membershipService";

interface DraftSetupProps {
  leagueId: string;
  ownerCount: number;
  teamsPerOwner: number;
  members: MemberWithProfile[];
  invitations: LeagueInvitation[];
  draft: Draft | null;
  participants: DraftParticipant[];
}

export default function DraftSetup({ leagueId, ownerCount, teamsPerOwner, members, invitations, draft, participants }: DraftSetupProps) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const activeInvites = invitations.filter((invite) => invite.status === "pending" && new Date(invite.expires_at) > new Date());
  const ready = members.length === ownerCount && activeInvites.length === 0 && participants.length === ownerCount;
  const totalPicks = ownerCount * teamsPerOwner;
  const boardStatus = draft?.status === "complete"
    ? "Draft complete"
    : draft?.status === "live"
      ? "Draft live"
      : draft?.status === "paused"
        ? "Draft paused"
        : ready
          ? "Ready to start"
          : "Setup in progress";

  async function run(action: () => Promise<{ error?: string; success?: string; draftId?: string }>) {
    if (pending) return;
    setPending(true); setError(null); setMessage(null);
    const result = await action();
    setError(result.error ?? null); setMessage(result.success ?? null); setPending(false);
  }

  const resetDialog = confirmingReset && draft ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="reset-draft-title" aria-describedby="reset-draft-warning">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <h3 id="reset-draft-title" className="text-xl font-bold text-slate-950">Reset Draft?</h3>
        <p id="reset-draft-warning" className="mt-3 text-slate-700">All draft picks and every owner&apos;s private queue will be permanently erased. The league, owners, and current randomized draft order will be preserved.</p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button className="sm:w-auto" variant="secondary" disabled={pending} onClick={() => setConfirmingReset(false)}>Cancel</Button>
          <Button className="sm:w-auto" variant="danger" disabled={pending} onClick={() => run(async () => {
            const result = await resetDraftAction(leagueId, draft.id);
            if (!result.error) setConfirmingReset(false);
            return result;
          })}>{pending ? "Resetting…" : "Reset Draft"}</Button>
        </div>
      </div>
    </div>
  ) : null;

  if (draft?.status === "complete") {
    return (
      <section id="draft-operations" className="mt-10 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="draft-operations-title">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-xl font-black text-emerald-800" aria-hidden="true">✓</span>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Final board</p>
              <h2 id="draft-operations-title" className="mt-1 text-2xl font-black tracking-tight text-slate-950">College Team Draft Complete</h2>
              <p className="mt-2 text-sm text-slate-500">All {totalPicks} selections are final. The full draft board remains available for review.</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href={`/draft/${draft.id}`} className="rounded-lg bg-[#0b2b59] px-5 py-2.5 text-center text-sm font-black text-white transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2">Review Draft Results</Link>
            <Link href={`/league/${leagueId}/standings`} className="rounded-lg bg-slate-100 px-5 py-2.5 text-center text-sm font-bold text-slate-800 transition hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2">View Standings</Link>
            <Button className="sm:w-auto" variant="danger" disabled={pending} onClick={() => setConfirmingReset(true)}>Reset Draft</Button>
          </div>
        </div>
        {message ? <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">{message}</p> : null}
        {error ? <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">{error}</p> : null}
        {resetDialog}
      </section>
    );
  }

  return (
    <section id="draft-operations" className="mt-10 scroll-mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="draft-operations-title">
      <div className="border-b border-slate-200 bg-[#0b2b59] p-5 text-white sm:p-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">Preseason centerpiece</p>
            <h2 id="draft-operations-title" className="mt-1 text-2xl font-black tracking-tight">College Team Draft</h2>
            <p className="mt-2 text-sm text-blue-100">{ownerCount} owners · {teamsPerOwner} rounds · {totalPicks} total picks</p>
          </div>
          <span className="w-fit rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-blue-50">{boardStatus}</span>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Owners ready</p>
            <p className="mt-2 text-2xl font-black text-[#0b2b59]">{members.length}<span className="text-base text-slate-400">/{ownerCount}</span></p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Draft rounds</p>
            <p className="mt-2 text-2xl font-black text-[#0b2b59]">{teamsPerOwner}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Board status</p>
            <p className={`mt-2 text-sm font-black uppercase tracking-wide ${draft?.status === "live" ? "text-emerald-700" : draft?.status === "paused" ? "text-red-700" : ready ? "text-emerald-700" : "text-amber-700"}`}>{boardStatus}</p>
          </div>
        </div>

      {members.length !== ownerCount ? <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900">Draft locked: {members.length} of {ownerCount} accepted members.</p> : null}
      {activeInvites.length > 0 ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900">Draft locked: {activeInvites.length} pending invitation{activeInvites.length === 1 ? "" : "s"} must be resolved.</p> : null}

      <div className="mt-6">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-sm font-black uppercase tracking-[0.14em] text-slate-700">Draft Order</h3>
          <p className="text-xs text-slate-500">Order shown from first pick onward</p>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(participants.length ? participants : members.map((member, index) => ({ id: member.id, draft_id: "", league_member_id: member.id, draft_position: index + 1, created_at: member.created_at, member, profile: member.profile }))).map((participant) => (
          <div key={participant.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0b2b59] font-mono text-sm font-black text-white shadow-sm">{participant.draft_position}</span>
            <div className="min-w-0"><p className="truncate font-bold text-slate-900">{participant.profile?.display_name ?? "Owner"}</p><p className="truncate text-sm text-slate-500">{participant.member.team_name ?? "Team name not set"}</p></div>
          </div>
        ))}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:flex-wrap">
        {(!draft || draft.status === "not_started") && (
          <>
            <Button className="sm:w-auto" disabled={pending || members.length === 0} onClick={() => run(() => randomizeOrder(leagueId))}>Randomize Draft Order</Button>
            <Button className="sm:w-auto" variant="sports" disabled={pending || !draft || !ready} onClick={() => draft && run(() => startDraftAction(leagueId, draft.id))}>Start Draft</Button>
          </>
        )}
        {draft?.status === "live" && <Button className="sm:w-auto" variant="danger" disabled={pending} onClick={() => run(() => setDraftPausedAction(leagueId, draft.id, true))}>Pause Draft</Button>}
        {draft?.status === "paused" && <Button className="sm:w-auto" variant="success" disabled={pending} onClick={() => run(() => setDraftPausedAction(leagueId, draft.id, false))}>Resume Draft</Button>}
        {draft && draft.status !== "not_started" && <Link href={`/draft/${draft.id}`} className="rounded-lg bg-orange-500 px-5 py-2.5 text-center font-black text-white shadow-sm transition hover:bg-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-2">Enter Draft Room</Link>}
        {draft && draft.status !== "not_started" && <Button className="sm:w-auto" variant="danger" disabled={pending} onClick={() => setConfirmingReset(true)}>Reset Draft</Button>}
      </div>
      {message ? <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">{message}</p> : null}
      {error ? <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">{error}</p> : null}
      </div>

      {resetDialog}
    </section>
  );
}
