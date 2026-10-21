import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildChaosObservation } from "@/lib/chaos/persistence";
import type { ChaosFeedItem, ChaosFeedResponse, FeedLifecycle, FeedSeverity } from "@/lib/chaos/presentation";
import { getLiveProjection } from "@/services/liveProjectionService";
import type { Database, Json } from "@/types/database";

export type ChaosTrigger = "live_poll" | "schedule_sync" | "freshness" | "manual_validation";

export async function reconcileLeagueChaos(supabase: SupabaseClient<Database>, leagueId: string, trigger: ChaosTrigger) {
  const projection = await getLiveProjection(supabase, leagueId);
  const settled = await supabase.from("cfb_games").select("id,scoring_fingerprint").eq("league_id", leagueId)
    .eq("status", "final").not("scoring_fingerprint", "is", null);
  if (settled.error) throw settled.error;
  const observation = buildChaosObservation(projection, settled.data);
  const result = await supabase.rpc("reconcile_league_chaos", {
    target_league_id: leagueId, target_observation_key: observation.observationKey,
    target_observed_at: observation.observedAt, target_trigger: trigger,
    target_authority_state: observation.authorityState, target_candidates: observation.candidates as unknown as Json,
    target_stale_game_ids: observation.staleGameIds, target_settled_game_ids: observation.settledGameIds,
  });
  if (result.error) throw result.error;
  const payload = result.data as { duplicate?: boolean } | null;
  if (payload?.duplicate === true) {
    const touched = await supabase.rpc("touch_duplicate_chaos_observation", {
      target_league_id: leagueId,
      target_observation_key: observation.observationKey,
      target_observed_at: observation.observedAt,
    });
    if (touched.error) throw touched.error;
  }
  return result.data;
}

export async function reconcileEnabledChaosLeagues(
  supabase: SupabaseClient<Database>, leagueIds: string[], trigger: ChaosTrigger, force = false,
) {
  const settings = await supabase.from("league_chaos_settings").select("league_id,last_success_at").eq("enabled", true).in("league_id", leagueIds);
  if (settings.error) {
    console.error("[chaos-reconciliation]", { trigger, error: "settings_read_failed" });
    return [{ leagueId: "configured-scope", status: "failed" as const, error: "settings_read_failed" }];
  }
  const now = Date.now();
  const outcomes: Array<{ leagueId: string; status: "succeeded" | "skipped" | "failed"; result?: Json; error?: string }> = [];
  for (const setting of settings.data) {
    const last = setting.last_success_at ? new Date(setting.last_success_at).getTime() : 0;
    if (!force && trigger === "freshness" && Number.isFinite(last) && now - last < 5 * 60_000) {
      outcomes.push({ leagueId: setting.league_id, status: "skipped" }); continue;
    }
    try {
      outcomes.push({ leagueId: setting.league_id, status: "succeeded",
        result: await reconcileLeagueChaos(supabase, setting.league_id, trigger) as Json });
    } catch (error) {
      console.error("[chaos-reconciliation]", { leagueId: setting.league_id, trigger,
        error: error instanceof Error ? error.message : "unknown_error" });
      await supabase.rpc("record_league_chaos_reconciliation_failure", {
        target_league_id: setting.league_id, target_trigger: trigger, target_error_category: "reconciliation_failed",
      }).then(({ error: telemetryError }) => {
        if (telemetryError) console.error("[chaos-reconciliation]", { leagueId: setting.league_id, trigger, error: "failure_telemetry_failed" });
      });
      outcomes.push({ leagueId: setting.league_id, status: "failed", error: "reconciliation_failed" });
    }
  }
  return outcomes;
}

export async function getLeagueChaosHistory(supabase: SupabaseClient<Database>, leagueId: string, cursor?: string, limit = 50) {
  const bounded = Math.max(1, Math.min(limit, 100));
  let query = supabase.from("league_chaos_transitions").select("*").eq("league_id", leagueId)
    .order("observed_at", { ascending: false }).order("id", { ascending: false }).limit(bounded + 1);
  if (cursor) query = query.lt("observed_at", cursor);
  const [transitions, active] = await Promise.all([
    query,
    supabase.from("league_chaos_events").select("*").eq("league_id", leagueId).in("lifecycle_state", ["active", "suspended"])
      .order("severity", { ascending: false }).order("last_changed_at", { ascending: false }),
  ]);
  if (transitions.error) throw transitions.error;
  if (active.error) throw active.error;
  const transitionRows = transitions.data.slice(0, bounded);
  const memberIds = [...new Set([...active.data, ...transitionRows].map((item) => item.league_member_id).filter((id): id is string => Boolean(id)))];
  const teamIds = [...new Set([...active.data, ...transitionRows].map((item) => item.team_id).filter((id): id is string => Boolean(id)))];
  const [members, teams] = await Promise.all([
    memberIds.length ? supabase.from("league_members").select("id,user_id").eq("league_id", leagueId).in("id", memberIds) : Promise.resolve({ data: [], error: null }),
    teamIds.length ? supabase.from("teams").select("id,school_name").in("id", teamIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (members.error) throw members.error;
  if (teams.error) throw teams.error;
  const profiles = members.data.length
    ? await supabase.from("profiles").select("id,display_name").in("id", members.data.map((member) => member.user_id))
    : { data: [], error: null };
  if (profiles.error) throw profiles.error;
  const profileByUser = new Map(profiles.data.map((profile) => [profile.id, profile.display_name]));
  const ownerByMember = new Map(members.data.map((member) => [member.id, profileByUser.get(member.user_id) ?? "Owner"]));
  const teamById = new Map(teams.data.map((team) => [team.id, team.school_name]));
  const base = (row: typeof active.data[number]) => ({
    episodeId: row.episode_id, eventKey: row.event_key, eventType: row.event_type,
    severity: row.severity as FeedSeverity, observedAt: row.last_changed_at, week: row.week,
    gameId: row.game_id, teamId: row.team_id, memberId: row.league_member_id,
    ownerName: row.league_member_id ? ownerByMember.get(row.league_member_id) ?? null : null,
    teamName: row.team_id ? teamById.get(row.team_id) ?? null : null,
    facts: row.facts, reasonCodes: row.reason_codes,
  });
  const activeItems: ChaosFeedItem[] = active.data.map((row) => ({
    id: row.event_key, ...base(row), lifecycle: row.lifecycle_state, transitionType: null,
    resolutionReason: row.resolution_reason,
  }));
  const transitionItems: ChaosFeedItem[] = transitionRows.map((row) => ({
    id: row.id, episodeId: row.episode_id, eventKey: row.event_key, eventType: row.event_type,
    severity: row.new_severity as FeedSeverity, lifecycle: row.new_lifecycle_state as FeedLifecycle,
    transitionType: row.transition_type, resolutionReason: row.resolution_reason, observedAt: row.observed_at,
    week: row.week, gameId: row.game_id, teamId: row.team_id, memberId: row.league_member_id,
    ownerName: row.league_member_id ? ownerByMember.get(row.league_member_id) ?? null : null,
    teamName: row.team_id ? teamById.get(row.team_id) ?? null : null,
    facts: row.facts, reasonCodes: row.reason_codes,
  }));
  return { active: activeItems, transitions: transitionItems,
    nextCursor: transitions.data.length > bounded ? transitions.data[bounded - 1]?.observed_at ?? null : null } satisfies ChaosFeedResponse;
}
