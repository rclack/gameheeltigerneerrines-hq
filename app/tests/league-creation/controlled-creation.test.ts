import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../supabase/migrations/20260816121007_controlled_league_creation.sql", import.meta.url), "utf8");
const requestActions = readFileSync(new URL("../../src/app/leagues/actions.ts", import.meta.url), "utf8");
const reviewActions = readFileSync(new URL("../../src/app/league-requests/review/actions.ts", import.meta.url), "utf8");
const reviewPage = readFileSync(new URL("../../src/app/league-requests/review/[decision]/[token]/page.tsx", import.meta.url), "utf8");
const leaguesPage = readFileSync(new URL("../../src/app/leagues/page.tsx", import.meta.url), "utf8");
const commissionerPage = readFileSync(new URL("../../src/app/commissioner/[leagueId]/page.tsx", import.meta.url), "utf8");
const scoringPage = readFileSync(new URL("../../src/app/commissioner/[leagueId]/scoring/page.tsx", import.meta.url), "utf8");
const email = readFileSync(new URL("../../src/lib/email/resend.ts", import.meta.url), "utf8");

test("direct league creation is revoked and requests remain separate from leagues", () => {
  assert.match(migration, /drop policy "Commissioners can create their own leagues"/);
  assert.match(migration, /revoke insert on public\.leagues from anon, authenticated/);
  const beforeDecision = migration.split("create function public.decide_league_creation_request")[0];
  assert.doesNotMatch(beforeDecision, /insert into public\.leagues/);
  assert.match(requestActions, /create_league_creation_request/);
  assert.doesNotMatch(requestActions, /\.from\("leagues"\)\.insert/);
});

test("one pending request, hashed private credentials, rotation, and expiry are enforced", () => {
  assert.match(migration, /unique index league_creation_requests_one_pending_user_idx[\s\S]*where status = 'pending'/);
  assert.match(migration, /private\.league_creation_review_tokens/);
  assert.match(migration, /approve_token_hash bytea/);
  assert.match(migration, /extensions\.digest\(target_token, 'sha256'\)/);
  assert.match(migration, /rotate_league_creation_review_tokens/);
  assert.match(migration, /notification_version = notification_version \+ 1/);
  assert.match(migration, /expires_at > now\(\)/);
});

test("reviewer authorization is bound to the authenticated user id", () => {
  assert.match(migration, /private\.site_administrators[\s\S]*user_id uuid primary key references auth\.users/);
  assert.match(migration, /administrator\.user_id = auth\.uid\(\)/);
  const decisionFunction = migration.split("create function public.decide_league_creation_request")[1];
  assert.match(decisionFunction, /private\.is_site_administrator\(\)/);
  assert.doesNotMatch(decisionFunction, /email\s*=/i);
});

test("GET review is stable and confirmation-only while POST performs one atomic decision", () => {
  assert.match(migration, /create function public.inspect_league_creation_review[\s\S]*language sql[\s\S]*stable/);
  assert.doesNotMatch(reviewPage, /decide_league_creation_request/);
  assert.match(reviewPage, /confirmation-only/);
  assert.match(reviewActions, /decide_league_creation_request/);
  assert.match(migration, /for update of request/);
  assert.match(migration, /insert into public\.leagues/);
  assert.match(migration, /status = 'approved'/);
  assert.match(migration, /status = 'denied'/);
  assert.match(migration, /delete from private\.league_creation_review_tokens/);
});

test("approval creates one league and relies on the existing commissioner membership trigger", () => {
  const decisionFunction = migration.split("create function public.decide_league_creation_request")[1];
  assert.equal((decisionFunction.match(/insert into public\.leagues/g) ?? []).length, 1);
  const foundation = readFileSync(new URL("../../supabase/migrations/20260813000000_auth_and_league_foundation.sql", import.meta.url), "utf8");
  assert.match(foundation, /after insert on public\.leagues[\s\S]*add_league_commissioner_membership/);
  assert.match(decisionFunction, /league_draft_roster_slots/);
  assert.match(decisionFunction, /assert_roster_rule_payload_feasible/);
});

test("approval email has one fixed destination and idempotent delivery", () => {
  assert.match(email, /const LEAGUE_APPROVAL_TO = "cfbpooltest@gmail\.com"/);
  assert.match(email, /to: \[LEAGUE_APPROVAL_TO\]/);
  assert.match(email, /league-request\/\$\{input\.requestId\}\/review\/v\$\{input\.notificationVersion\}/);
  assert.doesNotMatch(requestActions, /console\.(?:log|error).*approve/i);
});

test("league-specific commissioner routes authorize and the league hub links per role", () => {
  for (const page of [commissionerPage, scoringPage]) {
    assert.match(page, /\.eq\("id", leagueId\)\.eq\("commissioner_id", user\.id\)/);
    assert.match(page, /if \(!league\) notFound\(\)/);
  }
  assert.match(leaguesPage, /`\/commissioner\/\$\{league\.id\}`/);
  assert.match(leaguesPage, /Request New League/);
  assert.match(leaguesPage, /Pending Approval/);
});

test("request wizard includes three-team formats and roster rules before review", () => {
  const format = readFileSync(new URL("../../src/components/commissioner/league-setup/LeagueFormatStep.tsx", import.meta.url), "utf8");
  const wizard = readFileSync(new URL("../../src/components/commissioner/LeagueSetupWizard.tsx", import.meta.url), "utf8");
  assert.match(format, /options=\{\["3", "4", "5", "6", "7", "8"\]\}/);
  assert.match(wizard, /RosterRulesStep/);
  assert.match(wizard, /submitLeagueRequest/);
  assert.match(wizard, /\["Welcome", "League basics", "League format", "Roster rules", "Review"\]/);
});
