import assert from "node:assert/strict";
import test from "node:test";

import { getTeamSeasonRecord, ownerScoringSummary, recordLabel, selectRelevantOwnerGames } from "../../src/lib/league/owner-season.ts";

const team = (id: string) => ({ id, school_name: id, short_name: id, abbreviation: id, conference: "Test", logo_url: null, primary_color: null, secondary_color: null, active: true, created_at: "" });
const participant = (id: string) => ({ kind: "internal" as const, id, displayName: id, classification: "fbs" as const, team: team(id) });
const game = (id: string, status: string, start: string, homeScore: number | null = null, awayScore: number | null = null) => ({
  id, league_id: "league", external_id: id, external_provider: "cfbd", data_source: "provider", provider_payload_hash: null,
  provider_synced_at: null, manual_override: false, season: "2026", week: 1, game_date: start.slice(0, 10), start_at: start,
  home_team_id: "A", away_team_id: "B", home_external_opponent_id: null, away_external_opponent_id: null,
  home_score: homeScore, away_score: awayScore, status, neutral_site: false, postseason: false, scoring_fingerprint: null,
  scored_at: null, created_at: "", updated_at: "", homeParticipant: participant("A"), awayParticipant: participant("B"), rankings: [],
});

test("owner games prioritize live action then upcoming games chronologically", () => {
  const games = [
    game("later", "scheduled", "2026-09-12T16:00:00Z"),
    game("past", "final", "2026-08-20T16:00:00Z", 20, 10),
    game("live", "in_progress", "2026-09-05T16:00:00Z", 7, 3),
    game("next", "scheduled", "2026-08-29T16:00:00Z"),
  ];
  assert.deepEqual(selectRelevantOwnerGames(games, ["A"], new Date("2026-08-15T12:00:00Z")).map((item) => item.id), ["live", "next", "later"]);
});

test("team record and owner scoring use only the owner's factual results", () => {
  const games = [game("win", "final", "2026-08-20T16:00:00Z", 20, 10), game("loss", "final", "2026-08-21T16:00:00Z", 7, 14), game("future", "scheduled", "2026-08-30T16:00:00Z")];
  assert.equal(recordLabel(getTeamSeasonRecord(games, "A")), "1-1");
  const picks = [{ team_id: "A" }] as never;
  const events = [{ team_id: "A", points: 2 }, { team_id: "B", points: 9 }, { team_id: "A", points: -1 }] as never;
  const summary = ownerScoringSummary(picks, events);
  assert.equal(summary.totals.get("A"), 1);
  assert.equal(summary.recent.length, 2);
});
