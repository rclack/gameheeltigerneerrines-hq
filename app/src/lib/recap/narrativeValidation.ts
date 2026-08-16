import type { RecapNarrative, VerifiedRecapPayload } from "./types.ts";

function isNarrative(value: unknown): value is RecapNarrative {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RecapNarrative>;
  return typeof item.subjectHook === "string" && typeof item.opening === "string" && typeof item.closing === "string"
    && Array.isArray(item.stories) && item.stories.length >= 1 && item.stories.length <= 4
    && item.stories.every((story) => story && typeof story.factId === "string" && typeof story.reaction === "string");
}

export function validateRecapNarrative(payload: VerifiedRecapPayload, value: unknown): RecapNarrative {
  if (!isNarrative(value)) throw new Error("The AI response did not match the recap format.");
  const factIds = new Set(payload.facts.map((fact) => fact.id));
  if (new Set(value.stories.map((story) => story.factId)).size !== value.stories.length || value.stories.some((story) => !factIds.has(story.factId))) {
    throw new Error("The AI response referenced an unverified recap fact.");
  }
  const authored = [value.subjectHook, value.opening, value.closing, ...value.stories.map((story) => story.reaction)];
  const entities = [payload.league.name, ...payload.standings.flatMap((row) => [row.ownerName, row.poolTeamName ?? ""]), ...payload.events.flatMap((event) => [event.teamName, event.opponentName ?? ""])].filter((item) => item.length >= 3);
  if (authored.some((text) => /\d/.test(text)) || authored.some((text) => entities.some((entity) => text.toLocaleLowerCase("en-US").includes(entity.toLocaleLowerCase("en-US"))))) {
    throw new Error("The AI response introduced factual details outside the verified fact cards.");
  }
  return value;
}
