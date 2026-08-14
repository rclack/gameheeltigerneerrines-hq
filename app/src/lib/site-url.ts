import "server-only";

function validOrigin(value: string | undefined, defaultProtocol?: "https:") {
  if (!value) return null;
  const candidate = defaultProtocol && !value.includes("://") ? `${defaultProtocol}//${value}` : value;

  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getSiteOrigin() {
  return validOrigin(process.env.NEXT_PUBLIC_SITE_URL)
    ?? validOrigin(process.env.VERCEL_URL, "https:")
    ?? "http://localhost:3000";
}
