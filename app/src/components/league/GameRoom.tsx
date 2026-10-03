"use client";

import Link from "next/link";

import { useLiveProjection } from "@/components/projection/useLiveProjection";
import TeamLogo from "@/components/team/TeamLogo";
import type { LiveProjectionResult, ProjectedGameFact, ProjectionOwnerResult } from "@/lib/projection/live-projection";
import { projectionFactsForGame, projectedMovementLabel, signedPoints } from "@/lib/projection/presentation";
import type { Team } from "@/types/database";

export interface GameRoomSide {
  teamId: string | null;
  teamName: string;
  team: Team | null;
  rank: number | null;
  score: number | null;
  ownerName: string | null;
  lineupStatus: "starter" | "bench" | "no_game" | null;
  isCaptain: boolean;
}

export interface GameRoomData {
  id: string;
  week: number;
  kickoff: string;
  status: string;
  liveContext: string | null;
  freshness: string | null;
  home: GameRoomSide;
  away: GameRoomSide;
}

function statusLabel(status: string) {
  if (status === "in_progress") return "LIVE";
  if (status === "completed" || status === "final") return "FINAL";
  if (status === "postponed") return "POSTPONED";
  return "UPCOMING";
}

function lineupLabel(status: GameRoomSide["lineupStatus"]) {
  if (status === "starter") return "Starter";
  if (status === "bench") return "On the bench";
  if (status === "no_game") return "No game";
  return "Lineup unavailable";
}

function ProjectionDetail({ owner, game, bench }: { owner: ProjectionOwnerResult; game: ProjectedGameFact; bench: boolean }) {
  return (
    <div className={`mt-4 rounded-xl border p-4 ${bench ? "border-amber-300 bg-amber-50" : "border-blue-200 bg-blue-50"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-slate-600">{bench ? "On the bench" : game.state === "final_pending" ? "Final — scoring pending" : "If score holds"}</p>
          <p className={`mt-1 text-2xl font-black ${bench ? "text-amber-900" : game.projectedPoints < 0 ? "text-red-700" : "text-green-700"}`}>{signedPoints(game.projectedPoints)}{bench ? " potential" : ""}</p>
        </div>
        {game.captainApplied && <span className="rounded-full bg-amber-400 px-3 py-1.5 text-xs font-black text-amber-950">CAPTAIN ×2</span>}
      </div>
      {game.components.length > 0 && <ul className="mt-3 space-y-2 border-t border-current/10 pt-3 text-sm">
        {game.components.map((component) => <li key={component.ruleId} className="flex justify-between gap-4"><span>{component.displayName}{component.multiplier === 2 ? " · Captain ×2" : ""}</span><strong>{signedPoints(component.points)}</strong></li>)}
      </ul>}
      <p className="mt-3 text-sm font-black text-slate-800">{bench ? "Does not count" : projectedMovementLabel(owner)}</p>
    </div>
  );
}

function SideCard({ side, owner, fact, bench, tied, stale }: { side: GameRoomSide; owner?: ProjectionOwnerResult; fact?: ProjectedGameFact; bench: boolean; tied: boolean; stale: boolean }) {
  return (
    <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label={`${side.teamName}${side.ownerName ? ` owned by ${side.ownerName}` : ", undrafted"}`}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100"><TeamLogo team={side.team ?? { school_name: side.teamName }} size="md" decorative /></span>
          <div className="min-w-0"><h2 className="break-words text-xl font-black text-blue-950">{side.rank ? `#${side.rank} ` : ""}{side.teamName}</h2><p className="break-words text-sm font-bold text-slate-600">{side.ownerName ?? "Undrafted opponent"}</p></div>
        </div>
        {side.score !== null && <p className="shrink-0 text-4xl font-black text-blue-950">{side.score}</p>}
      </div>
      {side.ownerName && <div className="mt-4 flex flex-wrap gap-2 text-xs font-black uppercase tracking-wide"><span className={`rounded-full px-3 py-1.5 ${side.lineupStatus === "starter" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-900"}`}>{lineupLabel(side.lineupStatus)}</span>{side.isCaptain && <span className="rounded-full bg-amber-400 px-3 py-1.5 text-amber-950">Captain ×2</span>}</div>}
      {stale && side.ownerName && <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm font-bold text-slate-700">Live projection temporarily unavailable for this game. Official points remain authoritative.</p>}
      {tied && side.ownerName && <p className="mt-4 rounded-lg bg-orange-50 p-3 text-sm font-black uppercase tracking-wide text-orange-800">Tied — unresolved</p>}
      {owner && fact && <ProjectionDetail owner={owner} game={fact} bench={bench} />}
    </article>
  );
}

export default function GameRoom({ leagueId, game, fixtureProjection = null }: { leagueId: string; game: GameRoomData; fixtureProjection?: LiveProjectionResult | null }) {
  const { projection, refreshFailed } = useLiveProjection(leagueId, fixtureProjection);
  const context = projectionFactsForGame(projection, game.id);
  const factByTeam = new Map(context.owners.map((item) => [item.game.teamId, item]));
  const homeFact = game.home.teamId ? factByTeam.get(game.home.teamId) : undefined;
  const awayFact = game.away.teamId ? factByTeam.get(game.away.teamId) : undefined;
  const bothDrafted = Boolean(game.home.ownerName && game.away.ownerName);
  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="bg-blue-950 text-white">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3"><Link href={`/league/${leagueId}`} className="inline-flex min-h-11 items-center font-black text-orange-200 hover:underline">← Saturday Home</Link><Link href={`/league/${leagueId}/standings`} className="inline-flex min-h-11 items-center font-black text-orange-200 hover:underline">View standings →</Link></div>
          <p className="mt-4 text-xs font-black uppercase tracking-[0.2em] text-orange-300">Game Room · Week {game.week}</p>
          <h1 className="mt-1 break-words text-3xl font-black sm:text-4xl">{game.away.teamName} at {game.home.teamName}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-black ${game.status === "in_progress" ? "bg-red-600 text-white" : "bg-white/15 text-white"}`}>{statusLabel(game.status)}</span><span className="font-bold text-blue-100">{game.kickoff}</span>{game.liveContext && <span className="font-black text-orange-200">{game.liveContext}</span>}</div>
          {game.freshness && <p className="mt-2 text-sm font-semibold text-blue-200">{game.freshness}</p>}
        </div>
      </header>
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
        {bothDrafted && <div className="rounded-xl border border-orange-300 bg-orange-50 px-4 py-3"><p className="text-xs font-black uppercase tracking-[0.18em] text-orange-800">League head-to-head</p><p className="mt-1 font-bold text-slate-800">Both sides matter to this league.</p></div>}
        {refreshFailed && <p className="rounded-xl bg-slate-200 px-4 py-3 text-sm font-bold text-slate-700">Live pool projection is temporarily unavailable. Game and official scoring information remain available.</p>}
        <div className="grid gap-4 md:grid-cols-2">
          <SideCard side={game.away} owner={awayFact?.owner} fact={awayFact?.game} bench={awayFact?.bench ?? false} tied={context.tied} stale={context.stale} />
          <SideCard side={game.home} owner={homeFact?.owner} fact={homeFact?.game} bench={homeFact?.bench ?? false} tied={context.tied} stale={context.stale} />
        </div>
        <p className="rounded-xl bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">Live data is informational · Official points settle through league scoring.</p>
      </div>
    </main>
  );
}
