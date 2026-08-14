export type CfbdHttpErrorCode = "authentication_failed" | "rate_limited" | "provider_error";

export function classifyCfbdHttpStatus(status: number): CfbdHttpErrorCode | null {
  if (status === 401 || status === 403) return "authentication_failed";
  if (status === 429) return "rate_limited";
  if (status < 200 || status >= 300) return "provider_error";
  return null;
}
