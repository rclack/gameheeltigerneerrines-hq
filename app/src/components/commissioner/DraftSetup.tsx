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

  async function run(action: () => Promise<{ error?: string; success?: string; draftId?: string }>) {
    if (pending) return;
    setPending(true); setError(null); setMessage(null);
    const result = await action();
    setError(result.error ?? null); setMessage(result.success ?? null); setPending(false);
  }

  return (
    <section className="mt-8 rounded-xl bg-white p-6 shadow">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-bold">🎯 College Team Draft</h2>
          <p className="mt-1 text-slate-500">{ownerCount} owners · {teamsPerOwner} rounds · {totalPicks} total picks</p>
        </div>
        <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold capitalize">{draft?.status.replace("_", " ") ?? "setup needed"}</span>
      </div>

      {members.length !== ownerCount && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-amber-800">Draft locked: {members.length} of {ownerCount} accepted members.</p>}
      {activeInvites.length > 0 && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-amber-800">Draft locked: {activeInvites.length} pending invitation{activeInvites.length === 1 ? "" : "s"} must be resolved.</p>}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(participants.length ? participants : members.map((member, index) => ({ id: member.id, draft_id: "", league_member_id: member.id, draft_position: index + 1, created_at: member.created_at, member, profile: member.profile }))).map((participant) => (
          <div key={participant.id} className="flex items-center gap-3 rounded-lg bg-slate-100 p-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-950 font-bold text-white">{participant.draft_position}</span>
            <div className="min-w-0"><p className="truncate font-semibold">{participant.profile?.display_name ?? "Owner"}</p><p className="truncate text-sm text-slate-500">{participant.member.team_name ?? "Team name not set"}</p></div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        {(!draft || draft.status === "not_started") && (
          <>
            <Button className="sm:w-auto" disabled={pending || members.length === 0} onClick={() => run(() => randomizeOrder(leagueId))}>Randomize Draft Order</Button>
            <Button className="sm:w-auto" variant="sports" disabled={pending || !draft || !ready} onClick={() => draft && run(() => startDraftAction(leagueId, draft.id))}>Start Draft</Button>
          </>
        )}
        {draft?.status === "live" && <Button className="sm:w-auto" variant="danger" disabled={pending} onClick={() => run(() => setDraftPausedAction(leagueId, draft.id, true))}>Pause Draft</Button>}
        {draft?.status === "paused" && <Button className="sm:w-auto" variant="success" disabled={pending} onClick={() => run(() => setDraftPausedAction(leagueId, draft.id, false))}>Resume Draft</Button>}
        {draft && draft.status !== "not_started" && <Link href={`/draft/${draft.id}`} className="rounded-lg bg-orange-500 px-4 py-2 text-center font-semibold text-white hover:bg-orange-600">Enter Draft Room</Link>}
        {draft && draft.status !== "not_started" && <Button className="sm:w-auto" variant="danger" disabled={pending} onClick={() => setConfirmingReset(true)}>Reset Draft</Button>}
      </div>
      {message && <p className="mt-4 text-sm text-green-700">{message}</p>}
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}

      {confirmingReset && draft && (
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
      )}
    </section>
  );
}
