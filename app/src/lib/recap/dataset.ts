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
    const memberId = ownerByTeam.get(event.team_id);
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
      ownerName: member.ownerName,
      teamName: team.school_name,
      opponentName: opponent?.displayName ?? null,
      finalScore: teamScore === null || opponentScore === null ? null : `${teamScore}-${opponentScore}`,
      result: teamScore === null || opponentScore === null ? null : teamScore > opponentScore ? "win" : "loss",
      scoringReason: event.rule.display_name,
      points: event.points,
      opponentPregameRank: ranking?.rank ?? null,
      rankingSource: ranking?.ranking_source ?? null,
    }];
  });

  const facts: RecapFact[] = [];
  const biggestMover = uniqueExtreme(standings, (row) => row.movement ?? 0, "max", (value) => value > 0);
  if (biggestMover) facts.push({ id: `mover:${biggestMover.memberId}`, label: "Biggest Mover", text: `${biggestMover.ownerName} climbed ${biggestMover.movement} spot${biggestMover.movement === 1 ? "" : "s"} to #${biggestMover.position} after a ${signed(biggestMover.weeklyPoints)}-point week.`, priority: 100, eventId: null, memberId: biggestMover.memberId });
  const toughest = uniqueExtreme(standings, (row) => row.weeklyPoints, "min", (value) => value < 0);
  if (toughest) facts.push({ id: `tough:${toughest.memberId}`, label: "Toughest Saturday", text: `${toughest.ownerName} had the league's toughest week at ${signed(toughest.weeklyPoints)} points and now sits at #${toughest.position} with ${toughest.totalPoints} total.`, priority: 90, eventId: null, memberId: toughest.memberId });
  const topWeek = uniqueExtreme(standings, (row) => row.weeklyPoints, "max", (value) => value > 0);
  if (topWeek) facts.push({ id: `top:${topWeek.memberId}`, label: "Top Saturday", text: `${topWeek.ownerName} led the league this week with ${signed(topWeek.weeklyPoints)} points and now has ${topWeek.totalPoints} total at #${topWeek.position}.`, priority: 95, eventId: null, memberId: topWeek.memberId });
  const positive = uniqueExtreme(events, (event) => event.points, "max", (value) => value > 0);
  const negative = uniqueExtreme(events, (event) => event.points, "min", (value) => value < 0);
  for (const [event, priority] of [[positive, 80], [negative, 75]] as const) {
    if (!event) continue;
    const opponent = event.opponentName ? ` against ${event.opponentPregameRank ? `#${event.opponentPregameRank} ` : ""}${event.opponentName}` : "";
    const result = event.result && event.finalScore ? ` in a ${event.finalScore} ${event.result}` : "";
    facts.push({ id: `event:${event.id}`, label: "Impact Play", text: `${event.ownerName}'s ${event.teamName} recorded ${event.scoringReason} (${signed(event.points)})${opponent}${result}.`, priority, eventId: event.id, memberId: ownerByTeam.get(input.events.find((item) => item.id === event.id)?.team_id ?? "") ?? null });
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
