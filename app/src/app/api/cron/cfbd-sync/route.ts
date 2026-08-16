import { configuredCronLeagueIds, isAuthorizedCronRequest, runScheduledSyncBatch } from "@/lib/cfbd/cron";
import { CfbdSyncError } from "@/lib/cfbd/diagnostics";
import { createCronClient } from "@/lib/supabase/cron";
import { syncScheduledCfbdSchedule } from "@/services/cfbdService";
import { runScheduledRecapBatch } from "@/lib/recap/cron";
import { isSundayInEastern, latestRecapWeek, prepareSundayRecap, RecapNotReadyError, sendPreparedSundayRecap } from "@/services/recapService";

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

    let recaps = { succeeded: 0, skipped: 0, failed: 0 };
    if (isSundayInEastern(new Date())) {
      const settings = await supabase.from("league_recap_settings").select("league_id").eq("enabled", true);
      if (settings.error) throw settings.error;
      const recapLeagues = settings.data.length ? await supabase.from("leagues").select("*").in("id", settings.data.map((item) => item.league_id)) : { data: [], error: null };
      if (recapLeagues.error) throw recapLeagues.error;
      recaps = await runScheduledRecapBatch(recapLeagues.data, async (league) => {
        const week = await latestRecapWeek(supabase, league);
        if (!week) return "skipped";
        try {
          const recap = await prepareSundayRecap(supabase, league, week, null);
          const delivery = await sendPreparedSundayRecap(supabase, recap);
          return delivery.failed ? "skipped" : "succeeded";
        } catch (error) {
          if (error instanceof RecapNotReadyError) return "skipped";
          throw error;
        }
      });
    }

    const ok = outcome.failed === 0 && recaps.failed === 0;
    return Response.json({ ok, ...outcome, recaps }, { status: ok ? 200 : 500 });
  } catch {
    return Response.json({ ok: false, error: "Scheduled synchronization could not run." }, { status: 503 });
  }
}
