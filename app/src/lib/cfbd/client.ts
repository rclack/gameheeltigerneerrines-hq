import "server-only";

import { parseCfbdGames, parseCfbdRankings, parseCfbdTeams } from "./normalization";
import { classifyCfbdHttpStatus } from "./http";

const CFBD_BASE_URL = "https://api.collegefootballdata.com";

export type CfbdErrorCode = "not_configured" | "authentication_failed" | "rate_limited" | "provider_error" | "invalid_response";

export class CfbdError extends Error {
  constructor(public readonly code: CfbdErrorCode, message: string) { super(message); this.name = "CfbdError"; }
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

export async function testCfbdConnection(fetcher: typeof fetch = fetch) {
  await request("/info", {}, fetcher);
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
