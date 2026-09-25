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
    case "Biggest Mover": return "That move reshaped the league table.";
    case "Toughest Saturday": return "The official ledger made it a difficult week.";
    case "Top Saturday": return "That was the strongest official scoring week in the pool.";
    case "Impact Play": return "That result made a verified difference in the official scoring ledger.";
    case "Bench Watch": return "Those points remained potential points and did not affect the official standings.";
    default: return "The certified weekly ledger tells the story.";
  }
}

export function renderDeterministicRecapNarrative(payload: VerifiedRecapPayload): RecapNarrative {
  const bestWeekly = Math.max(...payload.standings.map((row) => row.weeklyPoints), 0);
  const weeklyLeaders = payload.standings.filter((row) => row.weeklyPoints === bestWeekly);
  const leaderNames = joinNames(weeklyLeaders.map((row) => row.poolTeamName ?? row.ownerName));
  const opening = bestWeekly > 0
    ? `${leaderNames} ${weeklyLeaders.length === 1 ? "set" : "shared"} the Week ${payload.league.week} pace at ${signed(bestWeekly)}. Every total below comes directly from the certified scoring ledger.`
    : `Week ${payload.league.week} produced no positive official scoring movement. Every total below comes directly from the certified scoring ledger.`;
  const stories = payload.facts.slice(0, 4).map((fact) => ({ factId: fact.id, reaction: reactionFor(fact) }));
  const next = payload.nextWeek === null ? "The completed standings are below." : `Week ${payload.nextWeek} is next.`;
  return { subjectHook: `Week ${payload.league.week} official results`, opening, stories, closing: `${next} Lineup and Captain decisions remain part of the authoritative weekly record.` };
}
