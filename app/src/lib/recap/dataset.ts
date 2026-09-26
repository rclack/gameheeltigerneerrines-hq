import { getGameScoringState } from "../cfbd/scoringState.ts";
import type { GameDetail } from "../../services/gameService.ts";
import type { ScoringEventDetail } from "../../services/scoringService.ts";
import type { League, LeagueMember, Team } from "../../types/database.ts";
import type { RecapEvent, RecapFact, RecapStanding, VerifiedRecapPayload } from "./types.ts";

export interface SnapshotInput {
  league_member_id: string;
  total_points: number;
  standing_position: number;
  weekly_points: number;
  prior_position: number | null;
}

export interface RecapMemberInput extends LeagueMember {
  ownerName: string;
}

export interface RecapPickInput {
  league_member_id: string;
  team: Team;
}

function signed(value: number) { return `${value > 0 ? "+" : ""}${value}`; }

interface GameContribution {
  id: string;
  eventIds: string[];
  memberId: string | null;
  ownerName: string;
  teamName: string;
  opponentName: string | null;
  opponentPregameRank: number | null;
  finalScore: string | null;
  result: "win" | "loss" | null;
  lineupStatus: RecapEvent["lineupStatus"];
  countsForStandings: boolean;
  captainApplied: boolean;
  scoringMultiplier: 1 | 2;
  basePoints: number;
  points: number;
  scoringReasons: string[];
}

function scoringSource(reasons: string[], result: GameContribution["result"]) {
  const distinct = [...new Set(reasons)];
  const hasWin = distinct.includes("Win");
  const hasLoss = distinct.includes("Loss");
  const rankedBonuses = distinct.filter((reason) => reason.startsWith("Win over "));
  if (hasWin && rankedBonuses.length === distinct.length - 1) return `the win and ranked bonus${rankedBonuses.length === 1 ? "" : "es"}`;
  if (hasWin && distinct.includes("G5 win over Power")) return "the win and G5-over-Power bonus";
  if (hasLoss && distinct.includes("Power loss to G5")) return "the loss and Power-to-G5 penalty";
  if (distinct.length === 1) return `the ${distinct[0].toLocaleLowerCase("en-US")}`;
  if (result) return `the ${result} and ${distinct.length - 1} additional scoring component${distinct.length === 2 ? "" : "s"}`;
  return `${distinct.length} scoring components`;
}

function contributionText(contribution: GameContribution) {
  const opponent = contribution.opponentName ? ` against ${contribution.opponentPregameRank ? `#${contribution.opponentPregameRank} ` : ""}${contribution.opponentName}` : "";
  const result = contribution.result && contribution.finalScore ? ` in a ${contribution.finalScore} ${contribution.result}` : "";
  const source = scoringSource(contribution.scoringReasons, contribution.result);
  const base = `${contribution.ownerName}'s ${contribution.teamName} earned ${signed(contribution.basePoints)} from ${source}${opponent}${result}`;
  return contribution.captainApplied ? `${base}; Captain doubled it to ${signed(contribution.points)}.` : `${base}.`;
}

function uniqueExtreme<T>(items: T[], value: (item: T) => number, direction: "max" | "min", eligible: (value: number) => boolean) {
  const sorted = [...items].sort((left, right) => direction === "max" ? value(right) - value(left) : value(left) - value(right));
  const first = sorted[0];
  if (!first || !eligible(value(first)) || (sorted[1] && value(sorted[1]) === value(first))) return null;
  return first;
}

export function assessRecapReadiness(games: GameDetail[], week: number) {
  const weekGames = games.filter((game) => game.week === week);
  if (!weekGames.length) return { ready: false, reason: `Week ${week} has no synchronized games.` };
  const blocked = weekGames.filter((game) => game.status === "final" && getGameScoringState(game) !== "scored");
  if (blocked.length) return { ready: false, reason: `${blocked.length} final game${blocked.length === 1 ? " is" : "s are"} not Scoring Current.` };
  const unfinished = weekGames.filter((game) => game.status !== "final" && game.status !== "canceled");
  if (unfinished.length) return { ready: false, reason: `${unfinished.length} Week ${week} game${unfinished.length === 1 ? " is" : "s are"} still in progress.` };
  return { ready: true, reason: null };
}

export function buildVerifiedRecapPayload(input: {
  league: League;
  week: number;
  snapshots: SnapshotInput[];
  members: RecapMemberInput[];
  picks: RecapPickInput[];
  events: ScoringEventDetail[];
  games: GameDetail[];
}): VerifiedRecapPayload {
  const memberById = new Map(input.members.map((member) => [member.id, member]));
  const ownerByTeam = new Map(input.picks.map((pick) => [pick.team.id, pick.league_member_id]));
  const teamById = new Map(input.picks.map((pick) => [pick.team.id, pick.team]));
  const gameById = new Map(input.games.map((game) => [game.id, game]));

  const standings: RecapStanding[] = input.snapshots.map((snapshot) => {
    const member = memberById.get(snapshot.league_member_id);
    return {
      memberId: snapshot.league_member_id,
      ownerName: member?.ownerName ?? "Owner",
      poolTeamName: member?.team_name ?? null,
      position: snapshot.standing_position,
      previousPosition: snapshot.prior_position,
      movement: snapshot.prior_position === null ? null : snapshot.prior_position - snapshot.standing_position,
      totalPoints: snapshot.total_points,
      weeklyPoints: snapshot.weekly_points,
    };
  }).sort((left, right) => left.position - right.position || left.ownerName.localeCompare(right.ownerName));

  const events: RecapEvent[] = input.events.filter((event) => event.week === input.week).flatMap((event) => {
    const memberId = event.league_member_id ?? ownerByTeam.get(event.team_id);
    const member = memberId ? memberById.get(memberId) : null;
    const team = teamById.get(event.team_id);
    if (!member || !team) return [];
    const game = event.source_type === "game" && event.source_identifier ? gameById.get(event.source_identifier) : null;
    const isHome = game?.home_team_id === event.team_id;
    const opponent = game ? (isHome ? game.awayParticipant : game.homeParticipant) : null;
    const teamScore = game ? (isHome ? game.home_score : game.away_score) : null;
    const opponentScore = game ? (isHome ? game.away_score : game.home_score) : null;
    const opponentTeamId = game ? (isHome ? game.away_team_id : game.home_team_id) : null;
    const ranking = opponentTeamId ? game?.rankings.find((item) => item.team_id === opponentTeamId) : null;
    return [{
      id: event.id,
      teamId: event.team_id,
      sourceIdentifier: event.source_identifier ?? null,
      ownerName: member.ownerName,
      teamName: team.school_name,
      opponentName: opponent?.displayName ?? null,
      finalScore: teamScore === null || opponentScore === null ? null : `${teamScore}-${opponentScore}`,
      result: teamScore === null || opponentScore === null ? null : teamScore > opponentScore ? "win" : "loss",
      scoringReason: event.rule.display_name,
      basePoints: event.base_points ?? event.points,
      scoringMultiplier: event.scoring_multiplier ?? 1,
      captainApplied: event.captain_at_scoring ?? false,
      lineupStatus: event.lineup_status_at_scoring ?? null,
      countsForStandings: event.counts_for_standings !== false,
      points: event.points,
      opponentPregameRank: ranking?.rank ?? null,
      rankingSource: ranking?.ranking_source ?? null,
    }];
  });

  const facts: RecapFact[] = [];
  const biggestMover = uniqueExtreme(standings, (row) => row.movement ?? 0, "max", (value) => value > 0);
  if (biggestMover) facts.push({ id: `mover:${biggestMover.memberId}`, label: "Biggest Mover", text: `${biggestMover.ownerName} climbed ${biggestMover.movement} spot${biggestMover.movement === 1 ? "" : "s"} to #${biggestMover.position} after a ${signed(biggestMover.weeklyPoints)}-point week.`, priority: 100, eventId: null, memberId: biggestMover.memberId });
  const toughest = uniqueExtreme(standings, (row) => row.weeklyPoints, "min", (value) => value < 0);
  if (toughest) facts.push({ id: `tough:${toughest.memberId}`, label: "Biggest Swing", text: `${toughest.ownerName} finished the week at ${signed(toughest.weeklyPoints)} points and now sits at #${toughest.position} with ${toughest.totalPoints} total.`, priority: 90, eventId: null, memberId: toughest.memberId });
  const topWeek = uniqueExtreme(standings, (row) => row.weeklyPoints, "max", (value) => value > 0);
  if (topWeek) facts.push({ id: `top:${topWeek.memberId}`, label: "Week Leader", text: `${topWeek.ownerName} led the week with ${signed(topWeek.weeklyPoints)} points and now has ${topWeek.totalPoints} total at #${topWeek.position}.`, priority: 95, eventId: null, memberId: topWeek.memberId });

  const grouped = new Map<string, GameContribution>();
  for (const event of events) {
    const memberId = ownerByTeam.get(event.teamId) ?? null;
    const key = [memberId, event.teamId, event.sourceIdentifier ?? event.id, event.countsForStandings, event.lineupStatus, event.captainApplied, event.scoringMultiplier].join(":");
    const existing = grouped.get(key);
    if (existing) {
      existing.eventIds.push(event.id);
      existing.basePoints += event.basePoints;
      existing.points += event.points;
      existing.scoringReasons.push(event.scoringReason);
      continue;
    }
    grouped.set(key, { id: key, eventIds: [event.id], memberId, ownerName: event.ownerName, teamName: event.teamName, opponentName: event.opponentName, opponentPregameRank: event.opponentPregameRank, finalScore: event.finalScore, result: event.result, lineupStatus: event.lineupStatus, countsForStandings: event.countsForStandings, captainApplied: event.captainApplied, scoringMultiplier: event.scoringMultiplier, basePoints: event.basePoints, points: event.points, scoringReasons: [event.scoringReason] });
  }
  const contributions = [...grouped.values()];
  for (const contribution of contributions) {
    contribution.eventIds.sort();
    contribution.scoringReasons.sort();
  }
  const counting = contributions.filter((item) => item.countsForStandings);
  const positive = uniqueExtreme(counting, (item) => item.points, "max", (value) => value > 0);
  const negative = uniqueExtreme(counting, (item) => item.points, "min", (value) => value < 0);
  for (const [contribution, priority] of [[positive, 80], [negative, 75]] as const) {
    if (!contribution) continue;
    const label = contribution.captainApplied ? "Captain Watch" : "Game Impact";
    facts.push({ id: `game:${contribution.eventIds.join(":")}`, label, text: contributionText(contribution), priority, eventId: contribution.eventIds[0], eventIds: contribution.eventIds, memberId: contribution.memberId });
  }
  const bench = contributions
    .filter((item) => !item.countsForStandings && item.lineupStatus === "bench" && item.points !== 0)
    .sort((left, right) => Math.abs(right.points) - Math.abs(left.points) || left.id.localeCompare(right.id))[0];
  if (bench) {
    const opponent = bench.opponentName ? ` against ${bench.opponentPregameRank ? `#${bench.opponentPregameRank} ` : ""}${bench.opponentName}` : "";
    const result = bench.result && bench.finalScore ? ` in a ${bench.finalScore} ${bench.result}` : "";
    facts.push({ id: `bench:${bench.eventIds.join(":")}`, label: "Bench Pain", text: `${bench.ownerName}'s ${bench.teamName} left ${signed(bench.points)} potential points on the bench${opponent}${result}; 0 counted toward the standings.`, priority: 65, eventId: bench.eventIds[0], eventIds: bench.eventIds, memberId: bench.memberId });
  }
  if (!facts.length) facts.push({ id: `week:${input.week}:quiet`, label: "Week in Review", text: `Week ${input.week} produced no active scoring changes in the league.`, priority: 10, eventId: null, memberId: null });

  return {
    version: 1,
    league: { id: input.league.id, name: input.league.name, season: input.league.season, week: input.week },
    standings,
    events,
    facts: facts.sort((left, right) => right.priority - left.priority).slice(0, 8),
    nextWeek: input.games.some((game) => game.week === input.week + 1) ? input.week + 1 : null,
  };
}
