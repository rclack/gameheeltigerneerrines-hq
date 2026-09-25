import { renderDeterministicRecapNarrative } from "./fallbackNarrative.ts";
import { recapGenerationFailureMessage } from "./generationFailure.ts";
import { SUNDAY_RECAP_FALLBACK_MODEL, SUNDAY_RECAP_MODEL } from "./models.ts";
import type { RecapNarrative, VerifiedRecapPayload } from "./types.ts";

export interface RecapNarrativeResult { narrative: RecapNarrative; model: string; aiFailure: string | null; }

export async function generateNarrativeWithFallback(payload: VerifiedRecapPayload, generate: (payload: VerifiedRecapPayload) => Promise<RecapNarrative>): Promise<RecapNarrativeResult> {
  try {
    return { narrative: await generate(payload), model: SUNDAY_RECAP_MODEL, aiFailure: null };
  } catch (error) {
    return { narrative: renderDeterministicRecapNarrative(payload), model: SUNDAY_RECAP_FALLBACK_MODEL, aiFailure: recapGenerationFailureMessage(error) };
  }
}
