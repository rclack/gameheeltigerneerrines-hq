interface ProviderFailure {
  status?: number;
  code?: string | null;
}

export function recapGenerationFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("The AI response")) {
    return "AI narrative validation failed.";
  }
  const provider = error && typeof error === "object" ? error as ProviderFailure : {};
  if (provider.status === 401 || provider.status === 403) return "AI provider authentication failed.";
  if (provider.status === 404 || provider.code === "model_not_found") return "AI narrative model is unavailable.";
  if (provider.status === 429) return "AI provider quota or rate limit prevented generation.";
  if (provider.status && provider.status >= 500) return "AI provider was temporarily unavailable.";
  return "AI narrative generation failed.";
}
