"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import TeamLogo from "@/components/team/TeamLogo";
import { favoriteTeamTheme } from "@/lib/league/favorite-team-theme";
import type { LiveProjectionResult, ProjectedGameFact, ProjectionOwnerResult } from "@/lib/projection/live-projection";
import {
  hasMeaningfulProjectionContext,
  LIVE_PROJECTION_REFRESH_MS,
  projectedGameSummary,
  projectedMovementLabel,
  projectionFreshnessLabel,
  provisionalPoints,
  signedPoints,
} from "@/lib/projection/presentation";
import type { Team } from "@/types/database";

export interface StandingsLeaderboardRow {
  rank: number;
  memberId: string;
  userId: string;
  ownerName: string;
  poolTeamName: string | null;
  totalPoints: number;
  weeklyPoints: number;
  draftedTeamCount: number;
  draftedTeams: Team[];
  favoriteTeam: Team | null;
  latestEvent: { points: number; teamName: string; ruleName: string } | null;
  strongestTeam: { teamName: string; points: number } | null;
  pointsBehindLeader: number;
}

function placeLabel(rank: number, tied: boolean) {
  return `${tied ? "T-" : ""}${rank}`;
}

function placeStyle(rank: number) {
  if (rank === 1) return "border-amber-300 bg-amber-400 text-amber-950 shadow-amber-200";
  if (rank === 2) return "border-slate-300 bg-slate-200 text-slate-800 shadow-slate-200";
  if (rank === 3) return "border-orange-300 bg-orange-200 text-orange-950 shadow-orange-200";
  return "border-blue-900 bg-blue-950 text-white shadow-blue-950/20";
}

function gameDetail(game: ProjectedGameFact, bench = false) {
  return (
    <div key={`${game.gameId}:${game.teamId}`} className={`rounded-xl border p-3 ${bench ? "border-amber-200 bg-amber-50" : "border-blue-100 bg-blue-50/70"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-black text-slate-950">{game.teamName} vs {game.opponentName}</p>
          <p className="mt-0.5 text-sm font-bold text-slate-600">{projectedGameSummary(game)}</p>
        </div>
        {game.captainApplied && <span className="rounded-full bg-amber-400 px-2.5 py-1 text-xs font-black text-amber-950">CAPTAIN ×2</span>}
      </div>
      {game.components.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-slate-700">
          {game.components.map((component) => (
            <li key={component.ruleId} className="flex justify-between gap-4">
              <span>{component.displayName}{component.multiplier === 2 ? " · Captain ×2" : ""}</span>
              <span className="shrink-0 font-black">{signedPoints(component.points)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex items-center justify-between gap-4 border-t border-current/10 pt-2 text-sm font-black">
        <span>{bench ? "Does not count" : "If score holds"}</span>
        <span>{bench ? `${signedPoints(game.projectedPoints)} potential` : signedPoints(game.projectedPoints)}</span>
      </div>
    </div>
  );
}

function ProjectionDetails({ owner, expanded = false }: { owner: ProjectionOwnerResult; expanded?: boolean }) {
  if (!owner.contributingGames.length && !owner.benchPotential.length) return null;
  return (
    <details open={expanded} className="border-t border-slate-200 px-4 py-3 sm:px-5">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-black text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700">
        Why this projection?
      </summary>
      <div className="grid gap-3 pb-2 lg:grid-cols-2">
        {owner.contributingGames.map((game) => gameDetail(game))}
        {owner.benchPotential.length > 0 && (
          <div className="space-y-2 lg:col-span-2">
            <p className="text-xs font-black uppercase tracking-widest text-amber-800">On the bench</p>
            <div className="grid gap-3 lg:grid-cols-2">{owner.benchPotential.map((game) => gameDetail(game, true))}</div>
          </div>
        )}
      </div>
    </details>
  );
}

export default function StandingsLeaderboard({
  leagueId,
  rows,
  currentUserId,
  selectedWeek,
  availableWeeks,
  fixtureProjection = null,
  fixtureExpandDetails = false,
}: {
  leagueId: string;
  rows: StandingsLeaderboardRow[];
  currentUserId: string;
  selectedWeek: number;
  availableWeeks: number[];
  fixtureProjection?: LiveProjectionResult | null;
  fixtureExpandDetails?: boolean;
}) {
  const [projection, setProjection] = useState<LiveProjectionResult | null>(fixtureProjection);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [clock, setClock] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    if (fixtureProjection) return;
    try {
      const response = await fetch(`/api/leagues/${leagueId}/live-projection`, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(`projection_read_${response.status}`);
      setProjection(await response.json() as LiveProjectionResult);
      setRefreshFailed(false);
      setClock(Date.now());
    } catch (error) {
      console.error("[live-projection-ui]", error instanceof Error ? error.message : "read_failed");
      setProjection(null);
      setRefreshFailed(true);
    }
  }, [fixtureProjection, leagueId]);

  useEffect(() => {
    if (fixtureProjection) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, LIVE_PROJECTION_REFRESH_MS);
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisibility); };
  }, [fixtureProjection, refresh]);

  const projectionByOwner = useMemo(() => new Map(projection?.owners.map((owner) => [owner.memberId, owner]) ?? []), [projection]);
  const projectionActive = projection ? hasMeaningfulProjectionContext(projection) : false;
  const rankCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const row of rows) counts.set(row.rank, (counts.get(row.rank) ?? 0) + 1);
    return counts;
  }, [rows]);

  return (
    <section className="rounded-2xl bg-white p-4 shadow sm:p-6" aria-labelledby="leaderboard-heading">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="text-xs font-black uppercase tracking-widest text-orange-600">League race</p><h2 id="leaderboard-heading" className="mt-1 text-2xl font-black">Leaderboard</h2><p className="mt-1 text-sm text-slate-500">Equal totals share a place. Total points remain the official order.</p></div>
        <form className="flex items-end gap-2">
          <label htmlFor="week" className="min-w-0 flex-1 text-sm font-bold text-slate-600">Weekly view<select id="week" name="week" defaultValue={selectedWeek} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950">{availableWeeks.length ? availableWeeks.map((week) => <option key={week} value={week}>Week {week}</option>) : <option value={1}>Week 1</option>}</select></label>
          <button className="min-h-11 rounded-lg bg-blue-800 px-4 py-2 font-black text-white hover:bg-blue-900">View</button>
        </form>
      </div>

      {projectionActive && projection && (
        <div className={`mt-5 rounded-xl border px-4 py-3 ${projection.freshnessState === "fresh" ? "border-orange-300 bg-orange-50" : "border-slate-300 bg-slate-100"}`} role="status">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="text-xs font-black uppercase tracking-[0.18em] text-orange-700">Live projection</p><p className="font-black text-blue-950">If scores hold</p></div>
            <p className="text-sm font-bold text-slate-600">{projectionFreshnessLabel(projection, clock)}</p>
          </div>
          {projection.context.tiedGames.length > 0 && <p className="mt-2 text-sm font-bold text-slate-700">{projection.context.tiedGames.length} drafted {projection.context.tiedGames.length === 1 ? "game is" : "games are"} tied — unresolved.</p>}
          {(projection.context.staleGames.length > 0 || projection.context.integrityWarnings.length > 0) && <p className="mt-2 text-sm text-slate-700">Live projection is temporarily unavailable for {projection.context.staleGames.length || projection.context.integrityWarnings.length} {projection.context.staleGames.length === 1 || projection.context.integrityWarnings.length === 1 ? "game" : "games"}. Official points remain authoritative.</p>}
        </div>
      )}
      {refreshFailed && <p className="mt-5 rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700" role="status">Live projection is temporarily unavailable. Official standings remain current.</p>}

      <div className="mt-6 space-y-3">
        {rows.map((row) => {
          const isCurrentOwner = row.userId === currentUserId;
          const tied = (rankCounts.get(row.rank) ?? 0) > 1;
          const theme = favoriteTeamTheme(row.favoriteTeam);
          const ownerProjection = projectionActive ? projectionByOwner.get(row.memberId) : undefined;
          const provisional = ownerProjection ? provisionalPoints(ownerProjection) : 0;
          return (
            <article
              key={row.memberId}
              className={`${isCurrentOwner ? "ring-2 ring-blue-700 ring-offset-2" : ""} relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm`}
              style={{ borderLeftWidth: 6, borderLeftColor: row.favoriteTeam ? theme.primary : "#172554", backgroundImage: row.favoriteTeam ? `linear-gradient(105deg, ${theme.primary}12 0%, transparent 38%)` : undefined }}
              aria-label={`${placeLabel(row.rank, tied)} place, ${row.poolTeamName ?? row.ownerName}, ${row.totalPoints} official points${ownerProjection ? `, ${ownerProjection.projectedTotal} if scores hold` : ""}${isCurrentOwner ? ", you" : ""}`}
            >
              <div className="grid gap-4 p-4 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto] sm:items-center sm:p-5">
                <div className="flex items-center justify-between sm:block">
                  <span className={`${placeStyle(row.rank)} inline-flex h-14 min-w-14 items-center justify-center rounded-xl border px-2 font-mono text-2xl font-black shadow-lg`}>{placeLabel(row.rank, tied)}</span>
                  {isCurrentOwner && <span className="rounded-full bg-blue-800 px-3 py-1 text-xs font-black uppercase tracking-wider text-white sm:hidden">You</span>}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-xl font-black text-blue-950">{row.poolTeamName ?? row.ownerName}</h3>{isCurrentOwner && <span className="hidden rounded-full bg-blue-800 px-2.5 py-1 text-[0.65rem] font-black uppercase tracking-wider text-white sm:inline">You</span>}</div>
                  <p className="text-sm font-semibold text-slate-500">{row.poolTeamName ? row.ownerName : "Pool owner"}</p>
                  {row.favoriteTeam && <div className="mt-2 flex items-center gap-2 text-sm font-bold" style={{ color: theme.primaryText }}><TeamLogo team={row.favoriteTeam} size="sm" decorative /><span>{row.favoriteTeam.school_name}</span></div>}
                  {ownerProjection && <p className="mt-2 text-sm font-black text-blue-800">{projectedMovementLabel(ownerProjection)}</p>}
                </div>
                {ownerProjection ? (
                  <div className="grid grid-cols-3 gap-2 border-t border-slate-200 pt-4 text-center sm:min-w-[19rem] sm:border-0 sm:pt-0 sm:text-right">
                    <div><p className="text-2xl font-black text-blue-950 sm:text-3xl">{ownerProjection.officialPoints}</p><p className="mt-1 text-[0.65rem] font-bold uppercase tracking-wide text-slate-500">Official</p></div>
                    <div><p className={`${provisional > 0 ? "text-green-700" : provisional < 0 ? "text-red-700" : "text-slate-600"} text-2xl font-black sm:text-3xl`}>{signedPoints(provisional)}</p><p className="mt-1 text-[0.65rem] font-bold uppercase tracking-wide text-slate-500">In play</p></div>
                    <div className="rounded-lg bg-orange-50 px-2 py-1"><p className="text-2xl font-black text-orange-800 sm:text-3xl">{ownerProjection.projectedTotal}</p><p className="mt-1 text-[0.65rem] font-black uppercase tracking-wide text-orange-700">If scores hold</p></div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-4 text-right sm:block sm:border-0 sm:pt-0">
                    <div><p className="text-4xl font-black leading-none text-blue-950">{row.totalPoints}</p><p className="mt-1 text-xs font-bold uppercase tracking-wider text-slate-500">Total points</p></div>
                    <div className="sm:mt-3"><p className={`${row.weeklyPoints < 0 ? "text-red-700" : row.weeklyPoints > 0 ? "text-green-700" : "text-slate-600"} text-xl font-black`}>{signedPoints(row.weeklyPoints)}</p><p className="text-xs text-slate-500">Week {selectedWeek}</p></div>
                  </div>
                )}
              </div>

              <div className="grid gap-3 border-t border-slate-200 bg-slate-50/70 px-4 py-3 text-sm sm:grid-cols-3 sm:px-5">
                <p><span className="font-black text-slate-900">Race:</span> <span className="text-slate-600">{row.pointsBehindLeader === 0 ? (tied ? "Tied for the lead" : "Leading") : `${row.pointsBehindLeader} back`}</span></p>
                <p><span className="font-black text-slate-900">Latest:</span> <span className="text-slate-600">{row.latestEvent ? `${signedPoints(row.latestEvent.points)} · ${row.latestEvent.teamName} ${row.latestEvent.ruleName}` : "No scoring yet"}</span></p>
                <p><span className="font-black text-slate-900">Top team:</span> <span className="text-slate-600">{row.strongestTeam ? `${row.strongestTeam.teamName} (${signedPoints(row.strongestTeam.points)})` : row.draftedTeamCount ? "No points yet" : "Draft pending"}</span></p>
              </div>

              {ownerProjection && <ProjectionDetails owner={ownerProjection} expanded={fixtureExpandDetails} />}
              <details className="border-t border-slate-200 px-4 py-3 sm:px-5">
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-black text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700">View roster · {row.draftedTeamCount} teams</summary>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{row.draftedTeams.length ? row.draftedTeams.map((team) => <div key={team.id} className="flex min-w-0 items-center gap-2 rounded-lg bg-slate-100 p-2"><TeamLogo team={team} size="sm" decorative /><span className="truncate text-sm font-bold">{team.school_name}</span></div>) : <p className="text-sm text-slate-500">No teams drafted yet.</p>}</div>
              </details>
            </article>
          );
        })}
      </div>
    </section>
  );
}
