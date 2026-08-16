export interface ScheduledLeague { id: string; season: string }

export interface ScheduledSyncOutcome {
  succeeded: number;
  skipped: number;
  failed: number;
}

export function isAuthorizedCronRequest(authorization: string | null, secret: string | undefined) {
  if (!secret || !authorization) return false;
  const expected = `Bearer ${secret}`;
  if (authorization.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= authorization.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

export function configuredCronLeagueIds(value: string | undefined) {
  const ids = [...new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean))];
  if (!ids.length || ids.length > 10 || ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error("Scheduled synchronization league configuration is invalid.");
  }
  return ids;
}

export async function runScheduledSyncBatch(
  leagues: ScheduledLeague[],
  sync: (league: ScheduledLeague) => Promise<"succeeded" | "skipped">,
): Promise<ScheduledSyncOutcome> {
  const outcome = { succeeded: 0, skipped: 0, failed: 0 };
  for (const league of leagues) {
    try {
      outcome[await sync(league)] += 1;
    } catch {
      outcome.failed += 1;
    }
  }
  return outcome;
}
