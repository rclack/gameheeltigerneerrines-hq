import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { OWNER_COUNT_OPTIONS } from "../../src/lib/draft/config.ts";

const draftMigration = readFileSync(
  new URL("../../supabase/migrations/20260815000000_college_team_draft.sql", import.meta.url),
  "utf8",
);
const draftSetup = readFileSync(
  new URL("../../src/components/commissioner/DraftSetup.tsx", import.meta.url),
  "utf8",
);

function snakePositions(ownerCount: number, rounds: number) {
  const positions: number[] = [];
  let round = 1;
  let currentPick = 1;

  while (round <= rounds) {
    positions.push(currentPick);
    if (round % 2 === 1) {
      if (currentPick < ownerCount) currentPick += 1;
      else round += 1;
    } else if (currentPick > 1) currentPick -= 1;
    else round += 1;
  }

  return positions;
}

test("league setup offers every owner count from 4 through 16", () => {
  assert.deepEqual(
    OWNER_COUNT_OPTIONS,
    ["4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16"],
  );
});

test("five-owner setup uses five slots, exact readiness, and owner-by-round total picks", () => {
  assert.match(draftMigration, /row_number\(\) over \(order by random\(\)\)/);
  assert.match(draftMigration, /accepted_count <> target_league\.owner_count/);
  assert.match(draftMigration, /slot_count <> accepted_count/);
  assert.match(draftSetup, /members\.length === ownerCount/);
  assert.match(draftSetup, /participants\.length === ownerCount/);
  assert.match(draftSetup, /ownerCount \* teamsPerOwner/);

  const ownerCount = 5;
  const teamsPerOwner = 6;
  assert.deepEqual(Array.from({ length: ownerCount }, (_, index) => index + 1), [1, 2, 3, 4, 5]);
  assert.equal(ownerCount * teamsPerOwner, 30);
});

test("five-owner snake draft reverses normally every round", () => {
  assert.match(draftMigration, /mod\(draft_state\.current_round, 2\) = 1/);
  assert.match(draftMigration, /draft_state\.current_pick < member_count/);
  assert.match(draftMigration, /draft_state\.current_pick > 1/);
  assert.match(draftMigration, /next_overall >= member_count \* league_state\.teams_per_owner/);

  assert.deepEqual(
    snakePositions(5, 4),
    [1, 2, 3, 4, 5, 5, 4, 3, 2, 1, 1, 2, 3, 4, 5, 5, 4, 3, 2, 1],
  );
});
