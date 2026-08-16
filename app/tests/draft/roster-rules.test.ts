import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { eightOwnerRules, fourOwnerRules, remainingEligibleSlots, teamMatchesRosterSlot, type DraftRosterSlotDetail, type RosterRuleInput } from "../../src/lib/draft/roster-rules.ts";
import type { Team, TeamDraftRuleMembership } from "../../src/types/database.ts";

const migration = readFileSync(new URL("../../supabase/migrations/20260816041804_configurable_draft_roster_rules.sql", import.meta.url), "utf8");

function team(id: string, conference: string): Team { return { id, conference, school_name: id, short_name: id, abbreviation: id.slice(0, 4).toUpperCase(), logo_url: null, primary_color: null, secondary_color: null, active: true, created_at: "" }; }
function materialize(rules: RosterRuleInput[]): DraftRosterSlotDetail[] {
  return rules.map((rule, index) => ({ id: `slot-${index + 1}`, league_id: "league", slot_position: index + 1, label: rule.label, unrestricted: rule.unrestricted, created_at: "", updated_at: "", criteria: rule.criteria.map((criterion, criterionIndex) => ({ id: `criterion-${index}-${criterionIndex}`, roster_slot_id: `slot-${index + 1}`, created_at: "", ...criterion })) }));
}
const memberships = [
  { team_id: "Notre Dame", dimension: "conference", value: "Independent" },
  { team_id: "Notre Dame", dimension: "conference", value: "ACC" },
  { team_id: "Notre Dame", dimension: "classification", value: "POWER" },
  { team_id: "UConn", dimension: "conference", value: "Independent" },
  { team_id: "UConn", dimension: "classification", value: "G5" },
] as TeamDraftRuleMembership[];

test("approved Independent memberships preserve factual conference and add rule eligibility", () => {
  const four = materialize(fourOwnerRules());
  const notreDame = team("Notre Dame", "Independent");
  const uconn = team("UConn", "Independent");
  assert.equal(notreDame.conference, "Independent");
  assert.deepEqual(remainingEligibleSlots({ team: notreDame, classification: "INDEPENDENT", memberships, slots: four, filledSlotIds: new Set() }).map((slot) => slot.label), ["ACC", "Wild Card"]);
  assert.deepEqual(remainingEligibleSlots({ team: uconn, classification: "INDEPENDENT", memberships, slots: four, filledSlotIds: new Set() }).map((slot) => slot.label), ["G5", "Wild Card"]);
  const independent = { ...four[0], label: "Independent", criteria: [{ ...four[0].criteria[0], dimension: "conference" as const, value: "Independent" }] };
  assert.equal(teamMatchesRosterSlot(notreDame, "INDEPENDENT", memberships, independent), true);
  assert.equal(teamMatchesRosterSlot(uconn, "INDEPENDENT", memberships, independent), true);
});

test("8-owner, 3-team rules produce the exact approved requirements", () => {
  const slots = materialize(eightOwnerRules());
  assert.deepEqual(slots.map((slot) => slot.label), ["SEC or Big Ten", "ACC or Big 12", "G5"]);
  assert.deepEqual(remainingEligibleSlots({ team: team("Notre Dame", "Independent"), classification: "INDEPENDENT", memberships, slots, filledSlotIds: new Set() }).map((slot) => slot.label), ["ACC or Big 12"]);
  assert.deepEqual(remainingEligibleSlots({ team: team("UConn", "Independent"), classification: "INDEPENDENT", memberships, slots, filledSlotIds: new Set() }).map((slot) => slot.label), ["G5"]);
  assert.equal(8 * slots.length, 24);
});

test("4-owner, 6-team rules support explicit constrained versus Wild Card assignment", () => {
  const slots = materialize(fourOwnerRules());
  const georgia = team("Georgia", "SEC");
  assert.deepEqual(remainingEligibleSlots({ team: georgia, classification: "POWER", memberships, slots, filledSlotIds: new Set() }).map((slot) => slot.label), ["SEC", "Wild Card"]);
  const secSlot = slots.find((slot) => slot.label === "SEC")!;
  assert.deepEqual(remainingEligibleSlots({ team: georgia, classification: "POWER", memberships, slots, filledSlotIds: new Set([secSlot.id]) }).map((slot) => slot.label), ["Wild Card"]);
  assert.equal(4 * slots.length, 24);
});

test("no configured rules preserves unrestricted legacy behavior", () => {
  assert.deepEqual(remainingEligibleSlots({ team: team("Georgia", "SEC"), classification: "POWER", memberships: [], slots: [], filledSlotIds: new Set() }), []);
  assert.match(migration, /if roster_rule_count = 0 then[\s\S]*target_roster_slot_id is not null/i);
  assert.match(migration, /submit_draft_pick\(target_draft_id, target_team_id, null::uuid\)/i);
});

test("authoritative pick path records and enforces one explicit roster slot atomically", () => {
  assert.match(migration, /from public\.drafts where id = target_draft_id for update/i);
  assert.match(migration, /roster_slot_id uuid references public\.league_draft_roster_slots\(id\) on delete restrict/i);
  assert.match(migration, /unique index draft_picks_member_roster_slot_key/i);
  assert.match(migration, /team_matches_draft_roster_slot\(target_team_id, target_roster_slot_id, league_state\.season\)/i);
  assert.match(migration, /Roster rules cannot change after the draft starts/i);
});

test("start validation checks overlapping capacity and queue cannot bypass remaining-slot legality", () => {
  assert.match(migration, /Hall's condition over every slot subset/i);
  assert.match(migration, /eligible_count < target_league\.owner_count \* subset_size/i);
  assert.match(migration, /Team cannot fill a remaining roster slot/i);
  assert.match(migration, /not exists \([\s\S]*pick\.roster_slot_id = slot\.id/i);
});

test("commissioner-only writes and client actions preserve server authority", () => {
  assert.match(migration, /commissioner_id = auth\.uid\(\) for update/i);
  assert.match(migration, /revoke all on function public\.save_draft_roster_rules\(uuid, jsonb\) from public, anon/i);
  const action = readFileSync(new URL("../../src/app/draft/[draftId]/actions.ts", import.meta.url), "utf8");
  assert.match(action, /makeDraftPick\(supabase, draftId, teamId, rosterSlotId\)/);
});
