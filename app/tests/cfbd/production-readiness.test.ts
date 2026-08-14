import assert from "node:assert/strict";
import test from "node:test";

import { safeAuthReturnPath } from "../../src/lib/auth/redirects.ts";

const leagueId = "11111111-1111-4111-8111-111111111111";
const draftId = "22222222-2222-4222-8222-222222222222";
const invitationToken = "a".repeat(64);

test("production auth redirects allow only known internal application paths", () => {
  for (const path of [
    "/commissioner",
    "/commissioner/scoring",
    `/league/${leagueId}`,
    `/league/${leagueId}/score`,
    `/league/${leagueId}/standings`,
    `/draft/${draftId}`,
    `/invite/${invitationToken}`,
  ]) assert.equal(safeAuthReturnPath(path), path);
});

test("production auth redirects reject external, malformed, and unknown paths", () => {
  for (const path of [
    "https://example.com",
    "//example.com",
    "/\\example.com",
    "/commissioner?next=https://example.com",
    "/unknown",
    `/league/${leagueId}/unknown`,
    "/invite/not-a-token",
  ]) assert.equal(safeAuthReturnPath(path), "/commissioner");
});
