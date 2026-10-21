import { configuredCronLeagueIds, isAuthorizedCronRequest } from "@/lib/cfbd/cron";
import { createCronClient } from "@/lib/supabase/cron";
import { pollLiveScoreboard } from "@/services/liveScoreboardService";
import { reconcileEnabledChaosLeagues } from "@/services/chaosService";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const leagueIds = configuredCronLeagueIds(process.env.CFBD_CRON_LEAGUE_IDS);
    const supabase = createCronClient();
    const run = await pollLiveScoreboard(supabase, leagueIds, "scheduled");
    const chaos = await reconcileEnabledChaosLeagues(supabase, leagueIds, run ? "live_poll" : "freshness", Boolean(run));
    return Response.json({ ok: true, polled: Boolean(run), runId: run?.id ?? null, chaos });
  } catch {
    return Response.json({ ok: false, error: "Live scoreboard polling could not run." }, { status: 503 });
  }
}
