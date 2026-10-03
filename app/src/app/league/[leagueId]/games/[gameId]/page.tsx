import { notFound, redirect } from "next/navigation";

import GameRoom, { type GameRoomData, type GameRoomSide } from "@/components/league/GameRoom";
import { liveFreshnessLabel, livePresentation } from "@/lib/cfbd/livePresentation";
import { createClient } from "@/lib/supabase/server";
import { getDraftParticipants, getDraftPicks, getLeagueDraft } from "@/services/draftService";
import { formatGameParticipant, getLeagueGames, getLivePresentationData, type GameParticipant } from "@/services/gameService";
import { getLeagueRoster } from "@/services/membershipService";
import { getActiveTeams } from "@/services/teamService";

function kickoffLabel(startAt: string | null, gameDate: string) {
  const value = new Date(startAt ?? `${gameDate}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: startAt ? "numeric" : undefined, minute: startAt ? "2-digit" : undefined, timeZoneName: startAt ? "short" : undefined }).format(value);
}

export default async function GameRoomPage({ params }: { params: Promise<{ leagueId: string; gameId: string }> }) {
  const { leagueId, gameId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/league/${leagueId}/games/${gameId}`)}`);
  const { data: membership } = await supabase.from("league_members").select("id").eq("league_id", leagueId).eq("user_id", user.id).maybeSingle();
  if (!membership) notFound();

  const [games, draft, roster, teams] = await Promise.all([getLeagueGames(supabase, leagueId), getLeagueDraft(supabase, leagueId), getLeagueRoster(supabase, leagueId), getActiveTeams(supabase)]);
  const game = games.find((item) => item.id === gameId);
  if (!game) notFound();
  const participants = draft ? await getDraftParticipants(supabase, draft.id, roster.members) : [];
  const picks = draft ? await getDraftPicks(supabase, draft.id, participants, teams) : [];
  const ownerByTeam = new Map(picks.map((pick) => [pick.team_id, pick.participant?.member.team_name ?? pick.participant?.profile?.display_name ?? "Owner"]));
  const { data: lineupHeaders, error: lineupError } = await supabase.from("weekly_lineups").select("id").eq("league_id", leagueId).eq("season", game.season).eq("week", game.week);
  if (lineupError) throw lineupError;
  const { data: lineupEntries, error: entryError } = lineupHeaders.length
    ? await supabase.from("weekly_lineup_entries").select("team_id,status,is_captain").in("weekly_lineup_id", lineupHeaders.map((item) => item.id)).eq("game_id", game.id)
    : { data: [], error: null };
  if (entryError) throw entryError;
  const entryByTeam = new Map(lineupEntries.map((entry) => [entry.team_id, entry]));
  const liveData = await getLivePresentationData(supabase, [game]);
  const providerId = game.external_provider === "cfbd" ? game.external_id : null;
  const renderedAt = new Date();
  const nowMs = renderedAt.getTime();
  const live = providerId ? livePresentation(liveData.games.get(providerId) ?? null, liveData.snapshots.get(providerId) ?? [], nowMs) : null;
  const status = live?.status ?? game.status;

  const side = (participant: GameParticipant, teamId: string | null, score: number | null): GameRoomSide => {
    const entry = teamId ? entryByTeam.get(teamId) : undefined;
    return { teamId, teamName: formatGameParticipant(participant), team: participant.kind === "internal" ? participant.team : null,
      rank: teamId ? game.rankings.find((ranking) => ranking.team_id === teamId)?.rank ?? null : null, score,
      ownerName: teamId ? ownerByTeam.get(teamId) ?? null : null, lineupStatus: entry?.status ?? null, isCaptain: entry?.is_captain ?? false };
  };
  const detail: GameRoomData = {
    id: game.id, week: game.week, kickoff: kickoffLabel(game.start_at, game.game_date), status,
    liveContext: live?.status === "in_progress" ? [live.period ? `Q${live.period}` : null, live.clock].filter(Boolean).join(" · ") || null : null,
    freshness: live ? liveFreshnessLabel(live.fetchedAt, nowMs) : null,
    home: side(game.homeParticipant, game.home_team_id, live?.homeScore ?? game.home_score),
    away: side(game.awayParticipant, game.away_team_id, live?.awayScore ?? game.away_score),
  };
  return <GameRoom leagueId={leagueId} game={detail} />;
}
