import assert from "node:assert/strict";
import test from "node:test";

import { formatRankedTeamName } from "../../src/lib/league/ranking-display.ts";

test("formats a team with a valid AP rank", () => {
  assert.equal(formatRankedTeamName("Miami (FL)", 7), "#7 Miami (FL)");
});

test("formats unranked teams without a rank prefix", () => {
  assert.equal(formatRankedTeamName("TCU", null), "TCU");
  assert.equal(formatRankedTeamName("North Carolina", undefined), "North Carolina");
});

test("rejects invalid rank values defensively", () => {
  assert.equal(formatRankedTeamName("UNLV", 0), "UNLV");
  assert.equal(formatRankedTeamName("Memphis", Number.NaN), "Memphis");
});
