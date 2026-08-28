import "server-only";

import { parseCfbdGames, parseCfbdRankings, parseCfbdTeams } from "./normalization";
import { classifyCfbdHttpStatus } from "./http";

const CFBD_BASE_URL = "https://api.collegefootballdata.com";

export type CfbdErrorCode = "not_configured" | "authentication_failed" | "rate_limited" | "provider_error" | "invalid_response";

export class CfbdError extends Error {
  constructor(public readonly code: CfbdErrorCode, message: string) { super(message); this.name = "CfbdError"; }
}

export interface CfbdAccountInfo {
  tierName: string;
  monthlyLimit: number | null;
  remainingCalls: number | null;
  usedCalls: number | null;
  resetAt: string;
  sharedPool: boolean;
  features: {
    scoreboard: boolean;
    livePlayByPlay: boolean;
  };
}

export interface CfbdScoreboardGame {
  id: number;
  startDate: string;
  status: "scheduled" | "in_progress" | "completed";
  period: number | null;
  clock: string | null;
  situation: string | null;
  possession: string | null;
  lastPlay: string | null;
  homeTeam: { id: number; name: string; points: number | null; winProbability: number | null };
  awayTeam: { id: number; name: string; points: number | null; winProbability: number | null };
}

function apiKey() {
  const key = process.env.CFBD_API_KEY;
  if (!key) throw new CfbdError("not_configured", "CFBD is not configured.");
  return key;
}

async function request(path: string, params: Record<string, string> = {}, fetcher: typeof fetch = fetch) {
  const url = new URL(path, CFBD_BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const key = apiKey();
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch { throw new CfbdError("provider_error", "CFBD could not be reached."); }
  const failure = classifyCfbdHttpStatus(response.status);
  if (failure === "authentication_failed") throw new CfbdError(failure, "CFBD authentication failed.");
  if (failure === "rate_limited") throw new CfbdError(failure, "CFBD rate limit reached. Try again later.");
  if (failure) throw new CfbdError(failure, `CFBD returned HTTP ${response.status}.`);
  try { return await response.json() as unknown; }
  catch { throw new CfbdError("invalid_response", "CFBD returned malformed JSON."); }
}

export async function fetchCfbdAccountInfo(fetcher: typeof fetch = fetch): Promise<CfbdAccountInfo> {
  const payload = await request("/info", {}, fetcher);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new CfbdError("invalid_response", "CFBD returned malformed account information.");
  const info = payload as Record<string, unknown>;
  const features = info.features;
  if (typeof info.tierName !== "string" || typeof info.resetAt !== "string" || typeof info.sharedPool !== "boolean" || !features || typeof features !== "object" || Array.isArray(features)) {
    throw new CfbdError("invalid_response", "CFBD returned malformed account information.");
  }
  const featureRecord = features as Record<string, unknown>;
  const nullableNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  return {
    tierName: info.tierName,
    monthlyLimit: nullableNumber(info.monthlyLimit),
    remainingCalls: nullableNumber(info.remainingCalls),
    usedCalls: nullableNumber(info.usedCalls),
    resetAt: info.resetAt,
    sharedPool: info.sharedPool,
    features: { scoreboard: featureRecord.scoreboard === true, livePlayByPlay: featureRecord.livePlayByPlay === true },
  };
}

export async function fetchCfbdScoreboard(fetcher: typeof fetch = fetch): Promise<CfbdScoreboardGame[]> {
  const payload = await request("/scoreboard", { classification: "fbs" }, fetcher);
  if (!Array.isArray(payload)) throw new CfbdError("invalid_response", "CFBD returned malformed scoreboard data.");
  return payload.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new CfbdError("invalid_response", "CFBD returned malformed scoreboard data.");
    const game = value as Record<string, unknown>;
    const home = game.homeTeam as Record<string, unknown> | null;
    const away = game.awayTeam as Record<string, unknown> | null;
    if (typeof game.id !== "number" || typeof game.startDate !== "string" || !["scheduled", "in_progress", "completed"].includes(String(game.status)) || !home || !away || typeof home.id !== "number" || typeof home.name !== "string" || typeof away.id !== "number" || typeof away.name !== "string") {
      throw new CfbdError("invalid_response", "CFBD returned malformed scoreboard data.");
    }
    const nullableNumber = (input: unknown) => typeof input === "number" && Number.isFinite(input) ? input : null;
    const probability = (input: unknown) => { const value = nullableNumber(input); return value !== null && value > 1 && value <= 100 ? value / 100 : value; };
    const nullableString = (input: unknown) => typeof input === "string" && input.trim() ? input : null;
    return {
      id: game.id,
      startDate: game.startDate,
      status: game.status as CfbdScoreboardGame["status"],
      period: nullableNumber(game.period),
      clock: nullableString(game.clock),
      situation: nullableString(game.situation),
      possession: nullableString(game.possession),
      lastPlay: nullableString(game.lastPlay),
      homeTeam: { id: home.id, name: home.name, points: nullableNumber(home.points), winProbability: probability(home.winProbability) },
      awayTeam: { id: away.id, name: away.name, points: nullableNumber(away.points), winProbability: probability(away.winProbability) },
    };
  });
}

export async function testCfbdConnection(fetcher: typeof fetch = fetch) {
  await fetchCfbdAccountInfo(fetcher);
  return { status: "connected" as const };
}

export async function fetchCfbdFbsTeams(season: string, fetcher: typeof fetch = fetch) {
  return parseCfbdTeams(await request("/teams/fbs", { year: season }, fetcher));
}

export async function fetchCfbdGames(season: string, fetcher: typeof fetch = fetch) {
  return parseCfbdGames(await request("/games", { year: season, classification: "fbs" }, fetcher));
}

export const CFBD_RANKINGS_ENDPOINT = "/rankings";

export async function fetchCfbdRankings(season: string, fetcher: typeof fetch = fetch) {
  return parseCfbdRankings(await request(CFBD_RANKINGS_ENDPOINT, { year: season, seasonType: "both" }, fetcher));
}
