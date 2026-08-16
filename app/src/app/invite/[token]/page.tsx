import Link from "next/link";

import { switchInvitationAccount } from "@/app/invite/[token]/actions";
import AuthPageFrame from "@/components/auth/AuthPageFrame";
import AcceptInvitation from "@/components/invitations/AcceptInvitation";
import { createClient } from "@/lib/supabase/server";
import { inspectInvitationByToken } from "@/services/invitationService";

function InvitationShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthPageFrame eyebrow="You're on the roster" title="League invitation" introduction="Use the invited email address to join your owner group and get ready for the draft." maxWidth="lg">
      {children}
    </AuthPageFrame>
  );
}

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const validToken = /^[a-f0-9]{64}$/.test(token);
  const returnPath = `/invite/${encodeURIComponent(token)}`;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!validToken) {
    return (
      <InvitationShell>
        <p role="alert" className="rounded-lg bg-red-950/70 p-4 text-red-100">
          This invitation link is invalid. Check that you copied the complete link, or ask the commissioner for a new invitation.
        </p>
      </InvitationShell>
    );
  }

  if (!user) {
    return (
      <InvitationShell>
        <div className="space-y-5 text-slate-300">
          <div>
            <p className="text-lg font-bold text-white">You&apos;re invited</p>
            <p className="mt-2">Sign in or create an account using the email address that received this invitation.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link className="flex-1 rounded-lg bg-blue-600 px-4 py-3 text-center font-bold text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300" href={`/login?next=${encodeURIComponent(returnPath)}`}>
              Sign In
            </Link>
            <Link className="flex-1 rounded-lg bg-orange-500 px-4 py-3 text-center font-bold text-white transition hover:bg-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300" href={`/signup?next=${encodeURIComponent(returnPath)}`}>
              Create Account
            </Link>
          </div>
          <p className="text-xs leading-5 text-slate-400">Your invitation link will be preserved while you sign in, sign up, or confirm a new account.</p>
        </div>
      </InvitationShell>
    );
  }

  let inspection = null;
  let inspectionFailed = false;
  try {
    inspection = await inspectInvitationByToken(supabase, token);
  } catch {
    inspectionFailed = true;
  }

  if (inspectionFailed) {
    return (
      <InvitationShell>
        <div className="space-y-4 text-slate-300">
          <p>Signed in as <span className="font-semibold text-white">{user.email}</span></p>
          <p role="alert" className="rounded-lg bg-red-950/70 p-4 text-red-100">
            We couldn&apos;t check this invitation right now. Please refresh the page and try again.
          </p>
        </div>
      </InvitationShell>
    );
  }

  if (!inspection) {
    return (
      <InvitationShell>
        <div className="space-y-4 text-slate-300">
          <p>Signed in as <span className="font-semibold text-white">{user.email}</span></p>
          <p role="alert" className="rounded-lg bg-red-950/70 p-4 text-red-100">
            This invitation link is invalid. Ask the commissioner to confirm or replace the invitation.
          </p>
        </div>
      </InvitationShell>
    );
  }

  const currentEmail = user.email?.trim().toLowerCase() ?? "";
  const wrongAccount = currentEmail !== inspection.invited_email;
  const expired = new Date(inspection.expires_at) <= new Date();
  const switchAccount = switchInvitationAccount.bind(null, token);

  return (
    <InvitationShell>
      <div className="space-y-5 text-slate-300">
        <div className="space-y-2 rounded-lg bg-slate-900/70 p-4">
          <p>Signed in as <span className="font-semibold text-white">{user.email}</span></p>
          <p>Invitation for <span className="font-semibold text-white">{inspection.invited_email}</span></p>
        </div>

        {inspection.invitation_status === "revoked" ? (
          <p role="alert" className="rounded-lg bg-amber-950/70 p-4 text-amber-100">
            This invitation was revoked by the commissioner. Ask them for a new invitation if you should still join.
          </p>
        ) : inspection.invitation_status === "accepted" && inspection.accepted_by_current_user ? (
          <div role="status" className="space-y-4 rounded-lg bg-green-950/60 p-4 text-green-100">
            <p>You already accepted this invitation and are a member of the league.</p>
            <Link href={`/league/${inspection.league_id}`} className="block rounded-lg bg-green-600 px-5 py-3 text-center font-bold text-white transition hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-300">
              Go to League
            </Link>
          </div>
        ) : inspection.invitation_status === "accepted" ? (
          <p role="alert" className="rounded-lg bg-amber-950/70 p-4 text-amber-100">
            This invitation has already been accepted and can&apos;t be used again.
          </p>
        ) : expired ? (
          <p role="alert" className="rounded-lg bg-amber-950/70 p-4 text-amber-100">
            This invitation has expired. Ask the commissioner for a new invitation link.
          </p>
        ) : wrongAccount ? (
          <div className="space-y-4 rounded-lg border border-orange-400/40 bg-orange-950/40 p-4">
            <div>
              <p className="font-bold text-orange-100">Switch accounts to continue</p>
              <p className="mt-2 text-sm leading-6 text-orange-100/80">
                This invitation belongs to {inspection.invited_email}. Acceptance is unavailable while you&apos;re signed in as {user.email}.
              </p>
            </div>
            <form action={switchAccount}>
              <button type="submit" className="w-full rounded-lg bg-orange-500 px-5 py-3 font-bold text-white transition hover:bg-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">
                Sign in as {inspection.invited_email}
              </button>
            </form>
            <p className="text-center text-xs text-orange-100/70">You&apos;ll return to this invitation automatically after signing in.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-400">Your account matches this invitation. Accept to join the league as an owner.</p>
            <AcceptInvitation token={token} />
          </div>
        )}
      </div>
    </InvitationShell>
  );
}
