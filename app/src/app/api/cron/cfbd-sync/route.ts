import { configuredCronLeagueIds, isAuthorizedCronRequest, runScheduledSyncBatch } from "@/lib/cfbd/cron";
import { CfbdSyncError } from "@/lib/cfbd/diagnostics";
import { createCronClient } from "@/lib/supabase/cron";
import { syncScheduledCfbdSchedule } from "@/services/cfbdService";
import { automatedScoringEnabled, runAutomatedScoringSweep, type AutomatedScoringSweepResult } from "@/lib/cfbd/automatedScoring";
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

    const scoringEnabled = automatedScoringEnabled(process.env.CFBD_AUTOMATED_SCORING_ENABLED);
    const scoringSweeps: AutomatedScoringSweepResult[] = [];
    const outcome = await runScheduledSyncBatch(leagues, async (league) => {
      try {
        const syncRun = await syncScheduledCfbdSchedule(supabase, league.id, league.season);
        if (scoringEnabled) scoringSweeps.push(await runAutomatedScoringSweep(supabase, league.id, league.season, syncRun.id));
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
        if (week === null) return "skipped";
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

    const scoring = {
      enabled: scoringEnabled,
      finalGamesExamined: scoringSweeps.reduce((total, sweep) => total + sweep.finalGamesExamined, 0),
      alreadyCurrent: scoringSweeps.reduce((total, sweep) => total + sweep.alreadyCurrent, 0),
      newlyScored: scoringSweeps.reduce((total, sweep) => total + sweep.newlyScored, 0),
      reprocessed: scoringSweeps.reduce((total, sweep) => total + sweep.reprocessed, 0),
      failed: scoringSweeps.reduce((total, sweep) => total + sweep.failed, 0),
      failures: scoringSweeps.flatMap((sweep) => sweep.failures.map((failure) => ({ leagueId: sweep.leagueId, gameId: failure.gameId, category: failure.category }))),
    };
    const ok = outcome.failed === 0 && scoring.failed === 0 && recaps.failed === 0;
    return Response.json({ ok, ...outcome, scoring, recaps }, { status: ok ? 200 : 500 });
  } catch {
    return Response.json({ ok: false, error: "Scheduled synchronization could not run." }, { status: 503 });
  }
}
