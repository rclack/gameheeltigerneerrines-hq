import type { Team } from "@/types/database";

export interface FavoriteTeamTheme {
  primary: string;
  secondary: string;
  foreground: "#FFFFFF" | "#0F172A";
  secondaryForeground: "#FFFFFF" | "#0F172A";
  heroAccent: string;
  primaryText: string;
  primaryDark: string;
  logoUrl: string | null;
}

const DEFAULT_PRIMARY = "#172554";
const DEFAULT_SECONDARY = "#F97316";

export function validHexColor(value: string | null | undefined, fallback: string) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
}

function rgb(hex: string) {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

function luminance(hex: string) {
  const values = rgb(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
}

export function contrastRatio(first: string, second: string) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

export function readableForeground(background: string): "#FFFFFF" | "#0F172A" {
  return contrastRatio(background, "#FFFFFF") >= contrastRatio(background, "#0F172A") ? "#FFFFFF" : "#0F172A";
}

function darken(hex: string, amount = 0.34) {
  const values = rgb(hex).map((value) => Math.round(value * (1 - amount)));
  return `#${values.map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function safeTeamLogoUrl(url: string | null | undefined) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ["a.espncdn.com", "a1.espncdn.com"].includes(parsed.hostname) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function favoriteTeamTheme(team: Team | null): FavoriteTeamTheme {
  const primary = validHexColor(team?.primary_color, DEFAULT_PRIMARY);
  const secondary = validHexColor(team?.secondary_color, DEFAULT_SECONDARY);
  return {
    primary,
    secondary,
    foreground: readableForeground(primary),
    secondaryForeground: readableForeground(secondary),
    heroAccent: contrastRatio(primary, secondary) >= 3 ? secondary : readableForeground(primary),
    primaryText: contrastRatio(primary, "#FFFFFF") >= 4.5 ? primary : "#0F172A",
    primaryDark: darken(primary),
    logoUrl: safeTeamLogoUrl(team?.logo_url),
  };
}
