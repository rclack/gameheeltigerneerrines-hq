import assert from "node:assert/strict";
import test from "node:test";

import { buildTeamBrandingMappings } from "../../src/lib/cfbd/mapping.ts";
import { parseCfbdTeams } from "../../src/lib/cfbd/normalization.ts";

test("CFBD team branding is normalized once for cached internal use", () => {
  const teams = parseCfbdTeams([{ id: 1, school: "Test State", abbreviation: "TST", color: "fff200", alternateColor: "#001b44", logos: ["https://a.espncdn.com/i/teamlogos/test.png"] }]);
  const branding = buildTeamBrandingMappings(teams, [{ team_id: "internal", external_team_id: "1", external_name: "Test State" }]);
  assert.deepEqual(branding, [{
    team_id: "internal", external_team_id: "1", external_name: "Test State",
    primary_color: "#FFF200", secondary_color: "#001B44", logo_url: "https://a.espncdn.com/i/teamlogos/test.png",
  }]);
});

test("invalid colors and non-provider logo hosts fall back without being cached", () => {
  const teams = parseCfbdTeams([{ id: 1, school: "Test State", color: "yellow", alternateColor: null, logos: ["https://example.com/logo.png"] }]);
  const [branding] = buildTeamBrandingMappings(teams, [{ team_id: "internal", external_team_id: "1", external_name: "Test State" }]);
  assert.equal(branding.primary_color, null);
  assert.equal(branding.secondary_color, null);
  assert.equal(branding.logo_url, null);
});
