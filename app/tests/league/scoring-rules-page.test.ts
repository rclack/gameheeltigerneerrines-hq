import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { groupScoringRules, scoringPointsLabel } from "../../src/lib/league/scoring-rules-display.ts";
import type { ScoringRule } from "../../src/types/database.ts";

function rule(category: string, points: number, code = category): ScoringRule {
  return { id: code, league_id: null, code, display_name: code, description: `${code} description`, category, points, active: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
}

test("groups authoritative rules in owner-friendly order and formats positive and negative points", () => {
  const groups = groupScoringRules([rule("coaching", -5), rule("game_result", 1), rule("postseason", 10)]);
  assert.deepEqual(groups.map((group) => group.category), ["game_result", "postseason", "coaching"]);
  assert.equal(scoringPointsLabel(1), "+1 point");
  assert.equal(scoringPointsLabel(3), "+3 points");
  assert.equal(scoringPointsLabel(-1), "-1 point");
});

test("owner scoring guide uses active scoring records and documents lineup, Captain, rankings, and manual behavior", async () => {
  const [page, leagueHome] = await Promise.all([
    readFile(new URL("../../src/app/league/[leagueId]/rules/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../src/app/league/[leagueId]/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /getScoringRules\(supabase, leagueId\)/);
  assert.doesNotMatch(page, /WIN_OVER_TOP_5|MAKE_CFP|HEISMAN_WINNER/);
  for (const text of ["Start / Bench", "Captain&apos;s Choice", "2×", "positive and negative", "potential, non-counting points", "AP Top 25", "CFP rankings", "Power / G5", "with no week", "audit history"]) {
    assert.ok(page.includes(text), `missing ${text}`);
  }
  assert.match(leagueHome, /href=\{`\/league\/\$\{league\.id\}\/rules`\}/);
  assert.ok(leagueHome.includes("How Scoring Works"));
});
