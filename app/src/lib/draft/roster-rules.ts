import type { DraftRosterCriterion, DraftRosterSlot, Team, TeamDraftRuleMembership } from "../../types/database.ts";

export type RosterRuleCriterionInput = Pick<DraftRosterCriterion, "dimension" | "value">;
export interface RosterRuleInput { label: string; unrestricted: boolean; criteria: RosterRuleCriterionInput[] }
export type DraftRosterSlotDetail = DraftRosterSlot & { criteria: DraftRosterCriterion[] };

export const CONFERENCE_OPTIONS = ["ACC", "American", "Big 12", "Big Ten", "Conference USA", "Independent", "MAC", "Mountain West", "Pac-12", "SEC", "Sun Belt"] as const;
export const CLASSIFICATION_OPTIONS = ["POWER", "G5", "INDEPENDENT"] as const;

export function teamMatchesRosterSlot(
  team: Pick<Team, "id" | "conference">,
  classification: string | null,
  memberships: Pick<TeamDraftRuleMembership, "team_id" | "dimension" | "value">[],
  slot: Pick<DraftRosterSlotDetail, "unrestricted" | "criteria">,
) {
  if (slot.unrestricted) return true;
  return slot.criteria.some((criterion) => {
    if (criterion.dimension === "conference" && criterion.value === team.conference) return true;
    if (criterion.dimension === "classification" && criterion.value === classification) return true;
    return memberships.some((membership) => membership.team_id === team.id && membership.dimension === criterion.dimension && membership.value === criterion.value);
  });
}

export function remainingEligibleSlots(input: {
  team: Pick<Team, "id" | "conference">;
  classification: string | null;
  memberships: Pick<TeamDraftRuleMembership, "team_id" | "dimension" | "value">[];
  slots: DraftRosterSlotDetail[];
  filledSlotIds: Set<string>;
}) {
  return input.slots.filter((slot) => !input.filledSlotIds.has(slot.id) && teamMatchesRosterSlot(input.team, input.classification, input.memberships, slot));
}

export function unrestrictedRules(): RosterRuleInput[] { return []; }

export function eightOwnerRules(): RosterRuleInput[] {
  return [
    { label: "SEC or Big Ten", unrestricted: false, criteria: [{ dimension: "conference", value: "SEC" }, { dimension: "conference", value: "Big Ten" }] },
    { label: "ACC or Big 12", unrestricted: false, criteria: [{ dimension: "conference", value: "ACC" }, { dimension: "conference", value: "Big 12" }] },
    { label: "G5", unrestricted: false, criteria: [{ dimension: "classification", value: "G5" }] },
  ];
}

export function fourOwnerRules(): RosterRuleInput[] {
  const rules: RosterRuleInput[] = ["SEC", "Big Ten", "ACC", "Big 12"].map((conference) => ({ label: conference, unrestricted: false, criteria: [{ dimension: "conference", value: conference }] }));
  rules.push(
    { label: "G5", unrestricted: false, criteria: [{ dimension: "classification", value: "G5" }] },
    { label: "Wild Card", unrestricted: true, criteria: [] },
  );
  return rules;
}

export function rulesSummary(rules: Array<Pick<RosterRuleInput, "label">>) {
  return rules.length ? rules.map((rule) => rule.label).join(" · ") : "No conference restrictions";
}
