import { configuredCronLeagueIds, isAuthorizedCronRequest, runScheduledSyncBatch } from "@/lib/cfbd/cron";
import { CfbdSyncError } from "@/lib/cfbd/diagnostics";
import { createCronClient } from "@/lib/supabase/cron";
import { syncScheduledCfbdSchedule } from "@/services/cfbdService";

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const leagueIds = configuredCronLeagueIds(process.env.CFBD_CRON_LEAGUE_IDS);
    const supabase = createCronClient();
    const { data: leagues, error } = await supabase.from("leagues").select("id,season").in("id", leagueIds);
    if (error || leagues.length !== leagueIds.length) {
      return Response.json({ ok: false, error: "Scheduled synchronization configuration is invalid." }, { status: 503 });
    }

    const outcome = await runScheduledSyncBatch(leagues, async (league) => {
      try {
        await syncScheduledCfbdSchedule(supabase, league.id, league.season);
        return "succeeded";
      } catch (error) {
        if (error instanceof CfbdSyncError && error.databaseError?.code === "55P03") return "skipped";
        throw error;
      }
    });

    return Response.json(
      { ok: outcome.failed === 0, ...outcome },
      { status: outcome.failed === 0 ? 200 : 500 },
    );
  } catch {
    return Response.json({ ok: false, error: "Scheduled synchronization could not run." }, { status: 503 });
  }
}
