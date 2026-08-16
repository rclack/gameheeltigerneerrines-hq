import assert from "node:assert/strict";
import test from "node:test";

import { deriveStandingRows, type StandingMemberInput } from "../../src/lib/league/standings-experience.ts";
import type { ScoringEventDetail } from "../../src/services/scoringService.ts";
import type { ScoringRule, Team } from "../../src/types/database.ts";

function team(id: string, schoolName: string, overrides: Partial<Team> = {}): Team {
  return {
    id,
    school_name: schoolName,
    short_name: schoolName,
    abbreviation: schoolName.slice(0, 3).toUpperCase(),
    conference: "SEC",
    logo_url: null,
    primary_color: null,
    secondary_color: null,
    active: true,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const winRule: ScoringRule = {
  id: "win-rule",
  league_id: null,
  code: "win",
  display_name: "Win",
  description: "Game win",
  category: "game",
  points: 1,
  active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function event(id: string, eventTeam: Team, points: number, week: number, createdAt: string): ScoringEventDetail {
  return {
    id,
    league_id: "league",
    team_id: eventTeam.id,
    scoring_rule_id: winRule.id,
    season: "2026",
    week,
    points,
    event_date: "2026-09-05",
    source_type: "game",
    source_identifier: id,
    origin: "automatic",
    idempotency_key: id,
    notes: null,
    metadata: {},
    created_by: null,
    created_at: createdAt,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    rule: winRule,
    team: eventTeam,
  };
}

const members: StandingMemberInput[] = [
  { memberId: "member-a", userId: "user-a", ownerName: "Alex", poolTeamName: "Saturday Stars", favoriteTeamId: "favorite-a" },
  { memberId: "member-b", userId: "user-b", ownerName: "Blair", poolTeamName: null, favoriteTeamId: null },
  { memberId: "member-c", userId: "user-c", ownerName: "Casey", poolTeamName: null, favoriteTeamId: null },
];

test("derives tied ranks, favorite identity, roster context, and active score context", () => {
  const favorite = team("favorite-a", "South Carolina", { primary_color: "#73000A", logo_url: "https://a.espncdn.com/i/team.png" });
  const auburn = team("auburn", "Auburn");
  const temple = team("temple", "Temple");
  const appState = team("app-state", "Appalachian State");
  const rows = deriveStandingRows(
    members,
    [
      { league_member_id: "member-a", team: auburn },
      { league_member_id: "member-b", team: temple },
      { league_member_id: "member-c", team: appState },
    ],
    [
      event("a-week-2", auburn, 2, 2, "2026-09-12T23:00:00Z"),
      event("b-week-2", temple, 2, 2, "2026-09-12T22:00:00Z"),
      event("c-week-1", appState, -1, 1, "2026-09-05T22:00:00Z"),
    ],
    [favorite, auburn, temple, appState],
    2,
  );

  assert.deepEqual(rows.map(({ rank, memberId, totalPoints }) => ({ rank, memberId, totalPoints })), [
    { rank: 1, memberId: "member-a", totalPoints: 2 },
    { rank: 1, memberId: "member-b", totalPoints: 2 },
    { rank: 3, memberId: "member-c", totalPoints: -1 },
  ]);
  assert.equal(rows[0].userId, "user-a");
  assert.equal(rows[0].favoriteTeam?.school_name, "South Carolina");
  assert.equal(rows[1].favoriteTeam, null);
  assert.equal(rows[0].weeklyPoints, 2);
  assert.equal(rows[0].activeEventCount, 1);
  assert.equal(rows[0].latestEvent?.id, "a-week-2");
  assert.equal(rows[0].strongestTeam?.team.school_name, "Auburn");
  assert.equal(rows[2].pointsBehindLeader, 3);
});

test("keeps a zero-point preseason deterministic without inventing score context", () => {
  const auburn = team("auburn", "Auburn");
  const temple = team("temple", "Temple");
  const rows = deriveStandingRows(
    members.slice(0, 2),
    [
      { league_member_id: "member-a", team: auburn },
      { league_member_id: "member-b", team: temple },
    ],
    [],
    [auburn, temple],
    1,
  );

  assert.deepEqual(rows.map((row) => row.rank), [1, 1]);
  assert.deepEqual(rows.map((row) => row.totalPoints), [0, 0]);
  assert.deepEqual(rows.map((row) => row.pointsBehindLeader), [0, 0]);
  assert.ok(rows.every((row) => row.latestEvent === null && row.strongestTeam === null));
  assert.deepEqual(rows.map((row) => row.draftedTeamCount), [1, 1]);
});
