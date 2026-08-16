import type { CfbdGame, CfbdRankingWeek, CfbdTeam, InternalGameStatus, NormalizedCfbdGame } from "./types.ts";
import { trustedTeamLogoUrl } from "../team-logo.ts";

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

function logoCandidate(value: unknown, index: number) {
  if (typeof value === "string") return { url: value, score: -index };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const image = value as Record<string, unknown>;
  const url = [image.href, image.url, image.src].find((candidate): candidate is string => typeof candidate === "string");
  if (!url) return null;
  const labels = [image.type, image.name, ...(Array.isArray(image.rel) ? image.rel : [])]
    .filter((label): label is string => typeof label === "string")
    .join(" ")
    .toLowerCase();
  const width = typeof image.width === "number" && Number.isFinite(image.width) ? image.width : 0;
  const height = typeof image.height === "number" && Number.isFinite(image.height) ? image.height : 0;
  const roleScore = labels.includes("primary") || labels.includes("default") ? 1_000_000 : labels.includes("full") || labels.includes("logo") ? 500_000 : 0;
  return { url, score: roleScore + Math.min(width * height, 499_999) - index };
}

export function normalizeCfbdTeamImages(...collections: unknown[]): string[] {
  const candidates = collections.flatMap((collection) => Array.isArray(collection) ? collection : []);
  const valid = candidates.flatMap((value, index) => {
    const candidate = logoCandidate(value, index);
    if (!candidate) return [];
    const url = trustedTeamLogoUrl(candidate.url);
    return url ? [{ ...candidate, url }] : [];
  });
  valid.sort((left, right) => right.score - left.score);
  return [...new Set(valid.map((candidate) => candidate.url))];
}

export function parseCfbdTeams(payload: unknown): CfbdTeam[] {
  if (!Array.isArray(payload)) throw new Error("CFBD teams response was not an array.");
  return payload.map((raw) => {
    const item = record(raw);
    return {
      id: requiredNumber(item.id, "team id"),
      school: requiredString(item.school, "team school"),
      abbreviation: typeof item.abbreviation === "string" ? item.abbreviation : null,
      color: typeof item.color === "string" ? item.color : null,
      alternateColor: typeof item.alternateColor === "string" ? item.alternateColor : null,
      logos: normalizeCfbdTeamImages(item.images, item.logos),
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

export function parseCfbdRankings(payload: unknown): CfbdRankingWeek[] {
  if (!Array.isArray(payload)) throw new Error("CFBD rankings response was not an array.");
  return payload.map((raw) => {
    const item = record(raw);
    if (!Array.isArray(item.polls)) throw new Error("CFBD ranking week is missing polls.");
    return {
      season: requiredNumber(item.season, "ranking season"),
      seasonType: requiredString(item.seasonType, "ranking season type"),
      week: requiredNumber(item.week, "ranking week"),
      polls: item.polls.map((rawPoll) => {
        const poll = record(rawPoll);
        if (!Array.isArray(poll.ranks)) throw new Error("CFBD poll is missing ranks.");
        return {
          poll: requiredString(poll.poll, "poll name"),
          ranks: poll.ranks.map((rawRank) => {
            const rank = record(rawRank);
            return { rank: requiredNumber(rank.rank, "poll rank"), school: requiredString(rank.school, "ranked school") };
          }),
        };
      }),
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
  const startAt = new Date(game.startDate);
  if (Number.isNaN(startAt.getTime())) throw new Error("CFBD game has an invalid start date.");
  return {
    external_id: String(game.id),
    season: String(game.season),
    week: game.week,
    game_date: startAt.toISOString().slice(0, 10),
    start_at: startAt.toISOString(),
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
