"use client";

import Link from "next/link";

import { useLiveProjection } from "@/components/projection/useLiveProjection";
import TeamLogo from "@/components/team/TeamLogo";
import type { LiveProjectionResult } from "@/lib/projection/live-projection";
import { projectionFactsForGame, signedPoints } from "@/lib/projection/presentation";
import type { Team } from "@/types/database";

export interface SaturdayWatchlistGame {
  id: string;
  week: number;
  status: string;
  dateLabel: string;
  ownedTeamName: string;
  ownedTeam: Team | null;
  ownedRank: number | null;
  opponentName: string;
  opponentTeam: Team | null;
  opponentRank: number | null;
  context: "vs" | "at";
  homeScore: number | null;
  awayScore: number | null;
  liveContext: string | null;
  freshness: string | null;
}

function statusLabel(status: string) {
  if (status === "in_progress") return "Live";
  if (status === "completed" || status === "final") return "Final";
  if (status === "postponed") return "Postponed";
  return "Upcoming";
}

function CompactProjection({ projection, gameId }: { projection: LiveProjectionResult | null; gameId: string }) {
  const context = projectionFactsForGame(projection, gameId);
  if (context.stale) return <p className="mt-3 text-xs font-bold text-slate-500">Projection temporarily unavailable</p>;
  if (context.tied) return <p className="mt-3 text-xs font-black uppercase tracking-wide text-orange-700">Tied — unresolved</p>;
  if (!context.owners.length) return null;
  return (
    <div className="mt-3 space-y-2 border-t border-slate-200 pt-3" aria-label="Live pool projection">
      {context.owners.map(({ owner, game, bench }) => (
        <div key={`${owner.memberId}:${game.teamId}`} className="flex items-start justify-between gap-3 text-sm">
          <div className="min-w-0">
            <p className="break-words font-black text-blue-950">{owner.displayName} — {game.teamName}</p>
            <p className="text-xs font-bold text-slate-600">
              {bench ? "On bench · does not count" : game.state === "final_pending" ? "Final — scoring pending" : "If score holds"}
              {game.captainApplied ? " · Captain ×2" : ""}
            </p>
          </div>
          <p className={`shrink-0 font-black ${bench ? "text-amber-800" : game.projectedPoints < 0 ? "text-red-700" : "text-green-700"}`}>
            {signedPoints(game.projectedPoints)}{bench ? " potential" : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function SaturdayWatchlist({
  leagueId,
  games,
  accentColor,
  fixtureProjection = null,
}: {
  leagueId: string;
  games: SaturdayWatchlistGame[];
  accentColor: string;
  fixtureProjection?: LiveProjectionResult | null;
}) {
  const { projection } = useLiveProjection(leagueId, fixtureProjection);
  return (
    <section className="rounded-2xl bg-white p-5 shadow" aria-labelledby="watchlist-heading">
      <div className="flex items-end justify-between gap-4">
        <div><p className="text-xs font-black uppercase tracking-widest" style={{ color: accentColor }}>What matters next</p><h2 id="watchlist-heading" className="mt-1 text-2xl font-black">Saturday Watchlist</h2></div>
        <p className="text-xs font-semibold text-slate-500">Next {games.length} games</p>
      </div>
      {games.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {games.map((game) => (
            <article key={game.id} className={`min-w-0 rounded-xl border p-4 ${game.status === "in_progress" ? "border-orange-400 bg-orange-50" : "border-slate-200 bg-slate-50"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase ${game.status === "in_progress" ? "bg-red-600 text-white" : "bg-blue-100 text-blue-800"}`}>{statusLabel(game.status)}</span>
                <span className="text-xs font-bold text-slate-500">Week {game.week}</span>
              </div>
              <div className="mt-3 flex min-w-0 items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm"><TeamLogo team={game.ownedTeam ?? { school_name: game.ownedTeamName }} size="md" decorative /></span>
                <p className="min-w-0 break-words text-lg font-black">{game.ownedRank ? `#${game.ownedRank} ` : ""}{game.ownedTeamName}</p>
              </div>
              <p className="my-1 text-xs font-bold uppercase tracking-wider text-slate-400">{game.context}</p>
              <div className="flex min-w-0 items-center gap-2"><TeamLogo team={game.opponentTeam ?? { school_name: game.opponentName }} size="sm" decorative /><p className="min-w-0 break-words font-bold text-slate-700">{game.opponentRank ? `#${game.opponentRank} ` : ""}{game.opponentName}</p></div>
              <div className="mt-3 border-t border-slate-200 pt-3">
                <p className="font-bold text-blue-950">{game.dateLabel}</p>
                {game.status === "in_progress" && game.homeScore !== null && game.awayScore !== null && <p className="mt-1 text-sm font-black text-red-700">Live score: {game.awayScore}–{game.homeScore}</p>}
                {(game.status === "completed" || game.status === "final") && game.homeScore !== null && game.awayScore !== null && <p className="mt-1 text-sm font-black text-blue-950">Final: {game.awayScore}–{game.homeScore}</p>}
                {game.liveContext && <p className="mt-1 text-xs font-bold uppercase tracking-wide text-red-700">{game.liveContext}</p>}
                {game.freshness && <p className="mt-1 text-xs font-semibold text-slate-500">{game.freshness}</p>}
              </div>
              <CompactProjection projection={projection} gameId={game.id} />
              <Link href={`/league/${leagueId}/games/${game.id}`} className="mt-3 inline-flex min-h-11 items-center font-black text-blue-800 hover:underline" aria-label={`Open Game Room for ${game.ownedTeamName} ${game.context} ${game.opponentName}`}>Open Game Room →</Link>
            </article>
          ))}
        </div>
      ) : <p className="mt-4 rounded-xl bg-slate-100 p-4 text-slate-600">No current or upcoming games are on your synchronized schedule yet.</p>}
      <Link href={`/league/${leagueId}/standings`} className="mt-4 inline-flex min-h-11 items-center text-sm font-black text-blue-800 hover:underline">View standings →</Link>
    </section>
  );
}
