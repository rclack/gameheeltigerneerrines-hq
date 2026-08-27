import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { captainPoints, captainUsage } from "../../src/lib/league/captain.ts";
import { saveMyWeeklyCaptain } from "../../src/services/lineupService.ts";
import type { Database } from "../../src/types/database.ts";

test("Captain doubles positive and negative base scoring without a second formula", () => {
  assert.equal(captainPoints(4, true), 8);
  assert.equal(captainPoints(-3, true), -6);
  assert.equal(captainPoints(4, false), 4);
});

test("used, reserved, and remaining count every active deployment", () => {
  assert.deepEqual(captainUsage(2, [{ locked: true }, { locked: false }]), { allowed: 2, used: 1, reserved: 1, remaining: 0 });
  assert.deepEqual(captainUsage(1, [{ locked: false }]), { allowed: 1, used: 0, reserved: 1, remaining: 0 });
});

test("Captain RPC null result is translated to the owner locked error", async () => {
  const client = { rpc: async () => ({ data: null, error: null }) } as unknown as SupabaseClient<Database>;
  await assert.rejects(saveMyWeeklyCaptain(client, "lineup", "entry", "request"), /already locked/);
});

test("Captain migration contains inactive defaults and core invariants", async () => {
  const sql = (await readFile(new URL("../../supabase/migrations/20260902000000_captain_choice.sql", import.meta.url), "utf8")).toLowerCase();
  for (const invariant of [
    "captain_uses_per_team", "captain_enabled_from_week", "weekly_captain_changes",
    "where is_captain", "for update of lineup", "clock_timestamp()", "order by id for update",
    "captain_locked_at", "base_points", "scoring_multiplier", "captain_at_scoring",
    "new.points := new.base_points * 2", "captain-v1", "schedule_clear",
    "revoke all on function public.set_weekly_lineup_captain", "to authenticated",
  ]) assert.ok(sql.includes(invariant), `missing ${invariant}`);
  assert.match(sql, /captain_usage_policy text not null default 'optional'/);
  assert.match(sql, /not is_captain[\s\S]*status = 'starter'/);
});

test("Captain audit privilege repair grants authenticated read-only access", async () => {
  const sql = (await readFile(new URL("../../supabase/migrations/20260902000001_captain_audit_privilege_repair.sql", import.meta.url), "utf8")).trim().toLowerCase();
  assert.equal(sql, "revoke all on public.weekly_captain_changes from authenticated;\ngrant select on public.weekly_captain_changes to authenticated;");
});

test("owner UI exposes Captain actions, neutral optional state, and usage tracker", async () => {
  const source = await readFile(new URL("../../src/components/league/WeeklyLineup.tsx", import.meta.url), "utf8");
  for (const label of ["Make Captain", "Clear Captain", "No Captain selected this week", "Captain Season Tracker", "Allowed", "Used", "Reserved", "Remaining"]) {
    assert.ok(source.includes(label), `missing ${label}`);
  }
});

test("commissioner correction is protected and requires an audit reason", async () => {
  const [action, migration] = await Promise.all([
    readFile(new URL("../../src/app/commissioner/[leagueId]/captains/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../../supabase/migrations/20260902000000_captain_choice.sql", import.meta.url), "utf8"),
  ]);
  assert.match(action, /commissioner_id/);
  assert.match(action, /reason.length < 2/);
  assert.match(migration, /Captain history corrected by commissioner/);
  assert.match(migration, /scoring_fingerprint = null/);
});
