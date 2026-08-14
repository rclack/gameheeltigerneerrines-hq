import type { NormalizedCfbdGame } from "./types.ts";

export interface ExternalOpponentInput {
  provider: "cfbd";
  external_id: string;
  display_name: string;
  classification: "fcs" | "other";
}

export function prepareCfbdSchedule(
  games: NormalizedCfbdGame[],
  fbsExternalIds: ReadonlySet<string>,
  internalTeamIdByExternalId: ReadonlyMap<string, string>,
) {
  const externalOpponents = new Map<string, ExternalOpponentInput>();
  const prepared: Array<Record<string, string | number | boolean | null>> = [];
  const unresolvedGames: Array<{ external_id: string; home: string; away: string }> = [];
  for (const game of games) {
    const sides = (["home", "away"] as const).map((side) => {
      const externalId = game[`${side}_external_team_id`];
      const name = game[`${side}_external_name`];
      if (!externalId) return null;
      const teamId = internalTeamIdByExternalId.get(externalId);
      if (teamId) return { teamId, externalOpponentKey: null };
      if (fbsExternalIds.has(externalId)) return null;
      externalOpponents.set(externalId, { provider: "cfbd", external_id: externalId, display_name: name, classification: "fcs" });
      return { teamId: null, externalOpponentKey: externalId };
    });
    if (!sides[0] || !sides[1] || (!sides[0].teamId && !sides[1].teamId)) {
      unresolvedGames.push({ external_id: game.external_id, home: game.home_external_name, away: game.away_external_name });
      continue;
    }
    const item: Record<string, string | number | boolean | null> = { ...game, home_team_id: sides[0].teamId, away_team_id: sides[1].teamId };
    if (sides[0].externalOpponentKey) item.home_external_opponent_external_id = sides[0].externalOpponentKey;
    if (sides[1].externalOpponentKey) item.away_external_opponent_external_id = sides[1].externalOpponentKey;
    prepared.push(item);
  }
  return { games: prepared, externalOpponents: [...externalOpponents.values()], unresolvedGames };
}
