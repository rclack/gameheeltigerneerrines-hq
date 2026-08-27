import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { automaticWeeklyLineup, countingPoints, type LineupCandidate } from "../../src/lib/league/weekly-lineup.ts";
import { saveMyWeeklyStarters } from "../../src/services/lineupService.ts";
import type { Database } from "../../src/types/database.ts";

function teams(count: number, unavailable: number[] = []): LineupCandidate[] { return Array.from({ length: count }, (_, index) => ({ teamId: `team-${index + 1}`, gameId: unavailable.includes(index + 1) ? null : `game-${String(index + 1).padStart(2, "0")}`, kickoffAt: unavailable.includes(index + 1) ? null : `2026-09-05T${String(12 + index).padStart(2, "0")}:00:00Z`, gameStatus: unavailable.includes(index + 1) ? null : "scheduled" })); }

test("Daddies selects four of six by earliest kickoff", () => { const result = automaticWeeklyLineup(teams(6), 4); assert.deepEqual(result.filter((entry) => entry.status === "starter").map((entry) => entry.teamId), ["team-1", "team-2", "team-3", "team-4"]); assert.equal(result.filter((entry) => entry.status === "bench").length, 2); });
test("three-team league selects two starters and one bench", () => { const result = automaticWeeklyLineup(teams(3), 2); assert.equal(result.filter((entry) => entry.status === "starter").length, 2); assert.equal(result.filter((entry) => entry.status === "bench").length, 1); });
test("carry-forward wins over earlier replacement kickoff", () => { const result = automaticWeeklyLineup(teams(3), 2, ["team-2", "team-3"]); assert.deepEqual(result.filter((entry) => entry.status === "starter").map((entry) => entry.teamId).sort(), ["team-2", "team-3"]); });
test("byes replace deterministically and can leave slots empty", () => { const oneBye = automaticWeeklyLineup(teams(3, [2]), 2, ["team-1", "team-2"]); assert.deepEqual(oneBye.filter((entry) => entry.status === "starter").map((entry) => entry.teamId).sort(), ["team-1", "team-3"]); const twoByes = automaticWeeklyLineup(teams(3, [1, 2]), 2, ["team-1", "team-2"]); assert.deepEqual(twoByes.filter((entry) => entry.status === "starter").map((entry) => entry.teamId), ["team-3"]); });
test("canceled and postponed games are not eligible", () => { const candidates = teams(3); candidates[0].gameStatus = "canceled"; candidates[1].gameStatus = "postponed"; const result = automaticWeeklyLineup(candidates, 2); assert.equal(result.filter((entry) => entry.status === "starter").length, 1); assert.equal(result.filter((entry) => entry.status === "no_game").length, 2); });
test("Week 0 is the initial lineup and may leave starter slots empty", () => { const result = automaticWeeklyLineup(teams(6, [2, 3, 4]), 4, [], "week0_auto"); assert.equal(result.filter((entry) => entry.status === "starter").length, 3); assert.ok(result.every((entry) => entry.source === "week0_auto")); });
test("counting totals exclude bench facts and retain legacy events", () => { assert.equal(countingPoints([{ points: 5, counts_for_standings: false }, { points: -1, counts_for_standings: true }, { points: 2 }]), 1); });
test("migration contains locking, audit, RLS, scoring, and recap invariants", async () => { const sql = (await readFile(new URL("../../supabase/migrations/20260901000000_weekly_start_bench_lineups.sql", import.meta.url), "utf8")).toLowerCase(); for (const required of ["starters_per_week", "lineups_enabled_from_week", "weekly_lineup_changes", "enable row level security", "transaction_timestamp()", "for update", "counts_for_standings", "weekly_lineup_entry_id", "draft must be complete", "a requested team has already locked", "correction reason", "event.counts_for_standings", "revoke all on function public.set_weekly_lineup_starters", "to authenticated"]) assert.ok(sql.includes(required), `missing ${required}`); });

test("Week 0 forward migration permits zero and preserves provider provenance", async () => {
  const sql = (await readFile(new URL("../../supabase/migrations/20260901000002_support_competition_week_zero.sql", import.meta.url), "utf8")).toLowerCase();
  for (const required of ["provider_week", "week >= 0", "week0_auto", "target_week > 0", "target_week = 0", "target_week < 0"]) assert.ok(sql.includes(required), `missing ${required}`);
});

test("forward repair preserves the RPC contract and returns after persisting a post-wait lock", async () => {
  const sql = (await readFile(new URL("../../supabase/migrations/20260901000001_persist_weekly_lineup_kickoff_locks.sql", import.meta.url), "utf8")).toLowerCase();
  assert.match(sql, /create or replace function public\.set_weekly_lineup_starters[\s\S]*target_lineup_id uuid,[\s\S]*target_starter_team_ids uuid\[\],[\s\S]*target_request_key uuid/);
  assert.ok(sql.includes("returns public.weekly_lineups"));
  assert.ok(sql.indexOf("for update of lineup") < sql.indexOf("v_now := clock_timestamp()"));
  assert.ok(sql.indexOf("set locked_at = coalesce(locked_at, v_now)") < sql.indexOf("then return null"));
  assert.ok(!sql.includes("then raise exception 'a requested team has already locked'"));
});

test("null lineup RPC result is translated to the existing locked error", async () => {
  const supabase = {
    rpc: async () => ({ data: null, error: null }),
  } as unknown as SupabaseClient<Database>;
  await assert.rejects(
    saveMyWeeklyStarters(supabase, "00000000-0000-0000-0000-000000000001", [], "00000000-0000-0000-0000-000000000002"),
    /already locked/,
  );
});

test("successful lineup RPC rows and genuine errors retain their behavior", async () => {
  const row = { id: "00000000-0000-0000-0000-000000000001" } as Database["public"]["Tables"]["weekly_lineups"]["Row"];
  const successClient = { rpc: async () => ({ data: row, error: null }) } as unknown as SupabaseClient<Database>;
  assert.equal(await saveMyWeeklyStarters(successClient, row.id, [], "00000000-0000-0000-0000-000000000002"), row);

  const rpcError = new Error("RPC unavailable");
  const errorClient = { rpc: async () => ({ data: null, error: rpcError }) } as unknown as SupabaseClient<Database>;
  await assert.rejects(saveMyWeeklyStarters(errorClient, row.id, [], "00000000-0000-0000-0000-000000000003"), rpcError);
});

test("owner lineup UI exposes materialized Week 0/1 navigation and explicit states", async () => {
  const source = await readFile(new URL("../../src/components/league/WeeklyLineup.tsx", import.meta.url), "utf8");
  for (const label of ["Choose lineup week", "Bye / No game", "Canceled", "Postponed", "Locked", "Unlocked", "Empty starting slot", "Starting — Points Count", "Bench — Result Does Not Count"]) {
    assert.ok(source.includes(label), `missing ${label}`);
  }
  assert.match(source, /availableWeeks\.map/);
  assert.match(source, /lineupWeek=\$\{week\}/);
});

test("canceled and postponed entries render only in the unavailable section", async () => {
  const source = await readFile(new URL("../../src/components/league/WeeklyLineup.tsx", import.meta.url), "utf8");
  assert.match(source, /status === "starter" && entry\.gameStatus !== "canceled" && entry\.gameStatus !== "postponed"/);
  assert.match(source, /status === "bench" && entry\.gameStatus !== "canceled" && entry\.gameStatus !== "postponed"/);
});
