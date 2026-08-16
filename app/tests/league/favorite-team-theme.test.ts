import assert from "node:assert/strict";
import test from "node:test";

import { contrastRatio, favoriteTeamTheme, readableForeground, safeTeamLogoUrl } from "../../src/lib/league/favorite-team-theme.ts";
import type { Team } from "../../src/types/database.ts";

function team(overrides: Partial<Team> = {}): Team {
  return {
    id: "team", school_name: "Test State", short_name: "Test", abbreviation: "TST", conference: "Test",
    logo_url: null, primary_color: null, secondary_color: null, active: true, created_at: "", ...overrides,
  };
}

test("neutral theme safely handles missing branding", () => {
  assert.deepEqual(favoriteTeamTheme(null), {
    primary: "#172554", secondary: "#F97316", foreground: "#FFFFFF",
    secondaryForeground: "#0F172A", heroAccent: "#F97316", primaryText: "#172554", primaryDark: "#0F1837", logoUrl: null,
  });
});

test("very light and very dark school colors receive readable foregrounds", () => {
  assert.equal(readableForeground("#FFF200"), "#0F172A");
  assert.equal(readableForeground("#001B44"), "#FFFFFF");
  assert.ok(contrastRatio("#FFF200", "#0F172A") >= 4.5);
  assert.ok(contrastRatio("#001B44", "#FFFFFF") >= 4.5);
});

test("favorite branding validates colors and provider logo hosts", () => {
  const themed = favoriteTeamTheme(team({ primary_color: "#fff200", secondary_color: "invalid", logo_url: "https://a.espncdn.com/i/team.png" }));
  assert.equal(themed.primary, "#FFF200");
  assert.equal(themed.secondary, "#F97316");
  assert.equal(themed.foreground, "#0F172A");
  assert.equal(themed.logoUrl, "https://a.espncdn.com/i/team.png");
  assert.equal(favoriteTeamTheme(team({ logo_url: "https://example.com/logo.png" })).logoUrl, null);
});

test("shared logo validation mirrors the trusted CFBD and ESPN policy", () => {
  assert.equal(safeTeamLogoUrl("https://collegefootballdata.com/api/logos/48/2579.png"), "https://collegefootballdata.com/api/logos/48/2579.png");
  assert.equal(safeTeamLogoUrl("https://a.espncdn.com/i/teamlogos/test.png"), "https://a.espncdn.com/i/teamlogos/test.png");
  assert.equal(safeTeamLogoUrl("https://collegefootballdata.com/api/teams/2579.png"), null);
  assert.equal(safeTeamLogoUrl("http://collegefootballdata.com/api/logos/48/2579.png"), null);
  assert.equal(safeTeamLogoUrl("https://example.com/api/logos/48/2579.png"), null);
  assert.equal(safeTeamLogoUrl(null), null);
});
