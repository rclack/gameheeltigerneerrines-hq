import type { Json } from "@/types/database";

export interface RecapStanding {
  memberId: string;
  ownerName: string;
  poolTeamName: string | null;
  position: number;
  previousPosition: number | null;
  movement: number | null;
  totalPoints: number;
  weeklyPoints: number;
}

export interface RecapEvent {
  id: string;
  ownerName: string;
  teamName: string;
  opponentName: string | null;
  finalScore: string | null;
  result: "win" | "loss" | null;
  scoringReason: string;
  basePoints: number;
  scoringMultiplier: 1 | 2;
  captainApplied: boolean;
  points: number;
  opponentPregameRank: number | null;
  rankingSource: string | null;
}

export interface RecapFact {
  id: string;
  label: "Biggest Mover" | "Toughest Saturday" | "Top Saturday" | "Impact Play" | "Week in Review";
  text: string;
  priority: number;
  eventId: string | null;
  memberId: string | null;
}

export interface VerifiedRecapPayload {
  version: 1;
  league: { id: string; name: string; season: string; week: number };
  standings: RecapStanding[];
  events: RecapEvent[];
  facts: RecapFact[];
  nextWeek: number | null;
}

export interface RecapNarrative {
  subjectHook: string;
  opening: string;
  stories: Array<{ factId: string; reaction: string }>;
  closing: string;
}

export function asJson(value: VerifiedRecapPayload | RecapNarrative): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}
