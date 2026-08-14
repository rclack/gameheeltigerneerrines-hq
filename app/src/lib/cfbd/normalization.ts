import type { CfbdGame, CfbdTeam, InternalGameStatus, NormalizedCfbdGame } from "./types.ts";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CFBD returned a malformed record.");
  return value as Record<string, unknown>;
}
function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`CFBD record is missing ${field}.`);
  return value.trim();
}

function requiredNumber(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`CFBD record is missing ${field}.`);
  return value;
}

function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseCfbdTeams(payload: unknown): CfbdTeam[] {
  if (!Array.isArray(payload)) throw new Error("CFBD teams response was not an array.");
  return payload.map((raw) => {
    const item = record(raw);
    return {
      id: requiredNumber(item.id, "team id"),
      school: requiredString(item.school, "team school"),
      abbreviation: typeof item.abbreviation === "string" ? item.abbreviation : null,
    };
  });
}

export function parseCfbdGames(payload: unknown): CfbdGame[] {
  if (!Array.isArray(payload)) throw new Error("CFBD games response was not an array.");
  return payload.map((raw) => {
    const item = record(raw);
    return {
      id: requiredNumber(item.id, "game id"),
      season: requiredNumber(item.season, "season"),
      week: requiredNumber(item.week, "week"),
      seasonType: typeof item.seasonType === "string" ? item.seasonType : null,
      startDate: requiredString(item.startDate, "start date"),
      status: typeof item.status === "string" ? item.status : null,
      completed: typeof item.completed === "boolean" ? item.completed : null,
      neutralSite: typeof item.neutralSite === "boolean" ? item.neutralSite : false,
      homeId: nullableNumber(item.homeId),
      homeTeam: requiredString(item.homeTeam, "home team"),
      homePoints: nullableNumber(item.homePoints),
      awayId: nullableNumber(item.awayId),
      awayTeam: requiredString(item.awayTeam, "away team"),
      awayPoints: nullableNumber(item.awayPoints),
    };
  });
}

export function normalizeCfbdStatus(game: CfbdGame): InternalGameStatus {
  if (game.completed || (game.homePoints !== null && game.homePoints !== undefined && game.awayPoints !== null && game.awayPoints !== undefined && game.status?.toLowerCase().includes("final"))) return "final";
  const status = game.status?.toLowerCase().replaceAll("_", " ") ?? "";
  if (status.includes("cancel")) return "canceled";
  if (status.includes("postpon")) return "postponed";
  if (status.includes("progress") || status.includes("halftime") || status.includes("quarter")) return "in_progress";
  return "scheduled";
}

export function normalizeCfbdGame(game: CfbdGame): NormalizedCfbdGame {
  return {
    external_id: String(game.id),
    season: String(game.season),
    week: game.week,
    game_date: new Date(game.startDate).toISOString().slice(0, 10),
    home_external_team_id: game.homeId == null ? null : String(game.homeId),
    home_external_name: game.homeTeam,
    away_external_team_id: game.awayId == null ? null : String(game.awayId),
    away_external_name: game.awayTeam,
    home_score: game.homePoints ?? null,
    away_score: game.awayPoints ?? null,
    status: normalizeCfbdStatus(game),
    neutral_site: game.neutralSite ?? false,
    postseason: (game.seasonType ?? "regular").toLowerCase() !== "regular",
  };
}
