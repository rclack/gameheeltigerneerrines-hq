import Link from "next/link";

import AcceptInvitation from "@/components/invitations/AcceptInvitation";
import Card from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/server";
import { getInvitationByToken } from "@/services/invitationService";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const returnPath = `/invite/${encodeURIComponent(token)}`;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-blue-950 to-slate-900 px-4">
        <div className="w-full max-w-lg">
          <Card title="You&apos;re invited 🏈">
            <p className="mb-6 text-slate-300">Sign in or create an account using the email address that received this invitation.</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-center font-semibold text-white hover:bg-blue-700" href={`/login?next=${encodeURIComponent(returnPath)}`}>
                Sign In
              </Link>
              <Link className="flex-1 rounded-lg bg-orange-500 px-4 py-2 text-center font-semibold text-white hover:bg-orange-600" href={`/signup?next=${encodeURIComponent(returnPath)}`}>
                Create Account
              </Link>
            </div>
          </Card>
        </div>
      </main>
    );
  }

  const invitation = /^[a-f0-9]{64}$/.test(token)
    ? await getInvitationByToken(supabase, token)
    : null;
  const isExpired = invitation ? new Date(invitation.expires_at) <= new Date() : false;
  const acceptedByCurrentUser = invitation?.status === "accepted"
    && invitation.accepted_by === user.id;
  const { data: acceptedMembership } = acceptedByCurrentUser
    ? await supabase
        .from("league_members")
        .select("id")
        .eq("league_id", invitation.league_id)
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-blue-950 to-slate-900 px-4">
      <div className="w-full max-w-lg">
        <Card title="League Invitation">
          <div className="space-y-5 text-slate-300">
            <p>Signed in as <span className="font-semibold text-white">{user.email}</span></p>
            {invitation ? (
              <>
                <p>This invitation is intended for <span className="font-semibold text-white">{invitation.invited_email}</span>.</p>
                {invitation.status === "accepted" && acceptedMembership ? (
                  <div role="status" className="space-y-4 rounded-lg bg-green-950/60 p-4 text-green-100">
                    <p>You already accepted this invitation and are a member of the league.</p>
                    <Link
                      href={`/league/${invitation.league_id}`}
                      className="block rounded-lg bg-green-600 px-5 py-3 text-center font-bold text-white hover:bg-green-700"
                    >
                      Go to League →
                    </Link>
                  </div>
                ) : invitation.status === "pending" && !isExpired ? (
                  <AcceptInvitation token={token} />
                ) : (
                  <p role="alert" className="rounded-lg bg-amber-950/70 p-3 text-amber-200">
                    {invitation.status === "pending" && isExpired
                      ? "This invitation has expired."
                      : `This invitation is ${invitation.status}.`}
                  </p>
                )}
              </>
            ) : (
              <>
                <p>This link is invalid, or it was sent to a different email address.</p>
                <AcceptInvitation token={token} />
              </>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}
