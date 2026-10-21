import { notFound } from "next/navigation";

import LeagueChaos from "@/components/league/LeagueChaos";
import { busyChaosFixture, chaosFixtureLeagueId, emptyChaosFixture } from "@/lib/chaos/fixtures";

export default async function ChaosFeedPreviewPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  const fixture = query.state === "empty" ? emptyChaosFixture : busyChaosFixture;
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-fuchsia-700">Deterministic visual fixture</p>
        <h1 className="mt-1 text-3xl font-black text-blue-950">League Chaos</h1>
        <div className="mt-6"><LeagueChaos leagueId={chaosFixtureLeagueId} fixture={fixture} /></div>
      </div>
    </main>
  );
}
