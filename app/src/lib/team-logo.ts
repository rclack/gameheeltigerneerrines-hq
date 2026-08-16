const CFBD_LOGO_ORIGIN = "https://collegefootballdata.com";
const CFBD_LOGO_PATH = /^\/api\/logos\/[1-9][0-9]*\/[1-9][0-9]*\.png$/;
const ESPN_LOGO_HOSTS = new Set(["a.espncdn.com", "a1.espncdn.com"]);

export function trustedTeamLogoUrl(value: string | null | undefined) {
  if (!value || value !== value.trim()) return null;

  try {
    const parsed = value.startsWith("/")
      ? new URL(value, CFBD_LOGO_ORIGIN)
      : new URL(value);

    if (
      parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
      || parsed.port
      || parsed.search
      || parsed.hash
    ) return null;

    if (parsed.hostname === "collegefootballdata.com") {
      return CFBD_LOGO_PATH.test(parsed.pathname) ? parsed.toString() : null;
    }

    return ESPN_LOGO_HOSTS.has(parsed.hostname) && parsed.pathname.length > 1
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}
