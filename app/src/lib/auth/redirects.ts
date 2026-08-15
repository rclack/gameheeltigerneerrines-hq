const UUID_SEGMENT = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const INVITATION_TOKEN_SEGMENT = "[0-9a-f]{64}";

const SAFE_RETURN_PATHS = [
  /^\/leagues$/,
  /^\/commissioner(?:\/scoring)?$/,
  new RegExp(`^/league/${UUID_SEGMENT}(?:/(?:score|standings))?$`, "i"),
  new RegExp(`^/draft/${UUID_SEGMENT}$`, "i"),
  new RegExp(`^/invite/${INVITATION_TOKEN_SEGMENT}$`, "i"),
];

export function safeAuthReturnPath(value: string | null | undefined, fallback = "/leagues") {
  if (!value || value.length > 256 || value.includes("\\") || value.includes("?") || value.includes("#")) {
    return fallback;
  }

  return SAFE_RETURN_PATHS.some((pattern) => pattern.test(value)) ? value : fallback;
}
