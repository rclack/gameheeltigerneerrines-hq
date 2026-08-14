import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, ScoringEvent, ScoringRule, Team } from "@/types/database";

export type ScoringEventDetail = ScoringEvent & { rule: ScoringRule; team: Team };

export interface ScoringEventFilters {
  teamId?: string;
  week?: number;
  includeVoided?: boolean;
}

export async function getDraftedScoringTeams(
  supabase: SupabaseClient<Database>,
  draftId: string,
  teams: Team[],
) {
  const { data: picks, error } = await supabase
    .from("draft_picks")
    .select("*")
    .eq("draft_id", draftId)
    .order("overall_pick");
  if (error) throw error;
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  return picks.flatMap((pick) => {
    const team = teamsById.get(pick.team_id);
    return team ? [{ pick, team }] : [];
  });
}

export async function getScoringRules(supabase: SupabaseClient<Database>, leagueId?: string) {
  let query = supabase.from("scoring_rules").select("*").eq("active", true).order("category").order("display_name");
  if (leagueId) query = query.or(`league_id.is.null,league_id.eq.${leagueId}`);
  else query = query.is("league_id", null);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getLeagueScoringEvents(
  supabase: SupabaseClient<Database>,
  leagueId: string,
  filters: ScoringEventFilters = {},
): Promise<ScoringEventDetail[]> {
  let query = supabase.from("scoring_events").select("*").eq("league_id", leagueId).order("created_at", { ascending: false });
  if (!filters.includeVoided) query = query.is("voided_at", null);
  if (filters.teamId) query = query.eq("team_id", filters.teamId);
  if (filters.week) query = query.eq("week", filters.week);
  const { data: events, error } = await query;
  if (error) throw error;
  if (!events.length) return [];

  const [rulesResult, teamsResult] = await Promise.all([
    supabase.from("scoring_rules").select("*").in("id", [...new Set(events.map((event) => event.scoring_rule_id))]),
    supabase.from("teams").select("*").in("id", [...new Set(events.map((event) => event.team_id))]),
  ]);
  if (rulesResult.error) throw rulesResult.error;
  if (teamsResult.error) throw teamsResult.error;
  const rules = new Map(rulesResult.data.map((rule) => [rule.id, rule]));
  const teams = new Map(teamsResult.data.map((team) => [team.id, team]));
  return events.flatMap((event) => {
    const rule = rules.get(event.scoring_rule_id);
    const team = teams.get(event.team_id);
    return rule && team ? [{ ...event, rule, team }] : [];
  });
}

export async function addManualScoringEvent(
  supabase: SupabaseClient<Database>,
  input: { leagueId: string; teamId: string; ruleId: string; week: number | null; eventDate: string | null; notes: string | null },
) {
  const { data, error } = await supabase.rpc("add_manual_scoring_event", {
    target_league_id: input.leagueId,
    target_team_id: input.teamId,
    target_rule_id: input.ruleId,
    target_week: input.week,
    target_event_date: input.eventDate,
    target_notes: input.notes,
  });
  if (error) throw error;
  return data;
}

export async function voidManualScoringEvent(supabase: SupabaseClient<Database>, eventId: string, reason: string) {
  const { data, error } = await supabase.rpc("void_manual_scoring_event", { target_event_id: eventId, target_reason: reason });
  if (error) throw error;
  return data;
}
