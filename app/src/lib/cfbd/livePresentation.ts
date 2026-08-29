import type { Database } from "@/types/database";

export type LiveScoreboardGame = Database["public"]["Tables"]["live_scoreboard_games"]["Row"];
export type LiveScoreboardSnapshot = Database["public"]["Tables"]["live_scoreboard_snapshots"]["Row"];

export const LIVE_PRESENTATION_STALE_AFTER_MS = 15 * 60_000;

export interface LivePresentation {
  status: "scheduled" | "in_progress" | "completed";
  homeScore: number | null;
  awayScore: number | null;
  period: number | null;
  clock: string | null;
  fetchedAt: string;
}

function clockSeconds(clock: string | null) {
  const match = clock?.match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  return minutes <= 15 ? minutes * 60 + seconds : null;
}

export function validatedLiveClock(live: LiveScoreboardGame, snapshots: LiveScoreboardSnapshot[]) {
  if (live.status !== "in_progress" || live.period === null || live.period < 1) return null;
  const currentSeconds = clockSeconds(live.clock);
  if (currentSeconds === null) return null;
  const previous = snapshots
    .filter((snapshot) => snapshot.fetched_at < live.fetched_at && snapshot.period === live.period)
    .sort((left, right) => right.fetched_at.localeCompare(left.fetched_at))
    .find((snapshot) => clockSeconds(snapshot.clock) !== null);
  const previousSeconds = previous ? clockSeconds(previous.clock) : null;
  return previousSeconds !== null && currentSeconds > previousSeconds ? null : live.clock;
}

export function livePresentation(
  live: LiveScoreboardGame | null,
  snapshots: LiveScoreboardSnapshot[],
  nowMs: number,
): LivePresentation | null {
  if (!live) return null;
  const fetchedAtMs = new Date(live.fetched_at).getTime();
  const ageMs = nowMs - fetchedAtMs;
  if (!Number.isFinite(fetchedAtMs) || ageMs < -60_000 || ageMs > LIVE_PRESENTATION_STALE_AFTER_MS) return null;
  const scoresAreSane = live.home_score !== null && live.away_score !== null
    && live.home_score >= 0 && live.away_score >= 0;
  return {
    status: live.status,
    homeScore: scoresAreSane ? live.home_score : null,
    awayScore: scoresAreSane ? live.away_score : null,
    period: live.status === "in_progress" && live.period !== null && live.period >= 1 ? live.period : null,
    clock: validatedLiveClock(live, snapshots),
    fetchedAt: live.fetched_at,
  };
}

export function liveFreshnessLabel(fetchedAt: string, nowMs: number) {
  const minutes = Math.max(0, Math.floor((nowMs - new Date(fetchedAt).getTime()) / 60_000));
  return minutes < 1 ? "Updated just now" : `Updated ${minutes} min ago`;
}
