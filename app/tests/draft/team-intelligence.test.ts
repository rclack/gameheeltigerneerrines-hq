import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../supabase/migrations/20260829000000_draft_team_intelligence.sql", import.meta.url), "utf8");
const service = readFileSync(new URL("../../src/services/draftService.ts", import.meta.url), "utf8");
const room = readFileSync(new URL("../../src/components/draft/DraftRoom.tsx", import.meta.url), "utf8");

test("prior-season records require league membership and deduplicate provider games", () => {
  assert.match(migration, /private\.is_league_member\(league\.id\)/);
  assert.match(migration, /distinct on \(game\.external_provider, game\.external_id\)/);
  assert.match(migration, /game\.status = 'final'/);
  assert.match(migration, /revoke all on function public\.get_draft_team_prior_records\(uuid\) from public, anon/);
  assert.match(migration, /grant execute on function public\.get_draft_team_prior_records\(uuid\) to authenticated/);
});

test("draft intelligence is preloaded from internal data without live CFBD calls", () => {
  assert.match(service, /conference_classifications/);
  assert.match(service, /get_draft_team_prior_records/);
  assert.match(service, /team_ranking_snapshots/);
  assert.match(service, /ranking_source", "AP Top 25"/);
  assert.doesNotMatch(service, /fetch\(|CFBD_API_KEY|cfbdService/);
});

test("compact team cards expose factual details and preserve draft controls", () => {
  assert.match(room, /<details className=/);
  assert.match(room, /Current \/ preseason AP/);
  assert.match(room, /priorSeason/);
  assert.match(room, /\+ Queue/);
  assert.match(room, /draftTeam\(team\.id\)/);
  assert.match(room, /disabled=\{!isMyTurn/);
});
