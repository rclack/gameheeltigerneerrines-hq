import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchCfbdAccountInfo, fetchCfbdScoreboard } from "@/lib/cfbd/client";
import { canonicalizeScoreboardGame, sanitizedLivePollError } from "@/lib/cfbd/live";
import type { Database, Json } from "@/types/database";

export async function pollLiveScoreboard(
  supabase: SupabaseClient<Database>,
  leagueIds: string[],
  trigger: "manual" | "scheduled",
) {
  const begin = await supabase.rpc("begin_live_scoreboard_poll", { target_trigger: trigger, target_league_ids: leagueIds });
  if (begin.error) throw begin.error;
  if (!begin.data) return null;
  let providerCalls = 0;
  try {
    const info = await fetchCfbdAccountInfo();
    providerCalls += 1;
    if (!info.features.scoreboard) throw new Error("CFBD scoreboard entitlement is unavailable.");
    const scoreboard = await fetchCfbdScoreboard();
    providerCalls += 1;
    const complete = await supabase.rpc("complete_live_scoreboard_poll", {
      target_run_id: begin.data.id,
      target_lease_token: begin.data.lease_token,
      target_games: scoreboard.map(canonicalizeScoreboardGame) as unknown as Json,
      target_provider_calls: providerCalls,
      target_quota: {
        tier_name: info.tierName,
        monthly_limit: info.monthlyLimit,
        used: info.usedCalls,
        remaining: info.remainingCalls,
      },
    });
    if (complete.error) throw complete.error;
    return complete.data;
  } catch (error) {
    const safe = sanitizedLivePollError(error);
    await supabase.rpc("fail_live_scoreboard_poll", {
      target_run_id: begin.data.id,
      target_lease_token: begin.data.lease_token,
      target_provider_calls: providerCalls,
      target_error_category: safe.category,
      target_error_message: safe.message,
    });
    throw error;
  }
}

export async function getLiveScoreboardPollRuns(supabase: SupabaseClient<Database>, limit = 20) {
  const result = await supabase.from("live_scoreboard_poll_runs").select("*").order("started_at", { ascending: false }).limit(limit);
  if (result.error) throw result.error;
  return result.data;
}
