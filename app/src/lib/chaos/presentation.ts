import type { Json } from "@/types/database";

export type FeedSeverity = "info" | "notable" | "major" | "chaos";
export type FeedLifecycle = "active" | "suspended" | "resolved";

export interface ChaosFeedItem {
  id: string;
  episodeId: string;
  eventKey: string;
  eventType: string;
  severity: FeedSeverity;
  lifecycle: FeedLifecycle;
  transitionType: string | null;
  resolutionReason: string | null;
  observedAt: string;
  week: number;
  gameId: string | null;
  teamId: string | null;
  memberId: string | null;
  ownerName: string | null;
  teamName: string | null;
  facts: Json;
  reasonCodes: string[];
}

export interface ChaosFeedResponse {
  active: ChaosFeedItem[];
  transitions: ChaosFeedItem[];
  nextCursor: string | null;
}

export const CHAOS_LABELS: Record<string, string> = {
  CAPTAIN_POSITIVE: "Captain Hero",
  CAPTAIN_NEGATIVE: "Captain Disaster",
  BENCH_POSITIVE: "Bench Pain",
  PROJECTED_LEAD_CHANGE: "Projected Lead Change",
  PROJECTED_RANK_MOVE: "Standings Shakeup",
  UPSET_DANGER: "Upset Alert",
  G5_POWER_SWING: "G5 Chaos",
  MAJOR_SCORING_SWING: "Big Points Swing",
};

const PRIORITY: Record<string, number> = {
  CAPTAIN_POSITIVE: 400,
  CAPTAIN_NEGATIVE: 400,
  G5_POWER_SWING: 350,
  PROJECTED_LEAD_CHANGE: 300,
  BENCH_POSITIVE: 260,
  UPSET_DANGER: 240,
  PROJECTED_RANK_MOVE: 200,
  MAJOR_SCORING_SWING: 100,
};

function objectFacts(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function factNumber(item: ChaosFeedItem, key: string) {
  const value = objectFacts(item.facts)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function factString(item: ChaosFeedItem, key: string) {
  const value = objectFacts(item.facts)[key];
  return typeof value === "string" ? value : null;
}

export function signedPoints(points: number | null) {
  if (points === null) return null;
  return `${points > 0 ? "+" : ""}${points}`;
}

export function chaosStatus(item: ChaosFeedItem) {
  if (item.lifecycle === "suspended") return "Live authority unavailable";
  if (item.lifecycle === "resolved") return item.resolutionReason === "OFFICIAL_SETTLED" ? "Officially settled" : "Resolved";
  if (factString(item, "gameState") === "final_pending") return "Final · scoring pending";
  return "Live · provisional";
}

export function chaosCopy(item: ChaosFeedItem) {
  const owner = item.ownerName ?? "An owner";
  const team = item.teamName ?? "their team";
  const points = factNumber(item, "gameProjectedPoints");
  const pointsText = signedPoints(points);
  const projectedRank = factNumber(item, "projectedRank");
  const rankMovement = factNumber(item, "rankMovement");
  const historical = item.lifecycle === "resolved";
  const suffix = historical ? " This moment is no longer active." : "";
  const pointsImpact = pointsText
    ? historical ? `At the time: ${pointsText} provisional points.`
      : factString(item, "gameState") === "final_pending" ? `Final projection: ${pointsText}; official scoring is pending.`
      : `If the score holds: ${pointsText} provisional points.`
    : null;

  switch (item.eventType) {
    case "CAPTAIN_POSITIVE":
      return { headline: `${owner}'s ${team} Captain is delivering.`, impact: (pointsImpact ?? "Captain points are swinging the league.") + suffix };
    case "CAPTAIN_NEGATIVE":
      return { headline: `${owner}'s ${team} Captain is in trouble.`, impact: (pointsImpact ?? "The Captain multiplier cuts both ways.") + suffix };
    case "BENCH_POSITIVE":
      return { headline: `${owner} has ${team} producing on the bench.`, impact: (pointsText ? `${pointsText} potential points are not counting.` : "Those bench points do not count.") + suffix };
    case "PROJECTED_LEAD_CHANGE":
      return { headline: `${owner} is moving into the projected league lead.`, impact: projectedRank ? `Projected place: #${projectedRank}. Official standings have not changed yet.` : "The projected lead is provisional." + suffix };
    case "PROJECTED_RANK_MOVE":
      return { headline: `${owner} is shaking up the projected standings.`, impact: rankMovement ? `${Math.abs(rankMovement)} place${Math.abs(rankMovement) === 1 ? "" : "s"} ${rankMovement > 0 ? "up" : "down"}, provisionally.` : "Projected standings are moving." + suffix };
    case "UPSET_DANGER":
      return { headline: `${owner}'s ${team} is on upset watch.`, impact: "The live score threatens a ranked result. Official scoring is unchanged." + suffix };
    case "G5_POWER_SWING":
      return { headline: `${team} has a G5/Power swing in play for ${owner}.`, impact: (pointsImpact ?? "Conference-based scoring is in play.") + suffix };
    default:
      return { headline: `${team} is creating a big points swing for ${owner}.`, impact: (pointsImpact ?? "The projected impact is provisional.") + suffix };
  }
}

function sameMomentKey(item: ChaosFeedItem) {
  return [item.gameId ?? "standings", item.memberId ?? "league", item.observedAt].join(":");
}

function suppressRelated(items: ChaosFeedItem[]) {
  const groups = new Map<string, ChaosFeedItem[]>();
  for (const item of items) {
    const key = sameMomentKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].flatMap((group) => {
    const types = new Set(group.map((item) => item.eventType));
    return group.filter((item) => {
      if (item.eventType === "MAJOR_SCORING_SWING" && [...types].some((type) => type.startsWith("CAPTAIN_") || type === "G5_POWER_SWING" || type === "BENCH_POSITIVE")) return false;
      if (item.eventType === "PROJECTED_RANK_MOVE" && types.has("PROJECTED_LEAD_CHANGE")) return false;
      if (item.eventType === "G5_POWER_SWING" && [...types].some((type) => type.startsWith("CAPTAIN_"))) return false;
      return true;
    });
  });
}

export function buildChaosFeed(response: ChaosFeedResponse, includeInfo = false) {
  const visible = (item: ChaosFeedItem) => includeInfo || item.severity !== "info";
  const active = suppressRelated(response.active.filter(visible))
    .sort((a, b) => (PRIORITY[b.eventType] ?? 0) - (PRIORITY[a.eventType] ?? 0) || Date.parse(b.observedAt) - Date.parse(a.observedAt));
  const activeEpisodes = new Set(response.active.map((item) => item.episodeId));
  const latestByEpisode = new Map<string, ChaosFeedItem>();
  for (const item of response.transitions.filter(visible)) {
    if (activeEpisodes.has(item.episodeId)) continue;
    if (!latestByEpisode.has(item.episodeId)) latestByEpisode.set(item.episodeId, item);
  }
  const recent = suppressRelated([...latestByEpisode.values()])
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
  return { active, recent };
}

export function chaosObservedLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(value)) + " ET";
}
