import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { retryLeagueRequestEmail } from "./actions";

export default async function LeaguesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/leagues");

  const [{ data: memberships, error: membershipsError }, { data: pendingRequest }] = await Promise.all([supabase
    .from("league_members")
    .select("league_id, role")
    .eq("user_id", user.id), supabase.from("league_creation_requests").select("*").eq("requester_id", user.id).eq("status", "pending").gt("expires_at", new Date().toISOString()).maybeSingle()]);

  if (membershipsError) throw membershipsError;

  const membershipByLeague = new Map(
    memberships.map((membership) => [membership.league_id, membership.role]),
  );
  const leagueIds = Array.from(membershipByLeague.keys());
  const { data: leagues, error: leaguesError } = leagueIds.length
    ? await supabase
        .from("leagues")
        .select("id, name, season, commissioner_id, created_at")
        .in("id", leagueIds)
        .order("season", { ascending: false })
        .order("created_at", { ascending: false })
    : { data: [], error: null };

  if (leaguesError) throw leaguesError;

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-16 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <header className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#081f43] via-[#0b2b59] to-blue-800 px-6 py-7 text-white shadow-xl sm:px-8">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-300">League Central</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
            {leagues.length === 1 ? "My League" : "My Leagues"}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100">
            Open your league headquarters, follow the season, and enter the draft room from one place.
          </p>
        </header>

        {leagues.length ? (
          <section aria-label="Your leagues" className="mt-6 grid gap-4 sm:grid-cols-2">
            {leagues.map((league) => {
              const role = membershipByLeague.get(league.id);
              const isCommissioner = role === "commissioner" && league.commissioner_id === user.id;

              return (
                <article key={league.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{league.season} Season</p>
                      <h2 className="mt-1 text-xl font-black text-[#0b2b59]">{league.name}</h2>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${isCommissioner ? "bg-orange-100 text-orange-800" : "bg-blue-100 text-blue-800"}`}>
                      {isCommissioner ? "Commissioner" : "Owner"}
                    </span>
                  </div>

                  <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                    <Link
                      href={`/league/${league.id}`}
                      className="flex-1 rounded-lg bg-[#0b2b59] px-4 py-2.5 text-center text-sm font-bold text-white transition hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2"
                    >
                      Open League
                    </Link>
                    {isCommissioner ? (
                      <Link
                        href={`/commissioner/${league.id}`}
                        className="flex-1 rounded-lg bg-orange-500 px-4 py-2.5 text-center text-sm font-bold text-white transition hover:bg-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2"
                      >
                        Commissioner HQ
                      </Link>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </section>
        ) : (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm sm:p-10">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-2xl" aria-hidden="true">🏈</div>
            <h2 className="mt-4 text-2xl font-black text-[#0b2b59]">No leagues yet</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
              If a commissioner invited you, open the Join League link from your invitation email while signed in with the invited address.
            </p>
          </section>
        )}
        <section className="mt-6 rounded-2xl border border-orange-200 bg-white p-6 shadow-sm" aria-labelledby="new-league-heading">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-700">League creation</p>
          <h2 id="new-league-heading" className="mt-1 text-xl font-black text-[#0b2b59]">{pendingRequest ? "Pending Approval" : "Request New League"}</h2>
          {pendingRequest ? <><p className="mt-2 text-sm leading-6 text-slate-600"><strong>{pendingRequest.proposed_name}</strong> is awaiting site-administrator review. No production league has been created.</p><dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><div><dt className="font-bold text-slate-500">Season</dt><dd>{pendingRequest.season}</dd></div><div><dt className="font-bold text-slate-500">Format</dt><dd>{pendingRequest.owner_count} owners · {pendingRequest.teams_per_owner} teams each</dd></div><div><dt className="font-bold text-slate-500">Notification</dt><dd className="capitalize">{pendingRequest.notification_status}</dd></div></dl>{pendingRequest.notification_status === "failed" ? <form action={async () => { "use server"; await retryLeagueRequestEmail(pendingRequest.id); }}><button type="submit" className="mt-4 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-orange-600">Retry Approval Email</button></form> : null}</> : <><p className="mt-2 text-sm leading-6 text-slate-600">Propose a league format and optional draft roster rules. The site administrator must approve it before the league exists.</p><Link href="/leagues/request" className="mt-4 inline-block rounded-lg bg-orange-500 px-5 py-2.5 font-bold text-white transition hover:bg-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2">Request New League →</Link></>}
        </section>
      </div>
    </main>
  );
}
