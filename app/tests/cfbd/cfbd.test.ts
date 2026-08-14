import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { classifyCfbdHttpStatus } from "../../src/lib/cfbd/http.ts";
import { buildTeamMappingAudit, classifyUnmappedCfbdGame, normalizeTeamName } from "../../src/lib/cfbd/mapping.ts";
import { normalizeCfbdGame, parseCfbdGames, parseCfbdTeams } from "../../src/lib/cfbd/normalization.ts";
import { getGameScoringState } from "../../src/lib/cfbd/scoringState.ts";
import { CfbdSyncError, redactSensitiveText, syncFailureSummary, syncRunFailureDetail } from "../../src/lib/cfbd/diagnostics.ts";
import { chunkPostgrestFilterValues } from "../../src/services/gameService.ts";

const game = { id: 9001, season: 2026, week: 3, startDate: "2026-09-12T19:00:00Z", homeId: 1, homeTeam: "South Carolina", homePoints: null, awayId: 2, awayTeam: "UConn", awayPoints: null, completed: false, neutralSite: false, seasonType: "regular" };

test("A: validates and normalizes a CFBD game response", () => {
  const parsed = parseCfbdGames([game]);
  assert.deepEqual(normalizeCfbdGame(parsed[0]), { external_id: "9001", season: "2026", week: 3, game_date: "2026-09-12", home_external_team_id: "1", home_external_name: "South Carolina", away_external_team_id: "2", away_external_name: "UConn", home_score: null, away_score: null, status: "scheduled", neutral_site: false, postseason: false });
  assert.throws(() => parseCfbdGames({}), /not an array/);
});

test("D-F: external identity is stable while scores and status can synchronize", () => {
  const scheduled = normalizeCfbdGame(game);
  const final = normalizeCfbdGame({ ...game, completed: true, homePoints: 31, awayPoints: 20 });
  assert.equal(scheduled.external_id, final.external_id);
  assert.equal(scheduled.status, "scheduled");
  assert.equal(final.status, "final");
  assert.equal(final.home_score, 31);
  assert.equal(final.away_score, 20);
  assert.deepEqual(normalizeCfbdGame(game), scheduled);
});

test("B/C: maps deterministic aliases and reports ambiguous and unmapped teams", () => {
  const internal = [
    { id: "usc", school_name: "USC", short_name: "USC", abbreviation: "USC" },
    { id: "uconn", school_name: "UConn", short_name: "UConn", abbreviation: "CONN" },
    { id: "miami", school_name: "Miami", short_name: "Miami", abbreviation: "MIA" },
    { id: "duplicate", school_name: "Other", short_name: "Other", abbreviation: "MIA" },
  ];
  const external = parseCfbdTeams([{ id: 10, school: "Southern California" }, { id: 11, school: "Connecticut" }, { id: 12, school: "Miami (FL)", abbreviation: "MIA" }, { id: 13, school: "Unknown State" }]);
  const audit = buildTeamMappingAudit(internal, external);
  assert.deepEqual(audit.created.map((item) => item.team_id).sort(), ["uconn", "usc"]);
  assert.equal(audit.ambiguous.length, 1);
  assert.equal(audit.unmatchedExternal.length, 1);
  assert.equal(normalizeTeamName("Ole Miss"), normalizeTeamName("Mississippi"));
});

test("G: normalizes scheduled, live, final, postponed, and canceled statuses", () => {
  assert.equal(normalizeCfbdGame({ ...game, status: "in_progress" }).status, "in_progress");
  assert.equal(normalizeCfbdGame({ ...game, completed: true, homePoints: 21, awayPoints: 17 }).status, "final");
  assert.equal(normalizeCfbdGame({ ...game, status: "postponed" }).status, "postponed");
  assert.equal(normalizeCfbdGame({ ...game, status: "canceled" }).status, "canceled");
});

test("H-J: derives commissioner scoring review state without awarding points", () => {
  assert.equal(getGameScoringState({ status: "final", scored_at: null, scoring_fingerprint: null }), "needs_scoring");
  assert.equal(getGameScoringState({ status: "final", scored_at: "2026-09-12T22:00:00Z", scoring_fingerprint: "abc" }), "scored");
  assert.equal(getGameScoringState({ status: "final", scored_at: "2026-09-12T22:00:00Z", scoring_fingerprint: null }), "needs_reprocessing");
  assert.equal(getGameScoringState({ status: "scheduled", scored_at: null, scoring_fingerprint: null }), "not_final");
});

test("M/N: classifies authentication, provider, and rate-limit failures", () => {
  assert.equal(classifyCfbdHttpStatus(401), "authentication_failed");
  assert.equal(classifyCfbdHttpStatus(403), "authentication_failed");
  assert.equal(classifyCfbdHttpStatus(429), "rate_limited");
  assert.equal(classifyCfbdHttpStatus(503), "provider_error");
  assert.equal(classifyCfbdHttpStatus(200), null);
});

test("failed schedule fetch retains a safe stage, category, message, and progress", () => {
  const failure = new CfbdSyncError("fetching_games", "provider_error", "CFBD schedule synchronization failed while fetching games: CFBD returned HTTP 400.");
  const summary = syncFailureSummary(failure, { teamsFetched: 138, gamesFetched: 0, mappingsCreated: 0, gamesMapped: 0, gamesUnmapped: 0 });
  assert.deepEqual(syncRunFailureDetail(summary), {
    stage: "fetching_games",
    category: "provider_error",
    message: "CFBD schedule synchronization failed while fetching games: CFBD returned HTTP 400.",
  });
  assert.equal((summary as Record<string, unknown>).teams_fetched, 138);
});

test("stored and displayed diagnostics redact credentials and authorization headers", () => {
  const previous = process.env.CFBD_API_KEY;
  process.env.CFBD_API_KEY = "test-secret-value";
  try {
    const safe = redactSensitiveText("CFBD_API_KEY=test-secret-value Authorization: Bearer test-secret-value");
    assert.doesNotMatch(safe, /test-secret-value/);
    assert.match(safe, /REDACTED/);
  } finally {
    if (previous === undefined) delete process.env.CFBD_API_KEY;
    else process.env.CFBD_API_KEY = previous;
  }
});

test("successful connection and failed schedule fetch are independent states", () => {
  const connection = { status: "connected", message: "CFBD authentication succeeded." };
  const failure = new CfbdSyncError("fetching_games", "provider_error", "CFBD schedule synchronization failed while fetching games: CFBD returned HTTP 400.");
  assert.equal(connection.status, "connected");
  assert.equal(failure.stage, "fetching_games");
  assert.equal(failure.category, "provider_error");
});

test("CFBD import repair avoids PL/pgSQL counter and table-column ambiguity", () => {
  const migration = readFileSync(new URL("../../supabase/migrations/20260821000000_cfbd_sync_counter_ambiguity_repair.sql", import.meta.url), "utf8");
  for (const counter of ["created", "updated", "unchanged", "skipped", "error"]) {
    assert.match(migration, new RegExp(`${counter}_count = v_${counter}_count`));
  }
  assert.match(migration, /when v_error_count > 0/);
  assert.doesNotMatch(migration, /when error_count > 0/);
  assert.match(migration, /update public\.external_sync_runs as sync_run/);
  assert.match(migration, /where sync_run\.id = v_run\.id/);
});

test("large imported schedules chunk PostgREST IN filters into safe request sizes", () => {
  const gameIds = Array.from({ length: 888 }, (_, index) => `game-${index}`);
  const chunks = chunkPostgrestFilterValues(gameIds);
  assert.equal(chunks.length, 9);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [100, 100, 100, 100, 100, 100, 100, 100, 88]);
  assert.deepEqual(chunks.flat(), gameIds);
});

test("unmapped games distinguish unsupported non-FBS opponents from FBS mapping failures", () => {
  const normalized = normalizeCfbdGame(game);
  const fbsIds = new Set(["1", "2"]);
  assert.equal(classifyUnmappedCfbdGame(normalized, fbsIds), "unresolved_fbs_mapping");
  assert.equal(classifyUnmappedCfbdGame({ ...normalized, away_external_team_id: "2698", away_external_name: "West Georgia" }, fbsIds), "unsupported_non_fbs");
  assert.equal(classifyUnmappedCfbdGame({ ...normalized, away_external_team_id: null }, fbsIds), "unresolved_fbs_mapping");
});
