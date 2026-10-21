import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { busyChaosFixture, emptyChaosFixture } from "../../src/lib/chaos/fixtures.ts";
import { buildChaosFeed, CHAOS_LABELS, chaosCopy, chaosStatus } from "../../src/lib/chaos/presentation.ts";

test("player labels cover every certified neutral event code", () => {
  assert.deepEqual(CHAOS_LABELS, {
    CAPTAIN_POSITIVE: "Captain Hero", CAPTAIN_NEGATIVE: "Captain Disaster", BENCH_POSITIVE: "Bench Pain",
    PROJECTED_LEAD_CHANGE: "Projected Lead Change", PROJECTED_RANK_MOVE: "Standings Shakeup",
    UPSET_DANGER: "Upset Alert", G5_POWER_SWING: "G5 Chaos", MAJOR_SCORING_SWING: "Big Points Swing",
  });
});

test("empty and busy fixtures cover all twenty required visual states without production writes", () => {
  assert.deepEqual(buildChaosFeed(emptyChaosFixture), { active: [], recent: [] });
  assert.ok(busyChaosFixture.active.length + busyChaosFixture.transitions.length >= 20);
  const types = new Set(busyChaosFixture.active.map((item) => item.eventType));
  assert.deepEqual([...Object.keys(CHAOS_LABELS)].every((type) => types.has(type)), true);
  assert.ok(busyChaosFixture.active.some((item) => item.lifecycle === "suspended"));
  assert.ok(busyChaosFixture.active.some((item) => item.facts && typeof item.facts === "object" && !Array.isArray(item.facts) && item.facts.gameState === "final_pending"));
  assert.ok(busyChaosFixture.transitions.some((item) => item.lifecycle === "resolved"));
  assert.ok(busyChaosFixture.active.some((item) => (item.ownerName?.length ?? 0) > 40));
  assert.ok(busyChaosFixture.nextCursor);
});

test("presentation suppresses redundant generic and rank cards without changing certified severity", () => {
  const model = buildChaosFeed(busyChaosFixture);
  const grouped = model.active.filter((item) => item.ownerName === "Grouped Owner");
  assert.deepEqual(grouped.map((item) => item.eventType), ["CAPTAIN_POSITIVE"]);
  assert.equal(grouped[0]!.severity, "major");
  assert.equal(model.active.some((item) => item.severity === "info"), false);
  assert.equal(buildChaosFeed(busyChaosFixture, true).active.some((item) => item.severity === "info"), true);
});

test("episodes, provisional language, stale state, and official settlement remain explicit", () => {
  const captain = busyChaosFixture.active.find((item) => item.eventType === "CAPTAIN_POSITIVE")!;
  assert.match(chaosCopy(captain).impact, /provisional points/);
  const stale = busyChaosFixture.active.find((item) => item.lifecycle === "suspended")!;
  assert.equal(chaosStatus(stale), "Live authority unavailable");
  const settled = { ...busyChaosFixture.transitions[0]!, resolutionReason: "OFFICIAL_SETTLED" };
  assert.equal(chaosStatus(settled), "Officially settled");
  assert.notEqual(busyChaosFixture.active[0]!.episodeId, busyChaosFixture.transitions[0]!.episodeId);
});

test("web consumer uses authenticated no-store reads, visibility-aware 180-second refresh, and safe navigation", () => {
  const component = readFileSync(new URL("../../src/components/league/LeagueChaos.tsx", import.meta.url), "utf8");
  assert.match(component, /const REFRESH_MS = 180_000/);
  assert.match(component, /credentials: "same-origin"/);
  assert.match(component, /cache: "no-store"/);
  assert.match(component, /document\.visibilityState === "visible"/);
  assert.match(component, /\/league\/\$\{leagueId\}\/games\/\$\{item\.gameId\}/);
  assert.match(component, /\/league\/\$\{leagueId\}\/standings/);
  assert.doesNotMatch(component, /supabase|service_role|cfbd/i);
});

test("home placement follows the Saturday Watchlist directly", () => {
  const page = readFileSync(new URL("../../src/app/league/[leagueId]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<SaturdayWatchlist[^>]+\/>[\s\S]*?<LeagueChaos leagueId=\{league\.id\} \/>/);
});
