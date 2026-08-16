import assert from "node:assert/strict";
import test from "node:test";

import { buildTeamBrandingMappings } from "../../src/lib/cfbd/mapping.ts";
import { normalizeCfbdTeamImages, parseCfbdTeams } from "../../src/lib/cfbd/normalization.ts";

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

test("current CFBD image objects are normalized to a trusted HTTPS logo", () => {
  const [team] = parseCfbdTeams([{ id: 1, school: "Test State", images: [{ href: "https://a.espncdn.com/i/teamlogos/test.png", rel: ["full", "default"], width: 500, height: 500 }] }]);
  assert.deepEqual(team.logos, ["https://a.espncdn.com/i/teamlogos/test.png"]);
});

test("legacy logo strings remain supported", () => {
  const [team] = parseCfbdTeams([{ id: 1, school: "Test State", logos: ["https://a1.espncdn.com/i/teamlogos/legacy.png"] }]);
  assert.deepEqual(team.logos, ["https://a1.espncdn.com/i/teamlogos/legacy.png"]);
});

test("multiple candidates prefer a primary/default and larger image", () => {
  const logos = normalizeCfbdTeamImages([
    { url: "https://a.espncdn.com/i/teamlogos/small.png", width: 64, height: 64 },
    { src: "https://a.espncdn.com/i/teamlogos/primary.png", type: "primary", width: 256, height: 256 },
    { href: "https://a.espncdn.com/i/teamlogos/large.png", width: 512, height: 512 },
  ]);
  assert.equal(logos[0], "https://a.espncdn.com/i/teamlogos/primary.png");
  assert.equal(logos[1], "https://a.espncdn.com/i/teamlogos/large.png");
});

test("malformed, non-HTTPS, and untrusted image URLs are rejected", () => {
  assert.deepEqual(normalizeCfbdTeamImages([
    { href: "not a url" },
    { href: "http://a.espncdn.com/i/teamlogos/insecure.png" },
    { href: "https://example.com/logo.png" },
  ]), []);
});

test("missing image collections safely normalize to no logo", () => {
  const [team] = parseCfbdTeams([{ id: 1, school: "Test State" }]);
  assert.deepEqual(team.logos, []);
});
