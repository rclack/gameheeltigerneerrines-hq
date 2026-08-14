export type GameScoringState = "not_final" | "needs_scoring" | "scored" | "needs_reprocessing";

export function getGameScoringState(game: { status: string; scored_at: string | null; scoring_fingerprint: string | null }): GameScoringState {
  if (game.status !== "final") return "not_final";
  if (game.scoring_fingerprint) return "scored";
  return game.scored_at ? "needs_reprocessing" : "needs_scoring";
}
