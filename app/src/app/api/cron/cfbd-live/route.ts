import { configuredCronLeagueIds, isAuthorizedCronRequest } from "@/lib/cfbd/cron";
import { createCronClient } from "@/lib/supabase/cron";
import { pollLiveScoreboard } from "@/services/liveScoreboardService";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const leagueIds = configuredCronLeagueIds(process.env.CFBD_CRON_LEAGUE_IDS);
    const run = await pollLiveScoreboard(createCronClient(), leagueIds, "scheduled");
    return Response.json({ ok: true, polled: Boolean(run), runId: run?.id ?? null });
  } catch {
    return Response.json({ ok: false, error: "Live scoreboard polling could not run." }, { status: 503 });
  }
}
