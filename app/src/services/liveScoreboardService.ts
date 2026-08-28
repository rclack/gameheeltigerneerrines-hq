import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchCfbdAccountInfo, fetchCfbdScoreboard } from "@/lib/cfbd/client";
import { canonicalizeScoreboardGame, liveQuotaSampleDue, sanitizedLivePollError } from "@/lib/cfbd/live";
import { activeLivePollRun } from "@/lib/cfbd/livePollRun";
import type { Database, Json } from "@/types/database";

export async function pollLiveScoreboard(
  supabase: SupabaseClient<Database>,
  leagueIds: string[],
  trigger: "manual" | "scheduled",
) {
  const begin = await supabase.rpc("begin_live_scoreboard_poll", { target_trigger: trigger, target_league_ids: leagueIds });
  if (begin.error) throw begin.error;
  const run = activeLivePollRun(begin.data);
  if (!run) return null;
  let providerCalls = 0;
  let scoreboardCalls = 0;
  let infoCalls = 0;
  let quota = {
    tier_name: run.quota_tier,
    monthly_limit: run.quota_monthly_limit,
    used: run.quota_used,
    remaining: run.quota_remaining,
  };
  let sampledQuota = false;
  try {
    if (trigger === "manual" || liveQuotaSampleDue(run)) {
      infoCalls += 1;
      providerCalls += 1;
      const info = await fetchCfbdAccountInfo();
      sampledQuota = true;
      if (!info.features.scoreboard) throw new Error("CFBD scoreboard entitlement is unavailable.");
      quota = { tier_name: info.tierName, monthly_limit: info.monthlyLimit, used: info.usedCalls, remaining: info.remainingCalls };
      const recorded = await supabase.rpc("record_live_scoreboard_quota_sample", { target_quota: quota });
      if (recorded.error) throw recorded.error;
    }
    scoreboardCalls += 1;
    providerCalls += 1;
    const scoreboard = await fetchCfbdScoreboard();
    const breakdown = await supabase.rpc("record_live_scoreboard_call_breakdown", {
      target_run_id: run.id,
      target_lease_token: run.lease_token,
      target_scoreboard_calls: scoreboardCalls,
      target_info_calls: infoCalls,
    });
    if (breakdown.error || !breakdown.data) throw breakdown.error ?? new Error("Live scoreboard call accounting failed.");
    const complete = await supabase.rpc("complete_live_scoreboard_poll", {
      target_run_id: run.id,
      target_lease_token: run.lease_token,
      target_games: scoreboard.map(canonicalizeScoreboardGame) as unknown as Json,
      target_provider_calls: providerCalls,
      target_quota: quota,
    });
    if (complete.error) throw complete.error;
    return complete.data;
  } catch (error) {
    if (!sampledQuota) {
      try {
        infoCalls += 1;
        providerCalls += 1;
        const info = await fetchCfbdAccountInfo();
        quota = { tier_name: info.tierName, monthly_limit: info.monthlyLimit, used: info.usedCalls, remaining: info.remainingCalls };
        await supabase.rpc("record_live_scoreboard_quota_sample", { target_quota: quota });
      } catch { /* Preserve the original provider error; this refresh is best effort. */ }
    }
    await supabase.rpc("record_live_scoreboard_call_breakdown", {
      target_run_id: run.id,
      target_lease_token: run.lease_token,
      target_scoreboard_calls: scoreboardCalls,
      target_info_calls: infoCalls,
    });
    const safe = sanitizedLivePollError(error);
    await supabase.rpc("fail_live_scoreboard_poll", {
      target_run_id: run.id,
      target_lease_token: run.lease_token,
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
