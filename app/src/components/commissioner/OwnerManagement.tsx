"use client";

import { useActionState, useState } from "react";

import {
  inviteOwner,
  resendOwnerInvitationEmail,
  revokeOwnerInvitation,
  type InvitationActionState,
} from "@/app/commissioner/actions";
import Button from "@/components/ui/Button";
import type { LeagueInvitation } from "@/types/database";
import type { MemberWithProfile } from "@/services/membershipService";

interface OwnerManagementProps {
  leagueId: string;
  ownerCount: number;
  members: MemberWithProfile[];
  invitations: LeagueInvitation[];
  siteOrigin: string;
}

const initialState: InvitationActionState = {};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatInvitationExpiry(value: string) {
  const date = new Date(value);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function CopyInviteButton({ token, siteOrigin }: { token: string; siteOrigin: string }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    await navigator.clipboard.writeText(`${siteOrigin}/invite/${encodeURIComponent(token)}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button type="button" onClick={copyLink} className="rounded text-sm font-bold text-blue-700 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2">
      {copied ? "Copied!" : "Copy Invite Link"}
    </button>
  );
}

function RevokeButton({ invitationId }: { invitationId: string }) {
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
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
      {confirming ? (
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="rounded px-2 py-1 text-xs font-bold text-slate-600 hover:text-slate-900">Cancel</button>
          <button type="button" disabled={pending} onClick={revoke} className="rounded bg-red-700 px-2 py-1 text-xs font-black text-white hover:bg-red-800 disabled:opacity-50">{pending ? "Revoking…" : "Confirm revoke"}</button>
        </div>
      ) : (
        <button type="button" disabled={pending} onClick={() => setConfirming(true)} className="rounded text-sm font-bold text-red-700 hover:text-red-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:opacity-50">Revoke</button>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function RetryInvitationEmailButton({ invitationId }: { invitationId: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});

  async function retryEmail() {
    if (pending) return;
    setPending(true);
    setMessage({});
    try {
      const result = await resendOwnerInvitationEmail(invitationId);
      setMessage(result);
    } catch {
      setMessage({ error: "The invitation email could not be sent. Try again later." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={retryEmail}
        className="rounded text-sm font-bold text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:opacity-50"
      >
        {pending ? "Sending…" : "Retry Email"}
      </button>
      {message.error ? <p role="alert" className="mt-1 text-xs text-red-600">{message.error}</p> : null}
      {message.success ? <p role="status" className="mt-1 text-xs text-emerald-700">{message.success}</p> : null}
    </div>
  );
}

export default function OwnerManagement({ leagueId, ownerCount, members, invitations, siteOrigin }: OwnerManagementProps) {
  const [managing, setManaging] = useState(false);
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
    <section id="owner-management" className="mt-10 scroll-mt-6" aria-labelledby="owner-management-title">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">Owner roster</p>
            <h2 id="owner-management-title" className="mt-1 text-2xl font-black tracking-tight">{members.length} of {ownerCount} Owners Confirmed</h2>
            <p className="mt-2 text-sm text-slate-500">
              {activeInvitations.length > 0
                ? `${activeInvitations.length} invitation${activeInvitations.length === 1 ? "" : "s"} pending · ${Math.max(ownerCount - occupiedSlots, 0)} spots open`
                : `${Math.max(ownerCount - occupiedSlots, 0)} roster spot${Math.max(ownerCount - occupiedSlots, 0) === 1 ? "" : "s"} available`}
            </p>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex -space-x-2" aria-label={`${members.length} confirmed owners`}>
              {members.slice(0, 6).map((member) => (
                <span key={member.id} title={member.profile?.display_name ?? "League member"} className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white bg-[#0b2b59] text-xs font-black text-white shadow-sm">
                  {(member.profile?.display_name ?? "L").charAt(0).toUpperCase()}
                </span>
              ))}
              {members.length > 6 ? <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-xs font-black text-slate-700">+{members.length - 6}</span> : null}
            </div>
            <button
              type="button"
              onClick={() => setManaging((current) => !current)}
              aria-expanded={managing}
              aria-controls="owner-management-controls"
              className="rounded-lg bg-slate-800 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
            >
              {managing ? "Close Owner Management" : "Manage Owners"}
            </button>
          </div>
        </div>
      </div>

      {managing ? (
      <div id="owner-management-controls" className="mt-4 grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid-cols-2 lg:divide-x lg:divide-slate-200">
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-black text-slate-950">Active Members</h3>
              <p className="mt-1 text-sm text-slate-500">Confirmed owners with access to the league</p>
            </div>
            <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-sm font-black text-blue-800">{members.length}/{ownerCount}</span>
          </div>
          <div className="mt-5 space-y-2">
          {members.map((member) => (
            <div key={member.id} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 transition hover:border-slate-300">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0b2b59] text-sm font-black text-white">
                  {(member.profile?.display_name ?? "L").charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-900">{member.profile?.display_name ?? "League member"}</p>
                  <p className="text-xs font-semibold capitalize text-slate-500">{member.role}</p>
                </div>
              </div>
              {member.team_name ? <p className="truncate text-right text-sm font-semibold text-slate-600">{member.team_name}</p> : null}
            </div>
          ))}
        </div>
      </div>

        <div className="border-t border-slate-200 p-5 sm:p-6 lg:border-t-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-black text-slate-950">Recruit Owners</h3>
              <p className="mt-1 text-sm text-slate-500">Send secure invitations to fill the remaining roster</p>
            </div>
            <span className="shrink-0 rounded-lg bg-orange-50 px-2.5 py-1 text-sm font-black text-orange-700">{Math.max(ownerCount - occupiedSlots, 0)} open</span>
          </div>

        <form action={formAction} className="mt-5 flex flex-col gap-3 sm:flex-row">
          <label htmlFor="owner-invite-email" className="sr-only">Owner email address</label>
          <input
            id="owner-invite-email"
            type="email"
            name="email"
            required
            disabled={isFull || pending}
            placeholder="owner@example.com"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-700 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
          />
          <Button className="sm:w-auto" type="submit" variant="sports" disabled={isFull || pending}>
            {pending ? "Inviting…" : "Invite Owner"}
          </Button>
        </form>

        {isFull ? <p className="mt-3 text-sm font-medium text-amber-800">All roster spots are accepted or reserved by pending invitations.</p> : null}
        {state.error ? <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{state.error}</p> : null}
        {state.success && (
          <div
            role="status"
            className={`mt-3 rounded-lg border p-3 text-sm ${state.emailError ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
          >
            <p>{state.success}</p>
            {state.emailError ? <p role="alert" className="mt-2 font-semibold">{state.emailError}</p> : null}
            {state.invitationToken && <CopyInviteButton token={state.invitationToken} siteOrigin={siteOrigin} />}
          </div>
        )}

        <div className="mt-6 space-y-3 border-t border-slate-200 pt-5">
          {activeInvitations.length === 0 ? (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">No pending invitations. Your recruiting board is clear.</p>
          ) : activeInvitations.map((invitation) => {
            const invitePath = `/invite/${encodeURIComponent(invitation.invitation_token)}`;
            const inviteUrl = `${siteOrigin}${invitePath}`;
            return (
              <div key={invitation.id} className="rounded-xl border border-slate-200 p-4 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{invitation.invited_email}</p>
                    <p className="text-xs text-slate-500">Expires {formatInvitationExpiry(invitation.expires_at)}</p>
                  </div>
                  <RevokeButton invitationId={invitation.id} />
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                  <CopyInviteButton token={invitation.invitation_token} siteOrigin={siteOrigin} />
                  <RetryInvitationEmailButton invitationId={invitation.id} />
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  If email delivery is delayed, Copy Invite Link is the reliable fallback.
                </p>
                <p className="mt-2 truncate rounded bg-slate-100 px-2 py-1.5 font-mono text-xs text-slate-500">
                  {inviteUrl}
                </p>
              </div>
            );
          })}
        </div>

        {invitationHistory.length > 0 && (
          <details className="mt-5 border-t border-slate-200 pt-4">
            <summary className="cursor-pointer rounded text-sm font-bold text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2">
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
      </div>
      ) : null}
    </section>
  );
}
