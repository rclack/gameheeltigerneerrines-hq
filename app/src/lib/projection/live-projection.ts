import { LIVE_PRESENTATION_STALE_AFTER_MS } from "../cfbd/livePresentation.ts";
import { evaluateProjectedGameResult, type ProjectableRule, type ProjectedRuleComponent, type TeamClassification } from "./game-result.ts";

export type ProjectionGameState = "scheduled" | "delayed" | "suspended" | "live" | "tied" | "stale" | "malformed" | "canceled" | "final_pending" | "official";
export type ProjectionLineupStatus = "starter" | "bench" | "no_game" | "legacy" | "missing";

export interface ProjectionMemberInput { id: string; displayName: string }
export interface ProjectionPickInput { memberId: string; teamId: string }
export interface ProjectionOfficialEventInput { memberId: string | null; teamId: string; points: number; createdAt: string }
export interface ProjectionTeamInput { id: string; name: string; conference: string; classification: TeamClassification; classificationResolved: boolean }
export interface ProjectionRankingInput { gameId: string; teamId: string; rank: number | null; capturedAt: string }
export interface ProjectionLineupInput { id: string; memberId: string; week: number; season: string }
export interface ProjectionEntryInput { id: string; lineupId: string; teamId: string; gameId: string | null; status: "starter" | "bench" | "no_game"; isCaptain: boolean }
export interface ProjectionGameInput {
  id: string; season: string; week: number; externalProvider: string | null; externalId: string | null;
  status: string; scoringFingerprint: string | null; homeTeamId: string | null; awayTeamId: string | null;
  homeExternalOpponentId: string | null; awayExternalOpponentId: string | null; homeScore: number | null; awayScore: number | null;
}
export interface ProjectionLiveInput { provider: string; providerGameId: string; status: "scheduled" | "in_progress" | "completed"; homeScore: number | null; awayScore: number | null; fetchedAt: string }
export interface ProjectionExternalOpponentInput { id: string; name: string }

export interface ProjectedGameFact {
  gameId: string; providerGameId: string | null; teamId: string; teamName: string; opponentId: string | null; opponentName: string;
  state: ProjectionGameState; score: { team: number; opponent: number }; lineupEntryId: string | null;
  lineupStatus: ProjectionLineupStatus; counts: boolean; captainApplied: boolean; multiplier: 1 | 2;
  baseProjectedPoints: number; projectedPoints: number; components: ProjectedRuleComponent[];
}
export interface ProjectionOwnerResult {
  memberId: string; displayName: string; officialPoints: number; liveDelta: number; finalPendingDelta: number; projectedTotal: number;
  officialRank: number; projectedRank: number; rankMovement: number; contributingGames: ProjectedGameFact[]; benchPotential: ProjectedGameFact[];
}
export interface ProjectionContextItem { gameId: string; providerGameId: string | null; state: ProjectionGameState; label: string }
export interface LiveProjectionResult {
  leagueId: string; season: string; competitionWeek: number; generatedAt: string; liveDataFetchedAt: string | null;
  freshnessState: "fresh" | "stale" | "unavailable"; officialAsOf: string | null; owners: ProjectionOwnerResult[];
  context: { tiedGames: ProjectionContextItem[]; staleGames: ProjectionContextItem[]; notStartedGames: ProjectionContextItem[]; integrityWarnings: string[] };
}
export interface BuildLiveProjectionInput {
  leagueId: string; season: string; nowMs: number; members: ProjectionMemberInput[]; picks: ProjectionPickInput[];
  officialEvents: ProjectionOfficialEventInput[]; teams: ProjectionTeamInput[]; games: ProjectionGameInput[];
  liveGames: ProjectionLiveInput[]; rankings: ProjectionRankingInput[]; lineups: ProjectionLineupInput[]; entries: ProjectionEntryInput[];
  externalOpponents: ProjectionExternalOpponentInput[]; rules: ProjectableRule[];
}

function competitionRanks(rows: Array<{ memberId: string; points: number; displayName: string }>) {
  const sorted = [...rows].sort((a, b) => b.points - a.points || a.displayName.localeCompare(b.displayName));
  const ranks = new Map<string, number>();
  let previous: number | null = null;
  let rank = 0;
  sorted.forEach((row, index) => { if (row.points !== previous) rank = index + 1; ranks.set(row.memberId, rank); previous = row.points; });
  return ranks;
}

function latestRanking(rows: ProjectionRankingInput[], gameId: string, teamId: string | null) {
  if (!teamId) return { resolved: true, rank: null };
  const row = rows.filter((item) => item.gameId === gameId && item.teamId === teamId).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
  return { resolved: Boolean(row), rank: row?.rank ?? null };
}

export function buildLiveProjection(input: BuildLiveProjectionInput): LiveProjectionResult {
  const teamById = new Map(input.teams.map((team) => [team.id, team]));
  const externalById = new Map(input.externalOpponents.map((team) => [team.id, team.name]));
  const pickByTeam = new Map(input.picks.map((pick) => [pick.teamId, pick]));
  const liveByProviderId = new Map(input.liveGames.map((game) => [`${game.provider}:${game.providerGameId}`, game]));
  const lineupByOwnerWeek = new Map(input.lineups.map((lineup) => [`${lineup.memberId}:${lineup.season}:${lineup.week}`, lineup]));
  const entriesByLineup = new Map<string, ProjectionEntryInput[]>();
  for (const entry of input.entries) entriesByLineup.set(entry.lineupId, [...(entriesByLineup.get(entry.lineupId) ?? []), entry]);
  const official = new Map(input.members.map((member) => [member.id, 0]));
  for (const event of input.officialEvents) {
    const memberId = event.memberId ?? pickByTeam.get(event.teamId)?.memberId;
    if (memberId && official.has(memberId)) official.set(memberId, (official.get(memberId) ?? 0) + event.points);
  }
  const officialRows = input.members.map((member) => ({ memberId: member.id, displayName: member.displayName, points: official.get(member.id) ?? 0 }));
  const officialRanks = competitionRanks(officialRows);
  const facts = new Map(input.members.map((member) => [member.id, { live: [] as ProjectedGameFact[], pending: [] as ProjectedGameFact[], bench: [] as ProjectedGameFact[] }]));
  const tiedGames: ProjectionContextItem[] = [], staleGames: ProjectionContextItem[] = [], notStartedGames: ProjectionContextItem[] = [], warnings: string[] = [];
  let latestLiveAt: string | null = null;
  let competitionWeek = 0;

  for (const game of input.games) {
    const draftedSides = [game.homeTeamId, game.awayTeamId].filter((id): id is string => Boolean(id && pickByTeam.has(id)));
    if (!draftedSides.length) continue;
    const providerGameId = game.externalId;
    const canonical = game.externalProvider && providerGameId ? liveByProviderId.get(`${game.externalProvider}:${providerGameId}`) : undefined;
    if (canonical && (!latestLiveAt || canonical.fetchedAt > latestLiveAt)) latestLiveAt = canonical.fetchedAt;
    let state: ProjectionGameState = "scheduled";
    let homeScore: number | null = null, awayScore: number | null = null;
    const officialCurrent = game.status === "final" && Boolean(game.scoringFingerprint);
    if (officialCurrent) state = "official";
    else if (game.status === "canceled") state = "canceled";
    else if (game.status === "postponed" || game.status === "delayed") state = "delayed";
    else if (game.status === "suspended") state = "suspended";
    else if (game.status === "final") {
      if (game.homeScore !== null && game.awayScore !== null && game.homeScore >= 0 && game.awayScore >= 0 && game.homeScore !== game.awayScore) {
        state = "final_pending"; homeScore = game.homeScore; awayScore = game.awayScore;
      } else { state = "malformed"; warnings.push(`Game ${game.id} is Final without a complete non-tied authoritative score.`); }
    } else if (canonical?.status === "in_progress") {
      const fetchedMs = new Date(canonical.fetchedAt).getTime();
      const fresh = Number.isFinite(fetchedMs) && input.nowMs - fetchedMs >= -60_000 && input.nowMs - fetchedMs <= LIVE_PRESENTATION_STALE_AFTER_MS;
      const validScores = canonical.homeScore !== null && canonical.awayScore !== null && canonical.homeScore >= 0 && canonical.awayScore >= 0;
      if (!fresh) state = "stale";
      else if (!validScores) state = "malformed";
      else { homeScore = canonical.homeScore; awayScore = canonical.awayScore; state = homeScore === awayScore ? "tied" : "live"; }
    }
    if (canonical || game.status === "final") competitionWeek = Math.max(competitionWeek, game.week);
    const contextItem = { gameId: game.id, providerGameId, state, label: state === "tied" ? "TIED — unresolved" : state } satisfies ProjectionContextItem;
    if (state === "tied") tiedGames.push(contextItem);
    if (state === "stale" || state === "malformed") staleGames.push(contextItem);
    if (state === "scheduled" || state === "delayed" || state === "suspended") notStartedGames.push(contextItem);
    if (homeScore === null || awayScore === null || (state !== "live" && state !== "final_pending")) continue;

    const home = game.homeTeamId ? teamById.get(game.homeTeamId) : undefined;
    const away = game.awayTeamId ? teamById.get(game.awayTeamId) : undefined;
    const homeRank = latestRanking(input.rankings, game.id, game.homeTeamId);
    const awayRank = latestRanking(input.rankings, game.id, game.awayTeamId);
    const evaluation = evaluateProjectedGameResult({
      homeScore, awayScore, rules: input.rules,
      home: { teamId: game.homeTeamId, classification: home?.classification ?? null, classificationResolved: game.homeTeamId ? Boolean(home?.classificationResolved) : true, pregameRank: homeRank.rank, rankingContextResolved: homeRank.resolved },
      away: { teamId: game.awayTeamId, classification: away?.classification ?? null, classificationResolved: game.awayTeamId ? Boolean(away?.classificationResolved) : true, pregameRank: awayRank.rank, rankingContextResolved: awayRank.resolved },
    });
    warnings.push(...evaluation.warnings.map((warning) => `Game ${game.id}: ${warning}`));

    for (const side of [
      { teamId: game.homeTeamId, opponentId: game.awayTeamId, externalOpponentId: game.awayExternalOpponentId, teamScore: homeScore, opponentScore: awayScore, components: evaluation.home },
      { teamId: game.awayTeamId, opponentId: game.homeTeamId, externalOpponentId: game.homeExternalOpponentId, teamScore: awayScore, opponentScore: homeScore, components: evaluation.away },
    ]) {
      if (!side.teamId || !pickByTeam.has(side.teamId)) continue;
      const pick = pickByTeam.get(side.teamId)!;
      const lineup = lineupByOwnerWeek.get(`${pick.memberId}:${game.season}:${game.week}`);
      const matchingEntries = lineup ? (entriesByLineup.get(lineup.id) ?? []).filter((entry) => entry.teamId === side.teamId && entry.gameId === game.id) : [];
      const entry = matchingEntries.length === 1 ? matchingEntries[0] : null;
      const lineupStatus: ProjectionLineupStatus = entry?.status ?? "missing";
      if (!entry || matchingEntries.length !== 1) warnings.push(`Game ${game.id}, team ${side.teamId}: authoritative lineup entry is missing or ambiguous; projected points were withheld.`);
      if (lineupStatus === "no_game") warnings.push(`Game ${game.id}, team ${side.teamId}: a live/final game conflicts with authoritative no_game lineup status.`);
      const counts = lineupStatus === "starter";
      const multiplier: 1 | 2 = counts && entry?.isCaptain ? 2 : 1;
      const components = side.components.map((item) => ({ ...item, multiplier, points: item.basePoints * multiplier }));
      const baseProjectedPoints = components.reduce((sum, item) => sum + item.basePoints, 0);
      const projectedPoints = components.reduce((sum, item) => sum + item.points, 0);
      const fact: ProjectedGameFact = {
        gameId: game.id, providerGameId, teamId: side.teamId, teamName: teamById.get(side.teamId)?.name ?? "Team",
        opponentId: side.opponentId, opponentName: side.opponentId ? teamById.get(side.opponentId)?.name ?? "Opponent" : externalById.get(side.externalOpponentId ?? "") ?? "External opponent",
        state, score: { team: side.teamScore, opponent: side.opponentScore }, lineupEntryId: entry?.id ?? null, lineupStatus,
        counts, captainApplied: multiplier === 2, multiplier, baseProjectedPoints, projectedPoints, components,
      };
      if (counts) (state === "final_pending" ? facts.get(pick.memberId)!.pending : facts.get(pick.memberId)!.live).push(fact);
      else facts.get(pick.memberId)!.bench.push(fact);
    }
  }

  const projectedRows = input.members.map((member) => {
    const ownerFacts = facts.get(member.id)!;
    const liveDelta = ownerFacts.live.reduce((sum, fact) => sum + fact.projectedPoints, 0);
    const finalPendingDelta = ownerFacts.pending.reduce((sum, fact) => sum + fact.projectedPoints, 0);
    return { memberId: member.id, displayName: member.displayName, points: (official.get(member.id) ?? 0) + liveDelta + finalPendingDelta, liveDelta, finalPendingDelta };
  });
  const projectedRanks = competitionRanks(projectedRows);
  const owners = input.members.map((member): ProjectionOwnerResult => {
    const row = projectedRows.find((item) => item.memberId === member.id)!;
    const ownerFacts = facts.get(member.id)!;
    const officialRank = officialRanks.get(member.id) ?? 0;
    const projectedRank = projectedRanks.get(member.id) ?? 0;
    return { memberId: member.id, displayName: member.displayName, officialPoints: official.get(member.id) ?? 0, liveDelta: row.liveDelta,
      finalPendingDelta: row.finalPendingDelta, projectedTotal: row.points, officialRank, projectedRank, rankMovement: officialRank - projectedRank,
      contributingGames: [...ownerFacts.live, ...ownerFacts.pending], benchPotential: ownerFacts.bench };
  }).sort((a, b) => a.projectedRank - b.projectedRank || b.projectedTotal - a.projectedTotal || a.displayName.localeCompare(b.displayName));
  const latestMs = latestLiveAt ? new Date(latestLiveAt).getTime() : NaN;
  return {
    leagueId: input.leagueId, season: input.season, competitionWeek, generatedAt: new Date(input.nowMs).toISOString(), liveDataFetchedAt: latestLiveAt,
    freshnessState: !latestLiveAt ? "unavailable" : input.nowMs - latestMs <= LIVE_PRESENTATION_STALE_AFTER_MS ? "fresh" : "stale",
    officialAsOf: input.officialEvents.map((event) => event.createdAt).sort().at(-1) ?? null, owners,
    context: { tiedGames, staleGames, notStartedGames, integrityWarnings: [...new Set(warnings)] },
  };
}
