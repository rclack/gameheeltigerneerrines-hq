import { safeTeamLogoUrl } from "@/lib/league/favorite-team-theme";

interface TeamLogoIdentity {
  school_name: string;
  abbreviation?: string | null;
  logo_url?: string | null;
}

function initials(team: TeamLogoIdentity) {
  if (team.abbreviation?.trim()) return team.abbreviation.trim().slice(0, 3).toUpperCase();
  return team.school_name.split(/\s+/).map((word) => word[0]).join("").slice(0, 3).toUpperCase();
}

export default function TeamLogo({ team, size = "md", decorative = false }: { team: TeamLogoIdentity; size?: "sm" | "md" | "lg" | "hero"; decorative?: boolean }) {
  const logoUrl = safeTeamLogoUrl(team.logo_url);
  const sizes = { sm: "h-8 w-8 text-[0.6rem]", md: "h-11 w-11 text-xs", lg: "h-14 w-14 text-sm", hero: "h-56 w-56 text-6xl sm:h-72 sm:w-72" };
  return (
    <span
      className={`${sizes[size]} inline-flex shrink-0 items-center justify-center bg-contain bg-center bg-no-repeat font-black tracking-tight`}
      style={logoUrl ? { backgroundImage: `url(${logoUrl})` } : undefined}
      aria-hidden={decorative || undefined}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : `${team.school_name} logo`}
    >
      {!logoUrl && initials(team)}
    </span>
  );
}
