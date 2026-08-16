import "server-only";

import OpenAI from "openai";

import type { RecapNarrative, VerifiedRecapPayload } from "./types";
import { validateRecapNarrative } from "./narrativeValidation";

export const SUNDAY_RECAP_MODEL = "gpt-5.4-mini";

const narrativeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["subjectHook", "opening", "stories", "closing"],
  properties: {
    subjectHook: { type: "string", minLength: 3, maxLength: 70 },
    opening: { type: "string", minLength: 10, maxLength: 240 },
    stories: { type: "array", minItems: 1, maxItems: 4, items: { type: "object", additionalProperties: false, required: ["factId", "reaction"], properties: { factId: { type: "string" }, reaction: { type: "string", minLength: 3, maxLength: 140 } } } },
    closing: { type: "string", minLength: 5, maxLength: 180 },
  },
} as const;


export async function generateRecapNarrative(payload: VerifiedRecapPayload): Promise<RecapNarrative> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Sunday Recap AI is not configured.");
  const client = new OpenAI({ apiKey, timeout: 20_000, maxRetries: 1 });
  const response = await client.responses.create({
    model: SUNDAY_RECAP_MODEL,
    store: false,
    max_output_tokens: 700,
    reasoning: { effort: "low" },
    instructions: "You write concise college-football pool color copy with light, good-natured group-chat energy. Select only supplied fact IDs. The application prints each fact verbatim. Your hook, opening, reactions, and closing must add atmosphere only: do not use names, teams, rankings, scores, points, standings positions, movement amounts, records, future matchups, or any digits. Never be personal, cruel, political, sexual, or discriminatory.",
    input: JSON.stringify({ league: { season: payload.league.season, week: payload.league.week }, verifiedFacts: payload.facts.map(({ id, label, text }) => ({ id, label, text })), nextWeekAvailable: payload.nextWeek !== null }),
    text: { format: { type: "json_schema", name: "sunday_recap_narrative", strict: true, schema: narrativeSchema } },
  });
  let parsed: unknown;
  try { parsed = JSON.parse(response.output_text); } catch { throw new Error("The AI response was not valid structured content."); }
  return validateRecapNarrative(payload, parsed);
}
