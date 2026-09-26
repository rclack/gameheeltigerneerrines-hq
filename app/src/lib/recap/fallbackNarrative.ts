import type { RecapFact, RecapNarrative, VerifiedRecapPayload } from "./types.ts";

export { SUNDAY_RECAP_FALLBACK_MODEL } from "./models.ts";

function signed(value: number) { return `${value > 0 ? "+" : ""}${value}`; }
function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "The league";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}
function reactionFor(fact: RecapFact) {
  switch (fact.label) {
    case "Biggest Mover": return "That jump tightened up the race.";
    case "Biggest Swing": return "One scoring swing can move the table fast.";
    case "Week Leader": return "That was the week's top score.";
    case "Captain Watch": return "The Captain call made every point count twice.";
    case "Game Impact": return "That game made a real difference this week.";
    case "Bench Pain": return "Those points stayed on the bench and did not count.";
    default: return "On to the next slate.";
  }
}

export function renderDeterministicRecapNarrative(payload: VerifiedRecapPayload): RecapNarrative {
  const bestWeekly = Math.max(...payload.standings.map((row) => row.weeklyPoints), 0);
  const weeklyLeaders = payload.standings.filter((row) => row.weeklyPoints === bestWeekly);
  const leaderNames = joinNames(weeklyLeaders.map((row) => row.poolTeamName ?? row.ownerName));
  const opening = bestWeekly > 0
    ? `${leaderNames} ${weeklyLeaders.length === 1 ? "set" : "shared"} the Week ${payload.league.week} pace at ${signed(bestWeekly)}.`
    : `Week ${payload.league.week} kept the scoring tight, with no one finishing above zero.`;
  const stories = payload.facts.slice(0, 4).map((fact) => ({ factId: fact.id, reaction: reactionFor(fact) }));
  const closing = payload.nextWeek === null ? "That's the table after the completed slate." : `Week ${payload.nextWeek} is next. Set the lineup and Captain before kickoff.`;
  return { subjectHook: "Recap", opening, stories, closing };
}
