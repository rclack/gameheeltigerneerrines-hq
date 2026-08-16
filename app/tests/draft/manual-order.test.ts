import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isCompleteDraftOrder, mergeDraftOrder, moveDraftOrder } from "../../src/lib/draft/order.ts";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260827000000_manual_draft_order.sql", import.meta.url),
  "utf8",
);
const permissionMigration = readFileSync(
  new URL("../../supabase/migrations/20260827000001_manual_draft_order_permissions.sql", import.meta.url),
  "utf8",
);
const originalDraftMigration = readFileSync(
  new URL("../../supabase/migrations/20260815000000_college_team_draft.sql", import.meta.url),
  "utf8",
);

function snakeOwners(savedOrder: string[], rounds: number) {
  return Array.from({ length: rounds }, (_, index) => (
    index % 2 === 0 ? savedOrder : [...savedOrder].reverse()
  )).flat();
}

test("manual four-owner and five-owner orders retain every saved position", () => {
  const fourOwners = ["owner-c", "owner-a", "owner-d", "owner-b"];
  const fiveOwners = ["owner-5", "owner-2", "owner-4", "owner-1", "owner-3"];

  assert.deepEqual(mergeDraftOrder(fourOwners, ["owner-a", "owner-b", "owner-c", "owner-d"]), fourOwners);
  assert.deepEqual(mergeDraftOrder(fiveOwners, ["owner-1", "owner-2", "owner-3", "owner-4", "owner-5"]), fiveOwners);
  assert.match(migration, /unnest\(target_member_ids\) with ordinality/);
  assert.match(migration, /requested\.position::integer/);
});

test("manual order rejects duplicate, missing, and foreign owners", () => {
  const accepted = ["one", "two", "three", "four"];
  assert.equal(isCompleteDraftOrder(["one", "two", "three", "four"], accepted, 4), true);
  assert.equal(isCompleteDraftOrder(["one", "two", "two", "four"], accepted, 4), false);
  assert.equal(isCompleteDraftOrder(["one", "two", "three"], accepted, 4), false);
  assert.equal(isCompleteDraftOrder(["one", "two", "three", "foreign"], accepted, 4), false);
  assert.match(migration, /count\(distinct requested\.member_id\)/);
  assert.match(migration, /Draft order must contain every accepted owner exactly once/);
});

test("move controls preserve a unique complete order", () => {
  const accepted = ["one", "two", "three", "four"];
  const moved = moveDraftOrder(accepted, 2, -1);
  assert.deepEqual(moved, ["one", "three", "two", "four"]);
  assert.equal(isCompleteDraftOrder(moved, accepted, 4), true);
  assert.deepEqual(moveDraftOrder(moved, 0, -1), moved);
});

test("the saved order drives generic odd and even snake sequencing", () => {
  assert.deepEqual(snakeOwners(["A", "B", "C", "D"], 2), ["A", "B", "C", "D", "D", "C", "B", "A"]);
  assert.deepEqual(snakeOwners(["A", "B", "C", "D", "E"], 3), ["A", "B", "C", "D", "E", "E", "D", "C", "B", "A", "A", "B", "C", "D", "E"]);
  assert.match(originalDraftMigration, /current_pick < member_count/);
  assert.match(originalDraftMigration, /current_pick > 1/);
});

test("manual order is commissioner-only, pre-draft-only, and randomize remains available", () => {
  assert.match(migration, /league\.commissioner_id = auth\.uid\(\)/);
  assert.match(migration, /League not found or access denied/);
  assert.match(migration, /Draft order cannot change after the draft starts/);
  assert.match(migration, /revoke all on function public\.set_manual_draft_order\(uuid, uuid\[\]\) from public/);
  assert.match(permissionMigration, /revoke all on function public\.set_manual_draft_order\(uuid, uuid\[\]\) from anon/);
  assert.match(migration, /grant execute on function public\.set_manual_draft_order\(uuid, uuid\[\]\) to authenticated/);
  assert.match(originalDraftMigration, /create function public\.randomize_draft_order/);
  assert.match(originalDraftMigration, /delete from public\.draft_slots where draft_id = target_draft_id/);
});
