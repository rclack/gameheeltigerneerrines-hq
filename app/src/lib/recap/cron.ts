export interface ScheduledRecapOutcome { succeeded: number; skipped: number; failed: number }

export async function runScheduledRecapBatch<T>(
  leagues: T[],
  run: (league: T) => Promise<"succeeded" | "skipped">,
): Promise<ScheduledRecapOutcome> {
  const outcome = { succeeded: 0, skipped: 0, failed: 0 };
  for (const league of leagues) {
    try { outcome[await run(league)] += 1; } catch { outcome.failed += 1; }
  }
  return outcome;
}
