import type { CfbdTeam, NormalizedCfbdGame } from "./types.ts";

export interface InternalTeamIdentity { id: string; school_name: string; short_name: string; abbreviation: string }
export interface PersistedMapping { team_id: string; external_team_id: string; external_name: string }

const aliases: Record<string, string> = {
  "miami fl": "miami",
  "miami florida": "miami",
  "miami oh": "miami ohio",
  "miami ohio": "miami ohio",
  "southern california": "usc",
  "connecticut": "uconn",
  "north carolina state": "nc state",
  "mississippi": "ole miss",
};

export function normalizeTeamName(value: string) {
  const normalized = value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  return aliases[normalized] ?? normalized;
}

export function classifyUnmappedCfbdGame(game: NormalizedCfbdGame, fbsExternalIds: ReadonlySet<string>) {
  const participantIds = [game.home_external_team_id, game.away_external_team_id];
  if (participantIds.every((id) => id !== null) && participantIds.some((id) => !fbsExternalIds.has(id!))) {
    return "unsupported_non_fbs" as const;
  }
  return "unresolved_fbs_mapping" as const;
}

export function buildTeamMappingAudit(internalTeams: InternalTeamIdentity[], externalTeams: CfbdTeam[], persisted: PersistedMapping[] = []) {
  const byExternalId = new Map(persisted.map((item) => [item.external_team_id, item]));
  const mappedInternal = new Set(persisted.map((item) => item.team_id));
  const candidates = new Map<string, Set<string>>();
  for (const team of internalTeams) {
    for (const value of [team.school_name, team.short_name, team.abbreviation]) {
      const key = normalizeTeamName(value);
      const ids = candidates.get(key) ?? new Set<string>();
      ids.add(team.id); candidates.set(key, ids);
    }
  }
  const created: PersistedMapping[] = [];
  const ambiguous: Array<{ external_team_id: string; external_name: string; candidate_team_ids: string[] }> = [];
  const unmatchedExternal: Array<{ external_team_id: string; external_name: string }> = [];
  for (const external of externalTeams) {
    const externalId = String(external.id);
    if (byExternalId.has(externalId)) continue;
    const ids = new Set<string>();
    for (const value of [external.school, external.abbreviation ?? ""]) {
      for (const id of candidates.get(normalizeTeamName(value)) ?? []) ids.add(id);
    }
    if (ids.size === 1) {
      const teamId = [...ids][0];
      if (!mappedInternal.has(teamId)) { created.push({ team_id: teamId, external_team_id: externalId, external_name: external.school }); mappedInternal.add(teamId); }
      else unmatchedExternal.push({ external_team_id: externalId, external_name: external.school });
    } else if (ids.size > 1) ambiguous.push({ external_team_id: externalId, external_name: external.school, candidate_team_ids: [...ids] });
    else unmatchedExternal.push({ external_team_id: externalId, external_name: external.school });
  }
  return {
    created,
    ambiguous,
    unmatchedExternal,
    unmappedInternal: internalTeams.filter((team) => !mappedInternal.has(team.id)).map((team) => ({ team_id: team.id, internal_name: team.school_name })),
  };
}
