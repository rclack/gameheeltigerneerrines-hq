import { notFound } from "next/navigation";

import StandingsLeaderboard, { type StandingsLeaderboardRow } from "@/components/league/StandingsLeaderboard";
import type { LiveProjectionResult, ProjectedGameFact, ProjectionOwnerResult } from "@/lib/projection/live-projection";

function game(overrides: Partial<ProjectedGameFact> = {}): ProjectedGameFact {
  return {
    gameId: "game-1", providerGameId: "401856766", week: 5, opponentMemberId: null, teamPregameRank: null, opponentPregameRank: null, teamRankingContextResolved: true, opponentRankingContextResolved: true, teamClassification: "POWER", opponentClassification: "POWER", period: 3, sourceFreshness: "fresh", sourceFetchedAt: "2026-10-03T17:59:00Z", canonicalStateFingerprint: "fixture", teamId: "ole-miss", teamName: "Ole Miss", opponentId: "lsu", opponentName: "LSU",
    state: "live", score: { team: 24, opponent: 17 }, lineupEntryId: "entry-1", lineupStatus: "starter", counts: true,
    captainApplied: true, multiplier: 2, baseProjectedPoints: 4, projectedPoints: 8,
    components: [
      { ruleId: "win", code: "WIN", displayName: "Win", basePoints: 1, multiplier: 2, points: 2 },
      { ruleId: "ranked", code: "WIN_OVER_RANKED", displayName: "Ranked win", basePoints: 1, multiplier: 2, points: 2 },
      { ruleId: "top15", code: "WIN_OVER_TOP_15", displayName: "Top 15 win", basePoints: 2, multiplier: 2, points: 4 },
    ],
    ...overrides,
  };
}

function owner(overrides: Partial<ProjectionOwnerResult>): ProjectionOwnerResult {
  return {
    memberId: "alex", displayName: "Cant Spell Succession Without SEC", officialPoints: 25, liveDelta: 8, finalPendingDelta: 0,
    projectedTotal: 33, officialRank: 3, projectedRank: 1, rankMovement: 2, contributingGames: [game()], benchPotential: [],
    ...overrides,
  };
}

const projection: LiveProjectionResult = {
  leagueId: "00000000-0000-4000-8000-000000000001", season: "2026", competitionWeek: 5,
  generatedAt: "2026-10-03T18:00:00.000Z", liveDataFetchedAt: new Date().toISOString(), freshnessState: "fresh", officialAsOf: "2026-10-03T17:58:00.000Z",
  owners: [
    owner({}),
    owner({ memberId: "randy", displayName: "Urban Meyer's Bag Man", officialPoints: 28, liveDelta: -2, projectedTotal: 26, officialRank: 1, projectedRank: 2, rankMovement: -1,
      contributingGames: [game({ gameId: "game-2", teamId: "texas-am", teamName: "Texas A&M", opponentId: "kentucky", opponentName: "Kentucky", score: { team: 21, opponent: 31 }, baseProjectedPoints: -1, projectedPoints: -2,
        components: [{ ruleId: "loss", code: "LOSS", displayName: "Loss", basePoints: -1, multiplier: 2, points: -2 }] })],
      benchPotential: [game({ gameId: "game-3", teamId: "louisville", teamName: "Louisville", opponentId: "smu", opponentName: "SMU", lineupStatus: "bench", counts: false, captainApplied: false, multiplier: 1, baseProjectedPoints: 2, projectedPoints: 2,
        components: [{ ruleId: "win", code: "WIN", displayName: "Win", basePoints: 1, multiplier: 1, points: 1 }, { ruleId: "ranked", code: "WIN_OVER_RANKED", displayName: "Ranked win", basePoints: 1, multiplier: 1, points: 1 }] })] }),
    owner({ memberId: "long", displayName: "The Extremely Long Pool Team Name Built to Test Narrow Screens", officialPoints: 11, liveDelta: 1, finalPendingDelta: 1, projectedTotal: 13, officialRank: 3, projectedRank: 3, rankMovement: 0,
      contributingGames: [game({ gameId: "game-4", teamId: "usc", teamName: "USC", opponentId: "washington", opponentName: "Washington", captainApplied: false, multiplier: 1, baseProjectedPoints: 1, projectedPoints: 1,
        components: [{ ruleId: "win", code: "WIN", displayName: "Win", basePoints: 1, multiplier: 1, points: 1 }] }), game({ gameId: "game-5", state: "final_pending", teamId: "tcu", teamName: "TCU", opponentId: "byu", opponentName: "BYU", captainApplied: false, multiplier: 1, baseProjectedPoints: 1, projectedPoints: 1,
        components: [{ ruleId: "win", code: "WIN", displayName: "Win", basePoints: 1, multiplier: 1, points: 1 }] })] }),
  ],
  context: {
    tiedGames: [{ gameId: "game-tied", providerGameId: "tied", state: "tied", label: "TIED — unresolved" }],
    staleGames: [{ gameId: "game-stale", providerGameId: "stale", state: "stale", label: "stale" }],
    notStartedGames: [], integrityWarnings: [],
  },
};

const rows: StandingsLeaderboardRow[] = projection.owners.map((item, index) => ({
  rank: item.officialRank, memberId: item.memberId, userId: item.memberId, ownerName: item.displayName,
  poolTeamName: item.displayName, totalPoints: item.officialPoints, weeklyPoints: index === 1 ? -1 : 4,
  draftedTeamCount: index === 2 ? 3 : 6, draftedTeams: [], favoriteTeam: null,
  latestEvent: null, strongestTeam: null, pointsBehindLeader: Math.max(0, 28 - item.officialPoints),
}));

export default async function LiveProjectionPreviewPage({ searchParams }: { searchParams: Promise<{ expanded?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-orange-700">Deterministic visual fixture</p>
        <h1 className="mt-1 text-3xl font-black text-blue-950">Live Projected Standings</h1>
        <div className="mt-6"><StandingsLeaderboard leagueId={projection.leagueId} rows={rows} currentUserId="randy" selectedWeek={5} availableWeeks={[0, 1, 2, 3, 4, 5]} fixtureProjection={projection} fixtureExpandDetails={query.expanded === "1"} /></div>
      </div>
    </main>
  );
}
