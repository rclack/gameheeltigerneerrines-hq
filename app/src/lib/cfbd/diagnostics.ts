import type { Json } from "@/types/database";

export type CfbdSyncStage =
  | "audit_creation"
  | "fetching_teams"
  | "fetching_games"
  | "fetching_rankings"
  | "loading_database_context"
  | "mapping_teams"
  | "saving_team_mappings"
  | "importing_games"
  | "importing_rankings"
  | "recording_failure";

export type CfbdSyncErrorCategory =
  | "not_configured"
  | "authentication_failed"
  | "rate_limited"
  | "provider_error"
  | "invalid_response"
  | "mapping_error"
  | "database_error"
  | "internal_error";

export interface SyncProgress {
  teamsFetched: number;
  gamesFetched: number;
  rankingWeeksFetched: number;
  mappingsCreated: number;
  gamesMapped: number;
  gamesUnmapped: number;
}

export interface SafeDatabaseError {
  code: string | null;
  message: string;
  details: string | null;
  hint: string | null;
}

const STAGE_LABELS: Record<CfbdSyncStage, string> = {
  audit_creation: "creating the sync audit",
  fetching_teams: "fetching teams",
  fetching_games: "fetching games",
  fetching_rankings: "fetching rankings",
  loading_database_context: "loading database context",
  mapping_teams: "mapping teams",
  saving_team_mappings: "saving team mappings",
  importing_games: "importing games into the database",
  importing_rankings: "importing pregame ranking snapshots",
  recording_failure: "recording the sync failure",
};

export class CfbdSyncError extends Error {
  readonly stage: CfbdSyncStage;
  readonly category: CfbdSyncErrorCategory;
  readonly userMessage: string;
  readonly databaseError: SafeDatabaseError | null;

  constructor(
    stage: CfbdSyncStage,
    category: CfbdSyncErrorCategory,
    userMessage: string,
    options?: ErrorOptions & { databaseError?: SafeDatabaseError },
  ) {
    super(userMessage, options);
    this.name = "CfbdSyncError";
    this.stage = stage;
    this.category = category;
    this.userMessage = userMessage;
    this.databaseError = options?.databaseError ?? null;
  }
}

export function safeDatabaseError(value: unknown): SafeDatabaseError {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const safe = (field: string) => {
    const raw = item[field];
    return typeof raw === "string" && raw ? redactSensitiveText(raw).slice(0, 500) : null;
  };
  return {
    code: safe("code"),
    message: safe("message") ?? "Database operation failed.",
    details: safe("details"),
    hint: safe("hint"),
  };
}

export function redactSensitiveText(value: unknown) {
  let text = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  const configuredSecret = process.env.CFBD_API_KEY;
  if (configuredSecret) text = text.replaceAll(configuredSecret, "[REDACTED]");
  return text
    .replace(/authorization\s*[:=]\s*bearer\s+[^\s,;]+/gi, "Authorization: [REDACTED]")
    .replace(/bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
    .replace(/CFBD_API_KEY\s*[:=]\s*[^\s,;]+/gi, "CFBD_API_KEY=[REDACTED]");
}

export function databaseSyncError(stage: CfbdSyncStage, cause: unknown) {
  const databaseError = safeDatabaseError(cause);
  console.error(JSON.stringify({ event: "cfbd_schedule_sync_database_failure", stage, category: "database_error", ...databaseError }));
  return new CfbdSyncError(
    stage,
    "database_error",
    `CFBD schedule synchronization failed while ${STAGE_LABELS[stage]}: database operation failed.`,
    { cause, databaseError },
  );
}

export function syncFailureSummary(error: CfbdSyncError, progress: SyncProgress): Json {
  return {
    failure_stage: error.stage,
    error_category: error.category,
    error_message: error.userMessage,
    teams_fetched: progress.teamsFetched,
    games_fetched: progress.gamesFetched,
    ranking_weeks_fetched: progress.rankingWeeksFetched,
    mappings_created: progress.mappingsCreated,
    games_mapped: progress.gamesMapped,
    games_unmapped: progress.gamesUnmapped,
    database_error_code: error.databaseError?.code ?? null,
    database_error_detail: error.databaseError?.details ?? null,
    database_error_hint: error.databaseError?.hint ?? null,
  };
}

export function syncRunFailureDetail(summary: Json): { stage: string; category: string; message: string } | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const item = summary as Record<string, Json | undefined>;
  if (typeof item.failure_stage !== "string" || typeof item.error_category !== "string" || typeof item.error_message !== "string") return null;
  return { stage: item.failure_stage, category: item.error_category, message: item.error_message };
}
