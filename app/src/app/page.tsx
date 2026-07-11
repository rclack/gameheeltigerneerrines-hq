import { getLeagues } from "@/services/leagueService";

export default async function Home() {
  const leagues = await getLeagues();

  return (
    <main className="min-h-screen bg-gradient-to-b from-blue-950 to-slate-900 text-white flex items-center justify-center">
      <div className="text-center space-y-6 max-w-2xl">
        <h1 className="text-6xl font-extrabold">
          🏈 GameHeelTigerNeerRines HQ
        </h1>

        <p className="text-2xl text-slate-300">
          Home of the Greatest College Football Draft League
        </p>

        <div className="space-y-2">
          <p className="text-xl">2026 Season</p>
          <p className="text-slate-400">Version 0.0.1</p>
        </div>

        <div className="rounded-xl bg-green-900/40 border border-green-500 p-4">
          <h2 className="text-xl font-bold text-green-300">
            Database Status: Connected ✅
          </h2>

          <p className="mt-2 text-slate-300">
            {leagues.length} league(s) found.
          </p>

          <div className="mt-4 space-y-2">
            {leagues.map((league) => (
              <div
                key={league.id}
                className="rounded bg-slate-800 px-4 py-2"
              >
                {league.name}
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-center gap-4 pt-6">
          <button className="rounded-xl bg-blue-600 px-6 py-3 font-semibold hover:bg-blue-700 transition">
            Commissioner Login
          </button>

          <button className="rounded-xl bg-orange-500 px-6 py-3 font-semibold hover:bg-orange-600 transition">
            View Standings
          </button>
        </div>
      </div>
    </main>
  );
}