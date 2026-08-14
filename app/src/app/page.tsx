import Link from "next/link";

import { signOut } from "@/app/auth/actions";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: memberships } = user
    ? await supabase.from("league_members").select("league_id, role").eq("user_id", user.id)
    : { data: null };
  const leagueIds = memberships?.map((membership) => membership.league_id) ?? [];
  const { data: leagues } = leagueIds.length
    ? await supabase.from("leagues").select("id, name, season, commissioner_id").in("id", leagueIds)
    : { data: [] };
  const userLeagues = leagues ?? [];
  const ownsLeague = userLeagues.some((league) => league.commissioner_id === user?.id);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-blue-950 to-slate-900 px-6 text-white">
      <div className="max-w-3xl space-y-8 text-center">
        <h1 className="text-3xl font-extrabold md:text-5xl lg:text-6xl">
          🏈 GameHeelTigerNeerRines HQ
        </h1>

        <p className="text-2xl text-slate-300">
          Home of the Greatest College Football Draft League
        </p>

        <div className="space-y-2">
          <p className="text-xl">2026 Season</p>
          <p className="text-slate-400">Build your league. Draft your teams. Own Saturdays.</p>
        </div>

        <div className="flex flex-col justify-center gap-4 pt-6 sm:flex-row">
          {(!user || ownsLeague) && <Link
            href={user ? "/commissioner" : "/login"}
            className="rounded-xl bg-blue-600 px-6 py-3 font-semibold transition hover:bg-blue-700"
          >
            {user ? "Open Commissioner Portal" : "Commissioner Login"}
          </Link>}

          {!user && (
            <Link
              href="/signup"
              className="rounded-xl bg-orange-500 px-6 py-3 font-semibold transition hover:bg-orange-600"
            >
              Create Account
            </Link>
          )}

          {user && (
            <form action={signOut}>
              <button className="rounded-xl bg-slate-700 px-6 py-3 font-semibold transition hover:bg-slate-600" type="submit">
                Sign Out
              </button>
            </form>
          )}
        </div>

        {user && userLeagues.length > 0 && (
          <div className="mx-auto max-w-xl rounded-xl border border-slate-700 bg-slate-900/70 p-5 text-left">
            <h2 className="font-bold">Your Leagues</h2>
            <div className="mt-3 space-y-2">
              {userLeagues.map((league) => (
                <Link key={league.id} href={`/league/${league.id}`} className="flex justify-between rounded-lg bg-slate-800 px-4 py-3 hover:bg-slate-700">
                  <span>{league.name}</span><span className="text-slate-400">{league.season} →</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
