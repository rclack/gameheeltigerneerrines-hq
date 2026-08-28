import "server-only";

import { createHash } from "node:crypto";

import type { CfbdScoreboardGame } from "./client";

export interface CanonicalLiveGame {
  provider_game_id: string;
  start_at: string;
  status: CfbdScoreboardGame["status"];
  period: number | null;
  clock: string | null;
  situation: string | null;
  possession: string | null;
  last_play: string | null;
  home_external_team_id: string;
  home_name: string;
  home_score: number | null;
  home_win_probability: number | null;
  away_external_team_id: string;
  away_name: string;
  away_score: number | null;
  away_win_probability: number | null;
  state_fingerprint: string;
}

export function canonicalizeScoreboardGame(game: CfbdScoreboardGame): CanonicalLiveGame {
  const state = {
    provider_game_id: String(game.id),
    start_at: new Date(game.startDate).toISOString(),
    status: game.status,
    period: game.period,
    clock: game.clock,
    situation: game.situation,
    possession: game.possession,
    last_play: game.lastPlay,
    home_external_team_id: String(game.homeTeam.id),
    home_name: game.homeTeam.name,
    home_score: game.homeTeam.points,
    home_win_probability: game.homeTeam.winProbability,
    away_external_team_id: String(game.awayTeam.id),
    away_name: game.awayTeam.name,
    away_score: game.awayTeam.points,
    away_win_probability: game.awayTeam.winProbability,
  };
  return { ...state, state_fingerprint: createHash("sha256").update(JSON.stringify(state)).digest("hex") };
}

export function sanitizedLivePollError(error: unknown) {
  if (error instanceof Error && /rate limit/i.test(error.message)) return { category: "rate_limited", message: "CFBD rate limit reached." };
  if (error instanceof Error && /authentication/i.test(error.message)) return { category: "authentication_failed", message: "CFBD authentication failed." };
  return { category: "provider_error", message: "CFBD live scoreboard polling failed." };
}
