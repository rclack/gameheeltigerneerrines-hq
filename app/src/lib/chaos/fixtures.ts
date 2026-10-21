import type { ChaosFeedItem, ChaosFeedResponse, FeedLifecycle, FeedSeverity } from "./presentation";

const LEAGUE_ID = "00000000-0000-4000-8000-000000000001";

function item(index: number, overrides: Partial<ChaosFeedItem> = {}): ChaosFeedItem {
  const resolved = overrides.lifecycle === "resolved";
  return {
    id: `transition-${index}`, episodeId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    eventKey: `chaos_key_fixture_${String(index).padStart(4, "0")}`, eventType: "MAJOR_SCORING_SWING",
    severity: "notable", lifecycle: resolved ? "resolved" : "active", transitionType: resolved ? "resolved" : null,
    resolutionReason: resolved ? "CONDITION_ENDED" : null,
    observedAt: new Date(Date.UTC(2026, 9, 17, 20, 30 - index)).toISOString(), week: 8,
    gameId: `00000000-0000-4000-8001-${String(index).padStart(12, "0")}`,
    teamId: `00000000-0000-4000-8002-${String(index).padStart(12, "0")}`,
    memberId: `00000000-0000-4000-8003-${String(index).padStart(12, "0")}`,
    ownerName: index === 19 ? "The Extremely Long Pool Team Name That Still Fits on a Phone" : `Owner ${index}`,
    teamName: index === 19 ? "A Very Long University Team Name Built for Responsive Testing" : `Team ${index}`,
    facts: { gameState: "live", gameProjectedPoints: index % 2 ? index : -index, projectedRank: 1, rankMovement: 2 },
    reasonCodes: ["SCORING_SWING"], ...overrides,
  };
}

export const emptyChaosFixture: ChaosFeedResponse = { active: [], transitions: [], nextCursor: null };

export const busyChaosFixture: ChaosFeedResponse = {
  active: [
    item(1, { eventType: "CAPTAIN_POSITIVE", severity: "major", ownerName: "Alex", teamName: "Ole Miss", facts: { gameState: "live", gameProjectedPoints: 8, projectedRank: 1, rankMovement: 2 } }),
    item(2, { eventType: "CAPTAIN_NEGATIVE", ownerName: "Randy", teamName: "TCU", facts: { gameState: "live", gameProjectedPoints: -2, projectedRank: 5, rankMovement: -2 } }),
    item(3, { eventType: "CAPTAIN_NEGATIVE", severity: "chaos", ownerName: "A Long Owner Name Designed for Narrow Cards", teamName: "Appalachian State", facts: { gameState: "live", gameProjectedPoints: -12, projectedRank: 7, rankMovement: -3 } }),
    item(4, { eventType: "BENCH_POSITIVE", ownerName: "Jamey", teamName: "Louisville", facts: { gameState: "live", gameProjectedPoints: 2, projectedRank: 3, rankMovement: 0 } }),
    item(5, { eventType: "BENCH_POSITIVE", severity: "chaos", ownerName: "Andrew", teamName: "Memphis", facts: { gameState: "live", gameProjectedPoints: 9, projectedRank: 2, rankMovement: 1 } }),
    item(6, { eventType: "PROJECTED_LEAD_CHANGE", severity: "major", ownerName: "Lennon", teamName: null, gameId: null, facts: { gameState: null, gameProjectedPoints: null, projectedRank: 1, rankMovement: 2 } }),
    item(7, { eventType: "PROJECTED_LEAD_CHANGE", ownerName: "Carson", teamName: null, gameId: null, facts: { gameState: null, gameProjectedPoints: null, projectedRank: 1, rankMovement: 1 } }),
    item(8, { eventType: "PROJECTED_RANK_MOVE", ownerName: "Aaron", gameId: null, teamName: null, facts: { gameState: null, gameProjectedPoints: null, projectedRank: 2, rankMovement: 3 } }),
    item(9, { eventType: "UPSET_DANGER", severity: "major", ownerName: "Randy", teamName: "Miami (FL)", facts: { gameState: "live", gameProjectedPoints: -1, projectedRank: 3, rankMovement: -1 } }),
    item(10, { eventType: "G5_POWER_SWING", severity: "chaos", ownerName: "Andrew", teamName: "Memphis", facts: { gameState: "live", gameProjectedPoints: 5, projectedRank: 1, rankMovement: 2 } }),
    item(11, { eventType: "MAJOR_SCORING_SWING", ownerName: "Owner A", teamName: "Drafted Team A", facts: { gameState: "live", gameProjectedPoints: 5, projectedRank: 2, rankMovement: 1 } }),
    item(12, { eventType: "MAJOR_SCORING_SWING", ownerName: "Owner B", teamName: "Drafted Team B", gameId: `00000000-0000-4000-8001-${String(11).padStart(12, "0")}`, facts: { gameState: "live", gameProjectedPoints: -5, projectedRank: 4, rankMovement: -2 } }),
    item(13, { eventType: "CAPTAIN_POSITIVE", severity: "major", ownerName: "Grouped Owner", teamName: "Grouped Team", facts: { gameState: "live", gameProjectedPoints: 8, projectedRank: 1, rankMovement: 2 } }),
    item(14, { eventType: "MAJOR_SCORING_SWING", severity: "major", ownerName: "Grouped Owner", teamName: "Grouped Team", episodeId: `00000000-0000-4000-8000-${String(13).padStart(12, "0")}`, gameId: `00000000-0000-4000-8001-${String(13).padStart(12, "0")}`, memberId: `00000000-0000-4000-8003-${String(13).padStart(12, "0")}`, observedAt: item(13).observedAt, facts: { gameState: "live", gameProjectedPoints: 8, projectedRank: 1, rankMovement: 2 } }),
    item(15, { eventType: "CAPTAIN_POSITIVE", severity: "chaos", transitionType: "escalated", ownerName: "Escalated Owner", teamName: "Escalated Team", facts: { gameState: "live", gameProjectedPoints: 12, projectedRank: 1, rankMovement: 3 } }),
    item(16, { eventType: "UPSET_DANGER", lifecycle: "suspended", severity: "major", ownerName: "Stale Owner", teamName: "Stale Team", facts: { gameState: "live", gameProjectedPoints: -1, projectedRank: 4, rankMovement: -1 } }),
    item(17, { eventType: "CAPTAIN_POSITIVE", severity: "major", ownerName: "Final Pending Owner", teamName: "Final Pending Team", facts: { gameState: "final_pending", gameProjectedPoints: 8, projectedRank: 1, rankMovement: 2 } }),
    item(19, { eventType: "MAJOR_SCORING_SWING", severity: "info" as FeedSeverity }),
  ],
  transitions: [
    item(18, { eventType: "CAPTAIN_NEGATIVE", lifecycle: "resolved" as FeedLifecycle, ownerName: "Resolved Owner", teamName: "Resolved Team", facts: { gameState: "live", gameProjectedPoints: -2, projectedRank: 4, rankMovement: -1 } }),
    ...Array.from({ length: 8 }, (_, offset) => item(20 + offset, { lifecycle: "resolved", ownerName: `Saturday Owner ${offset + 1}`, teamName: `Saturday Team ${offset + 1}` })),
  ],
  nextCursor: "2026-10-17T19:00:00.000Z",
};

export const chaosFixtureLeagueId = LEAGUE_ID;
