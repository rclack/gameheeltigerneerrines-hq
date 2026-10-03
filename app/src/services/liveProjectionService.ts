import type { SupabaseClient } from "@supabase/supabase-js";

import { LIVE_PROJECTABLE_RULE_CODES, type ProjectableRule, type TeamClassification } from "@/lib/projection/game-result";
import { buildLiveProjection, type LiveProjectionResult } from "@/lib/projection/live-projection";
import type { Database } from "@/types/database";

function requireData<T>(label: string, result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${label}: no data returned`);
  return result.data;
}

export async function getLiveProjection(
  supabase: SupabaseClient<Database>,
  leagueId: string,
  nowMs = Date.now(),
): Promise<LiveProjectionResult> {
  const [leagueResult, membersResult, draftResult, gamesResult, eventsResult, globalRulesResult] = await Promise.all([
    supabase.from("leagues").select("id,season").eq("id", leagueId).maybeSingle(),
    supabase.from("league_members").select("id,user_id,team_name").eq("league_id", leagueId).order("created_at"),
    supabase.from("drafts").select("id,status").eq("league_id", leagueId).eq("status", "complete").maybeSingle(),
    supabase.from("cfb_games").select("*").eq("league_id", leagueId).order("week").order("start_at"),
    supabase.from("scoring_events").select("league_member_id,team_id,points,created_at").eq("league_id", leagueId).is("voided_at", null).eq("counts_for_standings", true),
    supabase.from("scoring_rules").select("id,code,display_name,points").is("league_id", null).eq("active", true).in("code", [...LIVE_PROJECTABLE_RULE_CODES]),
  ]);
  const league = requireData("league", leagueResult);
  if (!league) throw new Error("League not found or access denied.");
  const members = requireData("league members", membersResult);
  const draft = requireData("completed draft", draftResult);
  const games = requireData("league games", gamesResult);
  const events = requireData("official scoring events", eventsResult);
  const globalRules = requireData("global scoring rules", globalRulesResult);

  const userIds = members.map((member) => member.user_id);
  const [profilesResult, picksResult, rankingsResult, lineupsResult, classificationsResult] = await Promise.all([
    userIds.length ? supabase.from("profiles").select("id,display_name").in("id", userIds) : Promise.resolve({ data: [], error: null }),
    draft ? supabase.from("draft_picks").select("id,league_member_id,team_id").eq("draft_id", draft.id).order("overall_pick") : Promise.resolve({ data: [], error: null }),
    supabase.from("team_ranking_snapshots").select("game_id,team_id,rank,captured_at").eq("league_id", leagueId).eq("season", league.season).not("game_id", "is", null),
    supabase.from("weekly_lineups").select("id,league_member_id,season,week").eq("league_id", leagueId).eq("season", league.season),
    supabase.from("conference_classifications").select("conference,classification").eq("season", league.season),
  ]);
  const profiles = requireData("profiles", profilesResult);
  const picks = requireData("draft picks", picksResult);
  const rankings = requireData("ranking snapshots", rankingsResult);
  const lineups = requireData("weekly lineups", lineupsResult);
  const classifications = requireData("conference classifications", classificationsResult);
  const teamIds = [...new Set(games.flatMap((game) => [game.home_team_id, game.away_team_id]).filter((id): id is string => Boolean(id)))];
  const externalIds = [...new Set(games.flatMap((game) => [game.home_external_opponent_id, game.away_external_opponent_id]).filter((id): id is string => Boolean(id)))];
  const providerIds = [...new Set(games.filter((game) => game.external_provider && game.external_id).map((game) => game.external_id!))];
  const lineupIds = lineups.map((lineup) => lineup.id);
  const [teamsResult, externalResult, entriesResult, liveResult] = await Promise.all([
    teamIds.length ? supabase.from("teams").select("id,school_name,conference").in("id", teamIds) : Promise.resolve({ data: [], error: null }),
    externalIds.length ? supabase.from("external_opponents").select("id,display_name").in("id", externalIds) : Promise.resolve({ data: [], error: null }),
    lineupIds.length ? supabase.from("weekly_lineup_entries").select("id,weekly_lineup_id,team_id,game_id,status,is_captain").in("weekly_lineup_id", lineupIds) : Promise.resolve({ data: [], error: null }),
    providerIds.length ? supabase.from("live_scoreboard_games").select("provider,provider_game_id,status,home_score,away_score,fetched_at").eq("provider", "cfbd").in("provider_game_id", providerIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const teams = requireData("teams", teamsResult);
  const externalOpponents = requireData("external opponents", externalResult);
  const entries = requireData("weekly lineup entries", entriesResult);
  const liveGames = requireData("canonical live games", liveResult);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile.display_name]));
  const classificationByConference = new Map(classifications.map((row) => [row.conference, row.classification]));
  const ruleByCode = new Map<string, ProjectableRule>();
  for (const rule of globalRules) ruleByCode.set(rule.code, { id: rule.id, code: rule.code, displayName: rule.display_name, points: rule.points });

  return buildLiveProjection({
    leagueId, season: league.season, nowMs,
    members: members.map((member) => ({ id: member.id, displayName: member.team_name ?? profileById.get(member.user_id) ?? "Owner" })),
    picks: picks.map((pick) => ({ memberId: pick.league_member_id, teamId: pick.team_id })),
    officialEvents: events.map((event) => ({ memberId: event.league_member_id, teamId: event.team_id, points: event.points, createdAt: event.created_at })),
    teams: teams.map((team) => {
      const classification = classificationByConference.get(team.conference);
      return { id: team.id, name: team.school_name, conference: team.conference,
        classification: (classification === "POWER" || classification === "G5" || classification === "INDEPENDENT" ? classification : null) as TeamClassification,
        classificationResolved: classification !== undefined };
    }),
    games: games.map((game) => ({ id: game.id, season: game.season, week: game.week, externalProvider: game.external_provider, externalId: game.external_id,
      status: game.status, scoringFingerprint: game.scoring_fingerprint, homeTeamId: game.home_team_id, awayTeamId: game.away_team_id,
      homeExternalOpponentId: game.home_external_opponent_id, awayExternalOpponentId: game.away_external_opponent_id, homeScore: game.home_score, awayScore: game.away_score })),
    liveGames: liveGames.map((game) => ({ provider: game.provider, providerGameId: game.provider_game_id, status: game.status,
      homeScore: game.home_score, awayScore: game.away_score, fetchedAt: game.fetched_at })),
    rankings: rankings.flatMap((row) => row.game_id ? [{ gameId: row.game_id, teamId: row.team_id, rank: row.rank, capturedAt: row.captured_at }] : []),
    lineups: lineups.map((lineup) => ({ id: lineup.id, memberId: lineup.league_member_id, season: lineup.season, week: lineup.week })),
    entries: entries.map((entry) => ({ id: entry.id, lineupId: entry.weekly_lineup_id, teamId: entry.team_id, gameId: entry.game_id,
      status: entry.status, isCaptain: entry.is_captain })),
    externalOpponents: externalOpponents.map((opponent) => ({ id: opponent.id, name: opponent.display_name })),
    rules: [...ruleByCode.values()],
  });
}
