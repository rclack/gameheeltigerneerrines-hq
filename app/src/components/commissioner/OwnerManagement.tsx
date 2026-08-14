"use client";

import { useActionState, useState } from "react";

import { inviteOwner, revokeOwnerInvitation, type InvitationActionState } from "@/app/commissioner/actions";
import Button from "@/components/ui/Button";
import type { LeagueInvitation } from "@/types/database";
import type { MemberWithProfile } from "@/services/membershipService";

interface OwnerManagementProps {
  leagueId: string;
  ownerCount: number;
  members: MemberWithProfile[];
  invitations: LeagueInvitation[];
}

const initialState: InvitationActionState = {};

function CopyInviteButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/invite/${token}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button type="button" onClick={copyLink} className="text-sm font-semibold text-blue-600 hover:text-blue-800">
      {copied ? "Copied!" : "Copy Invite Link"}
    </button>
  );
}

function RevokeButton({ invitationId }: { invitationId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await revokeOwnerInvitation(invitationId);
    if (result.error) setError(result.error);
    setPending(false);
  }

  return (
    <div className="text-right">
      <button type="button" disabled={pending} onClick={revoke} className="text-sm font-semibold text-red-600 hover:text-red-800 disabled:opacity-50">
        {pending ? "Revoking…" : "Revoke"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export default function OwnerManagement({ leagueId, ownerCount, members, invitations }: OwnerManagementProps) {
  const inviteOwnerForLeague = inviteOwner.bind(null, leagueId);
  const [state, formAction, pending] = useActionState(inviteOwnerForLeague, initialState);
  const activeInvitations = invitations.filter(
    (invitation) => invitation.status === "pending" && new Date(invitation.expires_at) > new Date(),
  );
  const invitationHistory = invitations.filter(
    (invitation) => invitation.status !== "pending" || new Date(invitation.expires_at) <= new Date(),
  );
  const occupiedSlots = members.length + activeInvitations.length;
  const isFull = occupiedSlots >= ownerCount;

  return (
    <section className="mt-8 grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl bg-white p-6 shadow">
        <h2 className="text-2xl font-bold">Active Members</h2>
        <p className="mt-1 text-sm text-slate-500">{members.length} accepted of {ownerCount} roster spots</p>
        <div className="mt-5 space-y-3">
          {members.map((member) => (
            <div key={member.id} className="flex items-center justify-between rounded-lg bg-slate-100 p-4">
              <div>
                <p className="font-semibold">{member.profile?.display_name ?? "League member"}</p>
                <p className="text-sm capitalize text-slate-500">{member.role}</p>
              </div>
              {member.team_name && <p className="text-sm text-slate-600">{member.team_name}</p>}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-white p-6 shadow">
        <h2 className="text-2xl font-bold">Invite Owners</h2>
        <p className="mt-1 text-sm text-slate-500">
          {activeInvitations.length} pending · {Math.max(ownerCount - occupiedSlots, 0)} spots available
        </p>

        <form action={formAction} className="mt-5 flex flex-col gap-3 sm:flex-row">
          <input
            type="email"
            name="email"
            required
            disabled={isFull || pending}
            placeholder="owner@example.com"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-4 py-2 outline-none focus:border-blue-500 disabled:bg-slate-100"
          />
          <Button className="sm:w-auto" type="submit" variant="success" disabled={isFull || pending}>
            {pending ? "Inviting…" : "Invite Owner"}
          </Button>
        </form>

        {isFull && <p className="mt-3 text-sm text-amber-700">All roster spots are accepted or reserved by pending invitations.</p>}
        {state.error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
        {state.success && (
          <div role="status" className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-700">
            <p>{state.success}</p>
            {state.invitationToken && <CopyInviteButton token={state.invitationToken} />}
          </div>
        )}

        <div className="mt-6 space-y-3">
          {activeInvitations.length === 0 ? (
            <p className="text-sm text-slate-500">No pending invitations.</p>
          ) : activeInvitations.map((invitation) => {
            const invitePath = `/invite/${invitation.invitation_token}`;
            const subject = encodeURIComponent("Join my GameHeelTigerNeerRines HQ league");
            const body = encodeURIComponent(`Use this invitation link to join: ${invitePath}`);
            return (
              <div key={invitation.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{invitation.invited_email}</p>
                    <p className="text-xs text-slate-500">Expires {new Date(invitation.expires_at).toLocaleDateString()}</p>
                  </div>
                  <RevokeButton invitationId={invitation.id} />
                </div>
                <div className="mt-3 flex gap-4">
                  <CopyInviteButton token={invitation.invitation_token} />
                  <a className="text-sm font-semibold text-slate-600 hover:text-slate-900" href={`mailto:${invitation.invited_email}?subject=${subject}&body=${body}`}>
                    Email Link
                  </a>
                </div>
                <p className="mt-2 truncate rounded bg-slate-50 px-2 py-1 font-mono text-xs text-slate-500">
                  /invite/{invitation.invitation_token}
                </p>
              </div>
            );
          })}
        </div>

        {invitationHistory.length > 0 && (
          <details className="mt-5 border-t border-slate-200 pt-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-600">
              Invitation history ({invitationHistory.length})
            </summary>
            <div className="mt-3 space-y-2">
              {invitationHistory.map((invitation) => {
                const status = invitation.status === "pending" ? "expired" : invitation.status;
                return (
                  <div key={invitation.id} className="flex justify-between gap-3 rounded bg-slate-50 px-3 py-2 text-sm">
                    <span className="truncate">{invitation.invited_email}</span>
                    <span className="capitalize text-slate-500">{status}</span>
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
