import type { CfbdRankingWeek, NormalizedCfbdGame } from "./types.ts";
import { normalizeTeamName } from "./mapping.ts";

export type AuthoritativeRankingSource = "AP Top 25" | "CFP";

export interface RankingSnapshotInput {
  external_id: string;
  start_at: string;
  ranking_source: AuthoritativeRankingSource;
  home_team_id: string | null;
  home_rank: number | null;
  away_team_id: string | null;
  away_rank: number | null;
}

const AP_NAMES = new Set(["ap top 25", "associated press top 25", "ap poll"]);
const CFP_NAMES = new Set(["college football playoff", "college football playoff rankings", "playoff committee rankings", "cfp rankings"]);

function normalizedPollName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeRankingSource(pollName: string): AuthoritativeRankingSource | null {
  const normalized = normalizedPollName(pollName);
  if (AP_NAMES.has(normalized)) return "AP Top 25";
  if (CFP_NAMES.has(normalized)) return "CFP";
  return null;
}

export function getCfpFirstRankingsAt(season: string, environment: Record<string, string | undefined> = process.env) {
  const name = `CFP_FIRST_RANKINGS_AT_${season}`;
  const configured = environment[name]?.trim();
  if (!configured) throw new Error(`${name} must contain the verified first CFP rankings release timestamp.`);
  const timestamp = new Date(configured);
  if (Number.isNaN(timestamp.getTime()) || !configured.match(/[zZ]|[+-]\d\d:\d\d$/)) {
    throw new Error(`${name} must be an ISO 8601 timestamp with an explicit timezone.`);
  }
  return timestamp;
}

export function authoritativeSourceAt(startAt: string, cfpFirstRankingsAt: Date): AuthoritativeRankingSource {
  return new Date(startAt).getTime() < cfpFirstRankingsAt.getTime() ? "AP Top 25" : "CFP";
}

export function canAutomateRankingSnapshot(startAt: string | null, scoringFingerprint: string | null, now: Date) {
  return scoringFingerprint === null && (startAt === null || new Date(startAt).getTime() > now.getTime());
}

function seasonType(value: string) {
  return value.trim().toLowerCase();
}

function applicablePoll(weeks: CfbdRankingWeek[], game: NormalizedCfbdGame, source: AuthoritativeRankingSource) {
  const candidates = weeks.flatMap((rankingWeek) => rankingWeek.polls
    .filter((poll) => normalizeRankingSource(poll.poll) === source)
    .map((poll) => ({ rankingWeek, poll })));
  if (!candidates.length) throw new Error(`CFBD rankings did not contain a recognized ${source} poll.`);

  const sameSeason = candidates.filter(({ rankingWeek }) => String(rankingWeek.season) === game.season);
  const eligible = sameSeason.filter(({ rankingWeek }) => {
    const type = seasonType(rankingWeek.seasonType);
    if (!game.postseason) return type === "regular" && rankingWeek.week <= game.week;
    return type === "regular" || (type === "postseason" && rankingWeek.week <= game.week);
  });
  return eligible.sort((left, right) => {
    const leftPostseason = seasonType(left.rankingWeek.seasonType) === "postseason" ? 1 : 0;
    const rightPostseason = seasonType(right.rankingWeek.seasonType) === "postseason" ? 1 : 0;
    return rightPostseason - leftPostseason || right.rankingWeek.week - left.rankingWeek.week;
  })[0]?.poll ?? null;
}

export function buildRankingSnapshots(
  games: NormalizedCfbdGame[],
  preparedGames: Array<Record<string, string | number | boolean | null>>,
  rankingWeeks: CfbdRankingWeek[],
  cfpFirstRankingsAt: Date,
) {
  const preparedByExternalId = new Map(preparedGames.map((game) => [String(game.external_id), game]));
  const snapshots: RankingSnapshotInput[] = [];
  const missing: Array<{ external_id: string; source: AuthoritativeRankingSource }> = [];

  for (const game of games) {
    const prepared = preparedByExternalId.get(game.external_id);
    if (!prepared) continue;
    const source = authoritativeSourceAt(game.start_at, cfpFirstRankingsAt);
    const poll = applicablePoll(rankingWeeks, game, source);
    if (!poll) {
      missing.push({ external_id: game.external_id, source });
      continue;
    }
    const ranks = new Map(poll.ranks.map((entry) => [normalizeTeamName(entry.school), entry.rank]));
    snapshots.push({
      external_id: game.external_id,
      start_at: game.start_at,
      ranking_source: source,
      home_team_id: typeof prepared.home_team_id === "string" ? prepared.home_team_id : null,
      home_rank: ranks.get(normalizeTeamName(game.home_external_name)) ?? null,
      away_team_id: typeof prepared.away_team_id === "string" ? prepared.away_team_id : null,
      away_rank: ranks.get(normalizeTeamName(game.away_external_name)) ?? null,
    });
  }
  return { snapshots, missing };
}
