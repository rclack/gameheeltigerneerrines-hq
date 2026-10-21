import { createHash } from "node:crypto";

import type { ChaosCandidate } from "./types.ts";
import type { LiveProjectionResult } from "../projection/live-projection.ts";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export interface ChaosObservation {
  observationKey: string;
  observedAt: string;
  authorityState: "fresh" | "stale" | "unavailable";
  candidates: ChaosCandidate[];
  staleGameIds: string[];
  settledGameIds: string[];
}

export function buildChaosObservation(projection: LiveProjectionResult, settledGames: Array<{ id: string; scoring_fingerprint: string | null }>): ChaosObservation {
  const candidates = projection.chaos?.candidates ?? [];
  const staleGameIds = [...new Set(projection.context.staleGames.map((game) => game.gameId))].sort();
  const settled = settledGames.filter((game) => Boolean(game.scoring_fingerprint))
    .map((game) => ({ id: game.id, fingerprint: game.scoring_fingerprint })).sort((a, b) => a.id.localeCompare(b.id));
  const material = {
    version: 1, leagueId: projection.leagueId, authorityState: projection.freshnessState,
    candidates: candidates.map((item) => ({ eventKey: item.eventKey, stateFingerprint: item.stateFingerprint,
      canonicalStateFingerprint: item.source.canonicalStateFingerprint })).sort((a, b) => a.eventKey.localeCompare(b.eventKey)),
    context: [...projection.context.tiedGames, ...projection.context.staleGames]
      .map((game) => ({ gameId: game.gameId, state: game.state, sourceFingerprint: game.sourceFingerprint ?? null }))
      .sort((a, b) => a.gameId.localeCompare(b.gameId)),
    settled,
  };
  return { observationKey: `chaos_observation_${digest(material)}`, observedAt: projection.generatedAt,
    authorityState: projection.freshnessState, candidates, staleGameIds, settledGameIds: settled.map((game) => game.id) };
}
