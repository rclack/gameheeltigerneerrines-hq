import { notFound } from "next/navigation";

import GameRoom, { type GameRoomData } from "@/components/league/GameRoom";
import SaturdayWatchlist, { type SaturdayWatchlistGame } from "@/components/league/SaturdayWatchlist";
import type { LiveProjectionResult, ProjectedGameFact, ProjectionOwnerResult } from "@/lib/projection/live-projection";

function fact(overrides: Partial<ProjectedGameFact> = {}): ProjectedGameFact {
  return { gameId: "captain-positive", providerGameId: "provider-1", teamId: "ole-miss", teamName: "Ole Miss", opponentId: "lsu", opponentName: "LSU", state: "live",
    score: { team: 24, opponent: 17 }, lineupEntryId: "entry", lineupStatus: "starter", counts: true, captainApplied: true, multiplier: 2,
    baseProjectedPoints: 4, projectedPoints: 8, components: [
      { ruleId: "win", code: "WIN", displayName: "Win", basePoints: 1, multiplier: 2, points: 2 },
      { ruleId: "ranked", code: "WIN_OVER_RANKED", displayName: "Ranked win", basePoints: 1, multiplier: 2, points: 2 },
      { ruleId: "top15", code: "WIN_OVER_TOP_15", displayName: "Top 15 win", basePoints: 2, multiplier: 2, points: 4 },
    ], ...overrides };
}

function owner(overrides: Partial<ProjectionOwnerResult>): ProjectionOwnerResult {
  return { memberId: "randy", displayName: "Urban Meyer's Bag Man", officialPoints: 22, liveDelta: 8, finalPendingDelta: 0, projectedTotal: 30,
    officialRank: 4, projectedRank: 2, rankMovement: 2, contributingGames: [fact()], benchPotential: [], ...overrides };
}

const projection: LiveProjectionResult = {
  leagueId: "00000000-0000-4000-8000-000000000001", season: "2026", competitionWeek: 5, generatedAt: new Date().toISOString(), liveDataFetchedAt: new Date().toISOString(), freshnessState: "fresh", officialAsOf: new Date().toISOString(),
  owners: [
    owner({}),
    owner({ memberId: "lennon", displayName: "The Extremely Long Pool Team Name for Narrow Screens", officialPoints: 25, liveDelta: -1, projectedTotal: 24, officialRank: 2, projectedRank: 3, rankMovement: -1,
      contributingGames: [fact({ teamId: "lsu", teamName: "LSU", opponentId: "ole-miss", opponentName: "Ole Miss", score: { team: 17, opponent: 24 }, captainApplied: false, multiplier: 1, baseProjectedPoints: -1, projectedPoints: -1,
        components: [{ ruleId: "loss", code: "LOSS", displayName: "Loss", basePoints: -1, multiplier: 1, points: -1 }] })] }),
    owner({ memberId: "alex", displayName: "Cant Spell Succession Without SEC", officialPoints: 25, liveDelta: 0, projectedTotal: 25, officialRank: 2, projectedRank: 2, rankMovement: 0,
      contributingGames: [], benchPotential: [fact({ gameId: "bench-leading", teamId: "louisville", teamName: "Louisville", opponentId: "smu", opponentName: "SMU", lineupStatus: "bench", counts: false, captainApplied: false, multiplier: 1, baseProjectedPoints: 2, projectedPoints: 2,
        components: [{ ruleId: "win", code: "WIN", displayName: "Win", basePoints: 1, multiplier: 1, points: 1 }, { ruleId: "ranked", code: "WIN_OVER_RANKED", displayName: "Ranked win", basePoints: 1, multiplier: 1, points: 1 }] })] }),
    owner({ memberId: "andrew", displayName: "The Jayden Daniels Royalty Foundation", officialPoints: 18, liveDelta: 0, finalPendingDelta: 1, projectedTotal: 19, officialRank: 5, projectedRank: 4, rankMovement: 1,
      contributingGames: [fact({ gameId: "final-pending", teamId: "memphis", teamName: "Memphis", opponentId: "unlv", opponentName: "UNLV", state: "final_pending", score: { team: 31, opponent: 24 }, captainApplied: false, multiplier: 1, baseProjectedPoints: 1, projectedPoints: 1,
        components: [{ ruleId: "win", code: "WIN", displayName: "Win", basePoints: 1, multiplier: 1, points: 1 }] })], benchPotential: [] }),
  ],
  context: { tiedGames: [{ gameId: "tied", providerGameId: "provider-tied", state: "tied", label: "TIED — unresolved" }], staleGames: [{ gameId: "stale", providerGameId: "provider-stale", state: "stale", label: "stale" }], notStartedGames: [], integrityWarnings: [] },
};

const watchlistGames: SaturdayWatchlistGame[] = [
  { id: "captain-positive", week: 5, status: "in_progress", dateLabel: "SAT, OCT 3 · 3:30 PM ET", ownedTeamName: "Ole Miss", ownedTeam: null, ownedRank: 11, opponentName: "LSU", opponentTeam: null, opponentRank: 7, context: "vs", homeScore: 24, awayScore: 17, liveContext: "Q3 · 08:12", freshness: "Updated 1 min ago" },
  { id: "bench-leading", week: 5, status: "in_progress", dateLabel: "SAT, OCT 3 · 7:30 PM ET", ownedTeamName: "Louisville", ownedTeam: null, ownedRank: null, opponentName: "SMU", opponentTeam: null, opponentRank: 18, context: "at", homeScore: 14, awayScore: 21, liveContext: "Q2 · 02:44", freshness: "Updated 2 min ago" },
  { id: "tied", week: 5, status: "in_progress", dateLabel: "SAT, OCT 3 · 8:00 PM ET", ownedTeamName: "TCU", ownedTeam: null, ownedRank: null, opponentName: "BYU", opponentTeam: null, opponentRank: null, context: "vs", homeScore: 17, awayScore: 17, liveContext: "Q4 · 11:08", freshness: "Updated moments ago" },
  { id: "final-pending", week: 5, status: "completed", dateLabel: "FRI, OCT 2 · 9:00 PM ET", ownedTeamName: "Memphis", ownedTeam: null, ownedRank: null, opponentName: "UNLV", opponentTeam: null, opponentRank: null, context: "vs", homeScore: 31, awayScore: 24, liveContext: null, freshness: "Updated 3 min ago" },
  { id: "stale", week: 5, status: "in_progress", dateLabel: "SAT, OCT 3 · 10:30 PM ET", ownedTeamName: "USC", ownedTeam: null, ownedRank: 15, opponentName: "Washington", opponentTeam: null, opponentRank: null, context: "vs", homeScore: 10, awayScore: 7, liveContext: "Q2", freshness: "Updated 18 min ago" },
  { id: "unrelated", week: 5, status: "scheduled", dateLabel: "SAT, OCT 3 · 11:00 PM ET", ownedTeamName: "Stanford", ownedTeam: null, ownedRank: null, opponentName: "California", opponentTeam: null, opponentRank: null, context: "at", homeScore: null, awayScore: null, liveContext: null, freshness: null },
];

function room(id: string): GameRoomData {
  const selected = watchlistGames.find((game) => game.id === id) ?? watchlistGames[0];
  const both = id === "captain-positive";
  return { id: selected.id, week: selected.week, kickoff: selected.dateLabel, status: selected.status, liveContext: selected.liveContext, freshness: selected.freshness,
    away: { teamId: both ? "lsu" : id === "bench-leading" ? "louisville" : "tcu", teamName: both ? "LSU" : selected.ownedTeamName, team: null, rank: both ? 7 : selected.ownedRank, score: selected.awayScore, ownerName: both ? "The Extremely Long Pool Team Name for Narrow Screens" : id === "stale" ? "Urban Meyer's Bag Man" : "Cant Spell Succession Without SEC", lineupStatus: id === "bench-leading" ? "bench" : "starter", isCaptain: false },
    home: { teamId: both ? "ole-miss" : null, teamName: both ? "Ole Miss" : selected.opponentName, team: null, rank: both ? 11 : selected.opponentRank, score: selected.homeScore, ownerName: both ? "Urban Meyer's Bag Man" : null, lineupStatus: both ? "starter" : null, isCaptain: both },
  };
}

export default async function GameProjectionPreview({ searchParams }: { searchParams: Promise<{ surface?: string; state?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  const leagueId = projection.leagueId;
  if (query.surface === "room") return <GameRoom leagueId={leagueId} game={room(query.state ?? "captain-positive")} fixtureProjection={projection} />;
  return <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950"><div className="mx-auto max-w-6xl"><p className="text-xs font-black uppercase tracking-[0.2em] text-orange-700">Deterministic visual fixture</p><h1 className="mt-1 text-3xl font-black text-blue-950">Saturday Home</h1><div className="mt-6"><SaturdayWatchlist leagueId={leagueId} games={watchlistGames} accentColor="#C2410C" fixtureProjection={projection} /></div></div></main>;
}
