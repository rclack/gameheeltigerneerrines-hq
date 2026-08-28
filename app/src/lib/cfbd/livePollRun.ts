const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function activeLivePollRun<T extends { id: string | null; lease_token: string | null }>(run: T | null): T | null {
  if (!run || !UUID_PATTERN.test(run.id ?? "") || !UUID_PATTERN.test(run.lease_token ?? "")) return null;
  return run;
}
