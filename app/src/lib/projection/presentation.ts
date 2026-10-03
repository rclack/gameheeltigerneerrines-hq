import type { LiveProjectionResult, ProjectionOwnerResult, ProjectedGameFact } from "./live-projection.ts";

export const LIVE_PROJECTION_REFRESH_MS = 3 * 60_000;

export interface GameProjectionOwnerFact {
  owner: ProjectionOwnerResult;
  game: ProjectedGameFact;
  bench: boolean;
}

export function projectionFactsForGame(projection: LiveProjectionResult | null, gameId: string) {
  if (!projection) return { owners: [] as GameProjectionOwnerFact[], tied: false, stale: false };
  const owners = projection.owners.flatMap((owner) => [
    ...owner.contributingGames.filter((game) => game.gameId === gameId).map((game) => ({ owner, game, bench: false })),
    ...owner.benchPotential.filter((game) => game.gameId === gameId).map((game) => ({ owner, game, bench: true })),
  ]);
  return {
    owners,
    tied: projection.context.tiedGames.some((game) => game.gameId === gameId),
    stale: projection.context.staleGames.some((game) => game.gameId === gameId),
  };
}

export function signedPoints(value: number) {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return "0";
}

export function provisionalPoints(owner: ProjectionOwnerResult) {
  return owner.liveDelta + owner.finalPendingDelta;
}

export function hasOwnerProjectionContext(owner: ProjectionOwnerResult) {
  return provisionalPoints(owner) !== 0
    || owner.contributingGames.length > 0
    || owner.benchPotential.some((game) => game.projectedPoints !== 0);
}

export function hasMeaningfulProjectionContext(projection: LiveProjectionResult) {
  return projection.owners.some(hasOwnerProjectionContext)
    || projection.context.tiedGames.length > 0
    || projection.context.staleGames.length > 0
    || projection.context.integrityWarnings.length > 0
    || (projection.freshnessState === "stale" && projection.liveDataFetchedAt !== null);
}

export function projectionFreshnessLabel(projection: LiveProjectionResult, nowMs: number) {
  if (projection.freshnessState !== "fresh" || !projection.liveDataFetchedAt) return "Live projection temporarily unavailable";
  const fetchedMs = Date.parse(projection.liveDataFetchedAt);
  if (!Number.isFinite(fetchedMs)) return "Live projection temporarily unavailable";
  const minutes = Math.max(0, Math.floor((nowMs - fetchedMs) / 60_000));
  if (minutes < 1) return "Updated moments ago";
  return `Updated ${minutes} min ago`;
}

export function projectedMovementLabel(owner: ProjectionOwnerResult) {
  if (owner.projectedRank === owner.officialRank) return `Stays #${owner.projectedRank} if scores hold`;
  const direction = owner.projectedRank < owner.officialRank ? "up" : "down";
  return `Moves ${direction} from #${owner.officialRank} to #${owner.projectedRank} if scores hold`;
}

export function projectedGameSummary(game: ProjectedGameFact) {
  if (game.state === "final_pending") return "FINAL — scoring pending";
  if (game.score.team === game.score.opponent) return "TIED — unresolved";
  const leader = game.score.team > game.score.opponent ? game.teamName : game.opponentName;
  return `${leader} leads ${game.score.team > game.score.opponent ? `${game.score.team}–${game.score.opponent}` : `${game.score.opponent}–${game.score.team}`}`;
}
