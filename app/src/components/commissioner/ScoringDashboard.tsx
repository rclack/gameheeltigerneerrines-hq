"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { addManualEventAction, saveGameAction, scoreEligibleFinalsAction, scoreGameAction, syncCfbdScheduleAction, testCfbdConnectionAction, voidManualEventAction, type BulkScoringActionState } from "@/app/commissioner/scoring/actions";
import Button from "@/components/ui/Button";
import SundayRecapControl from "@/components/commissioner/SundayRecapControl";
import { bulkScoringPlan, canProcessScoring, defaultGameView, gameAttentionCounts, hasGameRankingContext, visibleGames, type GameView } from "@/lib/cfbd/scoringDashboard";
import { getGameScoringState } from "@/lib/cfbd/scoringState";
import { syncRunFailureDetail } from "@/lib/cfbd/diagnostics";
import type { GameDetail, SaveGameInput } from "@/services/gameService";
import type { ScoringEventDetail } from "@/services/scoringService";
import type { LeagueStandingsData } from "@/services/standingsService";
import type { ExternalSyncRun, League, ScoringRule, SundayRecap, Team } from "@/types/database";

interface DraftedTeam {
  team: Team;
  ownerMemberId: string;
  ownerName: string;
  poolTeamName: string | null;
}

interface Props {
  league: League;
  rules: ScoringRule[];
  events: ScoringEventDetail[];
  games: GameDetail[];
  standings: LeagueStandingsData;
  draftedTeams: DraftedTeam[];
  teams: Team[];
  cfbdConfiguration: "configured" | "not_configured";
  syncRuns: ExternalSyncRun[];
  recapOperations: { enabled: boolean; lastRecap: SundayRecap | null; availableWeeks: number[] };
}

const emptyGame = (league: League): SaveGameInput => ({
  gameId: null,
  leagueId: league.id,
  season: league.season,
  week: 1,
  gameDate: new Date().toISOString().slice(0, 10),
  homeTeamId: "",
  awayTeamId: "",
  homeScore: null,
  awayScore: null,
  status: "final",
  neutralSite: false,
  postseason: false,
  rankingSource: null,
  homeRank: null,
  awayRank: null,
});

function points(points: number) { return `${points > 0 ? "+" : ""}${points}`; }
function optionalNumber(value: string) { return value === "" ? null : Number(value); }
function formatTimestamp(value: string) { return new Date(value).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC"); }
function summaryNumber(syncRun: ExternalSyncRun, key: string) {
  if (!syncRun.summary || typeof syncRun.summary !== "object" || Array.isArray(syncRun.summary)) return 0;
  const value = syncRun.summary[key];
  return typeof value === "number" ? value : 0;
}

export default function ScoringDashboard({ league, rules, events, games, standings, draftedTeams, teams, cfbdConfiguration, syncRuns, recapOperations }: Props) {
  const router = useRouter();
  const manualRules = rules.filter((rule) => rule.category !== "game_result");
  const [manual, setManual] = useState({ teamId: draftedTeams[0]?.team.id ?? "", ruleId: manualRules[0]?.id ?? "", week: "", eventDate: new Date().toISOString().slice(0, 10), notes: "" });
  const [confirmingManual, setConfirmingManual] = useState(false);
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [voidingEvent, setVoidingEvent] = useState<ScoringEventDetail | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [bulkResult, setBulkResult] = useState<BulkScoringActionState | null>(null);
  const [game, setGame] = useState<SaveGameInput>(() => emptyGame(league));
  const [teamFilter, setTeamFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [weekFilter, setWeekFilter] = useState("");
  const [gameView, setGameView] = useState<GameView>(() => defaultGameView(games));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedTeam = draftedTeams.find((item) => item.team.id === manual.teamId)?.team;
  const selectedRule = rules.find((rule) => rule.id === manual.ruleId);
  const ownerByTeam = useMemo(() => new Map(draftedTeams.map((item) => [item.team.id, item.ownerMemberId])), [draftedTeams]);
  const weeks = [...new Set(events.flatMap((event) => event.week === null ? [] : [event.week]))].sort((a, b) => a - b);
  const filteredEvents = events.filter((event) => (!teamFilter || event.team_id === teamFilter) && (!ownerFilter || ownerByTeam.get(event.team_id) === ownerFilter) && (!weekFilter || event.week === Number(weekFilter)));
  const gameWeeks = [...new Set(games.map((item) => item.week))].sort((a, b) => a - b);
  const displayedGames = visibleGames(games, gameView);
  const attentionCounts = gameAttentionCounts(games);
  const bulkPlan = bulkScoringPlan(games);
  const latestSync = syncRuns[0];
  const gameFormRef = useRef<HTMLDivElement>(null);
  const gameFormHeadingRef = useRef<HTMLHeadingElement>(null);

  async function run(action: () => Promise<{ error?: string; success?: string }>) {
    if (pending) return;
    setPending(true); setError(null); setMessage(null);
    const result = await action();
    setError(result.error ?? null); setMessage(result.success ?? null); setPending(false);
    if (!result.error) router.refresh();
    return result;
  }

  async function confirmManual() {
    const result = await run(() => addManualEventAction(league.id, {
      teamId: manual.teamId,
      ruleId: manual.ruleId,
      week: optionalNumber(manual.week),
      eventDate: manual.eventDate || null,
      notes: manual.notes.trim() || null,
    }));
    if (!result?.error) { setConfirmingManual(false); setManual((value) => ({ ...value, week: "", notes: "" })); }
  }

  async function confirmBulkScoring() {
    if (pending) return;
    setPending(true); setError(null); setMessage(null); setBulkResult(null);
    const result = await scoreEligibleFinalsAction(league.id);
    setPending(false);
    setBulkResult(result);
    if (result.error) setError(result.error);
    else {
      const processedCount = result.processed?.length ?? 0;
      const failedCount = result.failed?.length ?? 0;
      setMessage(`${processedCount} game${processedCount === 1 ? "" : "s"} processed${failedCount ? `; ${failedCount} failed` : ""}.`);
      router.refresh();
    }
  }

  function editGame(existing: GameDetail) {
    if (!existing.home_team_id || !existing.away_team_id) return;
    const homeRank = existing.rankings.find((rank) => rank.team_id === existing.home_team_id);
    const awayRank = existing.rankings.find((rank) => rank.team_id === existing.away_team_id);
    setGame({
      gameId: existing.id, leagueId: league.id, season: existing.season, week: existing.week,
      gameDate: existing.game_date, homeTeamId: existing.home_team_id, awayTeamId: existing.away_team_id,
      homeScore: existing.home_score, awayScore: existing.away_score,
      status: existing.status as SaveGameInput["status"], neutralSite: existing.neutral_site,
      postseason: existing.postseason, rankingSource: homeRank?.ranking_source ?? awayRank?.ranking_source ?? null,
      homeRank: homeRank?.rank ?? null, awayRank: awayRank?.rank ?? null,
    });
    window.requestAnimationFrame(() => {
      gameFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      gameFormHeadingRef.current?.focus({ preventScroll: true });
    });
  }

  function cancelGameEdit() {
    setGame(emptyGame(league));
    setMessage(null);
    setError(null);
  }

  async function confirmVoidEvent() {
    if (!voidingEvent || !voidReason.trim()) return;
    const result = await run(() => voidManualEventAction(league.id, voidingEvent.id, voidReason.trim()));
    if (!result?.error) {
      setVoidingEvent(null);
      setVoidReason("");
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950 [&_.text-slate-500]:!text-slate-700 [&_.text-slate-600]:!text-slate-700 [&_input]:bg-white [&_input]:text-slate-950 [&_input::placeholder]:text-slate-500 [&_label]:text-slate-800 [&_select]:bg-white [&_select]:text-slate-950 [&_textarea]:bg-white [&_textarea]:text-slate-950">
      <header className="relative overflow-hidden bg-blue-950 text-white"><div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.22),transparent_38%)]" aria-hidden="true" /><div className="relative mx-auto flex max-w-7xl flex-col justify-between gap-4 px-4 py-7 sm:flex-row sm:items-end sm:px-6"><div><Link href={`/commissioner/${league.id}`} className="text-sm font-bold text-blue-200 hover:text-white">← Commissioner HQ</Link><p className="mt-4 text-xs font-black uppercase tracking-[0.18em] text-orange-300">Season operations</p><h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Scoring Dashboard</h1><p className="mt-1 text-blue-100">{league.name} · {league.season}</p></div><div className="flex flex-col gap-2 sm:flex-row"><Link href={`/league/${league.id}`} className="rounded-lg bg-white px-4 py-2 text-center font-bold text-blue-950 hover:bg-blue-100">League Home</Link><Link href={`/league/${league.id}/standings`} className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-center font-bold hover:bg-white/20">View Standings</Link></div></div></header>
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
        {(message || error) && <div className={`${error ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"} rounded-lg p-4 font-semibold`} role={error ? "alert" : "status"}>{error ?? message}</div>}

        <section className="rounded-xl bg-white p-5 shadow sm:p-6">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div><p className="text-xs font-black uppercase tracking-[0.18em] text-orange-700">Schedule automation</p><h2 className="mt-1 text-2xl font-black">CFBD Data Sync</h2><p className="mt-1 max-w-3xl text-sm text-slate-700">Automatic synchronization runs throughout the week and more often on game days. Manual Sync remains the fallback. Synchronization never awards points, and commissioner overrides stay protected.</p><p className="mt-3 font-semibold">Connection: <span className={cfbdConfiguration === "configured" ? "text-green-700" : "text-amber-700"}>{cfbdConfiguration === "configured" ? "Configured" : "Not configured"}</span></p></div>
            <div className="flex flex-col gap-2 sm:flex-row"><Button className="sm:w-auto" variant="secondary" disabled={pending} onClick={() => run(() => testCfbdConnectionAction(league.id))}>Test Connection</Button><Button className="sm:w-auto" variant="info" disabled={pending || cfbdConfiguration !== "configured"} onClick={() => run(() => syncCfbdScheduleAction(league.id))}>Sync {league.season} Schedule</Button></div>
          </div>
          {latestSync ? <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-black uppercase tracking-wide text-slate-500">Latest synchronization</p><p className="mt-1 font-black text-slate-950">{formatTimestamp(latestSync.started_at)}</p></div><span className={`w-fit rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${latestSync.status === "completed" ? "bg-emerald-100 text-emerald-800" : latestSync.status === "failed" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}`}>{latestSync.status}</span></div><div className="mt-4 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">{[["Fetched", latestSync.fetched_count || summaryNumber(latestSync, "games_fetched")], ["Created", latestSync.created_count], ["Updated", latestSync.updated_count], ["Unchanged", latestSync.unchanged_count], ["Skipped", latestSync.skipped_count], ["New finals", summaryNumber(latestSync, "newly_final_count")]].map(([label, value]) => <div key={label} className="rounded-lg bg-white p-2"><p className="text-lg font-black text-blue-950">{value}</p><p className="text-[0.65rem] font-bold uppercase tracking-wide text-slate-500">{label}</p></div>)}</div>{syncRunFailureDetail(latestSync.summary) ? <p className="mt-3 rounded-lg bg-red-100 p-3 text-sm font-semibold text-red-800">Latest sync needs attention: {syncRunFailureDetail(latestSync.summary)?.message}</p> : null}</div> : <p className="mt-5 rounded-lg bg-slate-50 p-4 text-slate-700">No schedule synchronization has been recorded yet. Use manual Sync to establish the first schedule.</p>}
          {syncRuns.length ? <details className="mt-4"><summary className="cursor-pointer rounded-lg py-2 text-sm font-black text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700">View synchronization history ({syncRuns.length})</summary><div className="mt-2 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b text-slate-700"><th className="p-2">Started</th><th className="p-2">Status</th><th className="p-2">Fetched</th><th className="p-2">Created</th><th className="p-2">Updated</th><th className="p-2">Unchanged</th><th className="p-2">Skipped</th><th className="p-2">New finals</th><th className="p-2">Mapping issues</th><th className="p-2">Diagnostic</th></tr></thead><tbody>{syncRuns.map((syncRun) => { const failure = syncRunFailureDetail(syncRun.summary); return <tr key={syncRun.id} className="border-b"><td className="whitespace-nowrap p-2">{formatTimestamp(syncRun.started_at)}</td><td className="p-2 font-bold">{syncRun.status}</td><td className="p-2">{syncRun.fetched_count || summaryNumber(syncRun, "games_fetched")}</td><td className="p-2">{syncRun.created_count}</td><td className="p-2">{syncRun.updated_count}</td><td className="p-2">{syncRun.unchanged_count}</td><td className="p-2">{syncRun.skipped_count}</td><td className="p-2">{summaryNumber(syncRun, "newly_final_count")}</td><td className="p-2">{summaryNumber(syncRun, "ambiguous_count") + summaryNumber(syncRun, "unmatched_cfbd_count") + summaryNumber(syncRun, "unresolved_fbs_mapping_game_count")}</td><td className="max-w-sm p-2">{failure ? `${failure.stage} · ${failure.category} · ${failure.message}` : "—"}</td></tr>; })}</tbody></table></div></details> : null}
        </section>

        <SundayRecapControl leagueId={league.id} enabled={recapOperations.enabled} lastRecap={recapOperations.lastRecap} availableWeeks={recapOperations.availableWeeks} />

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-xl bg-white p-6 shadow">
            <h2 className="text-2xl font-bold">Add Manual Scoring Event</h2><p className="mt-1 text-sm text-slate-700">Postseason, awards, coaching, and statistical events. Game results use the game engine.</p>
            {!draftedTeams.length && <p className="mt-4 rounded-lg bg-amber-100 p-3 font-semibold text-amber-950">No drafted teams are available. Complete the league draft before adding manual scoring events.</p>}
            {!manualRules.length && <p className="mt-4 rounded-lg bg-red-100 p-3 font-semibold text-red-900">No active manual scoring rules are available. Verify the season-scoring migration.</p>}
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold">College team<select value={manual.teamId} disabled={!draftedTeams.length} onChange={(event) => setManual({ ...manual, teamId: event.target.value })} className="mt-1 w-full rounded-lg border p-2 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"><option value="">{draftedTeams.length ? "Choose team" : "Complete draft to choose a team"}</option>{draftedTeams.map((item) => <option key={item.team.id} value={item.team.id}>{item.team.school_name} — {item.poolTeamName ?? item.ownerName}</option>)}</select></label>
              <label className="text-sm font-semibold">Scoring rule<select value={manual.ruleId} disabled={!manualRules.length} onChange={(event) => setManual({ ...manual, ruleId: event.target.value })} className="mt-1 w-full rounded-lg border p-2 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"><option value="">{manualRules.length ? "Choose rule" : "No active rules available"}</option>{manualRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.display_name} ({points(rule.points)})</option>)}</select></label>
              <label className="text-sm font-semibold">Week (optional)<input type="number" min={1} value={manual.week} onChange={(event) => setManual({ ...manual, week: event.target.value })} placeholder="Season-level if blank" className="mt-1 w-full rounded-lg border p-2" /></label>
              <label className="text-sm font-semibold">Event date<input type="date" value={manual.eventDate} onChange={(event) => setManual({ ...manual, eventDate: event.target.value })} className="mt-1 w-full rounded-lg border p-2" /></label>
              <label className="text-sm font-semibold sm:col-span-2">Optional note<textarea value={manual.notes} maxLength={2000} onChange={(event) => setManual({ ...manual, notes: event.target.value })} className="mt-1 min-h-20 w-full rounded-lg border p-2" /></label>
            </div>
            <Button className="mt-4 sm:w-auto" disabled={!selectedTeam || !selectedRule || pending} onClick={() => setConfirmingManual(true)}>Review Event</Button>
          </div>

          <div ref={gameFormRef} className={`scroll-mt-6 rounded-xl bg-white p-6 shadow ${game.gameId ? "ring-2 ring-orange-500" : ""}`}>
            {game.gameId && <p className="mb-2 inline-flex rounded-full bg-orange-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-orange-800">Editing Week {game.week}: {teams.find((team) => team.id === game.awayTeamId)?.school_name ?? "Away team"} at {teams.find((team) => team.id === game.homeTeamId)?.school_name ?? "Home team"}</p>}
            <h2 ref={gameFormHeadingRef} tabIndex={-1} className="text-2xl font-bold outline-none">{game.gameId ? "Edit Game Result" : "Enter or Update Game Result"}</h2><p className="mt-1 text-sm text-slate-700">Ranking fields are the selected source&apos;s pre-game ranks. The source remains configurable.</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold">Week<input type="number" min={1} value={game.week} onChange={(event) => setGame({ ...game, week: Number(event.target.value) })} className="mt-1 w-full rounded-lg border p-2" /></label>
              <label className="text-sm font-semibold">Game date<input type="date" value={game.gameDate} onChange={(event) => setGame({ ...game, gameDate: event.target.value })} className="mt-1 w-full rounded-lg border p-2" /></label>
              <label className="text-sm font-semibold sm:col-span-2">Game status<select value={game.status} onChange={(event) => setGame({ ...game, status: event.target.value as SaveGameInput["status"] })} className="mt-1 w-full rounded-lg border p-2"><option value="scheduled">Scheduled</option><option value="in_progress">In Progress</option><option value="final">Final</option><option value="postponed">Postponed</option><option value="canceled">Canceled</option></select><span className="mt-1 block text-xs font-normal text-slate-600">Select Final only after confirming the official result. Final games become eligible for Process Scoring.</span></label>
              <label className="text-sm font-semibold">Home team<select value={game.homeTeamId} onChange={(event) => setGame({ ...game, homeTeamId: event.target.value })} className="mt-1 w-full rounded-lg border p-2"><option value="">Choose team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.school_name}</option>)}</select></label>
              <label className="text-sm font-semibold">Away team<select value={game.awayTeamId} onChange={(event) => setGame({ ...game, awayTeamId: event.target.value })} className="mt-1 w-full rounded-lg border p-2"><option value="">Choose team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.school_name}</option>)}</select></label>
              <label className="text-sm font-semibold">Home score<input type="number" min={0} value={game.homeScore ?? ""} onChange={(event) => setGame({ ...game, homeScore: optionalNumber(event.target.value) })} className="mt-1 w-full rounded-lg border p-2" /></label>
              <label className="text-sm font-semibold">Away score<input type="number" min={0} value={game.awayScore ?? ""} onChange={(event) => setGame({ ...game, awayScore: optionalNumber(event.target.value) })} className="mt-1 w-full rounded-lg border p-2" /></label>
              <label className="text-sm font-semibold">Ranking source (optional)<input value={game.rankingSource ?? ""} onChange={(event) => setGame({ ...game, rankingSource: event.target.value || null })} placeholder="AP, Coaches, CFP…" className="mt-1 w-full rounded-lg border p-2" /></label><span />
              <label className="text-sm font-semibold">Home pre-game rank<input type="number" min={1} value={game.homeRank ?? ""} onChange={(event) => setGame({ ...game, homeRank: optionalNumber(event.target.value) })} className="mt-1 w-full rounded-lg border p-2" /></label>
              <label className="text-sm font-semibold">Away pre-game rank<input type="number" min={1} value={game.awayRank ?? ""} onChange={(event) => setGame({ ...game, awayRank: optionalNumber(event.target.value) })} className="mt-1 w-full rounded-lg border p-2" /></label>
              <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={game.neutralSite} onChange={(event) => setGame({ ...game, neutralSite: event.target.checked })} />Neutral site</label>
              <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={game.postseason} onChange={(event) => setGame({ ...game, postseason: event.target.checked })} />Postseason</label>
            </div>
            <div className="mt-4 grid gap-3 sm:flex"><Button className="sm:w-auto" disabled={pending || !game.homeTeamId || !game.awayTeamId || game.homeScore === null || game.awayScore === null} onClick={async () => { const result = await run(() => saveGameAction(league.id, game)); if (!result?.error) setGame(emptyGame(league)); }}>{game.gameId ? "Update Game" : "Save Game"}</Button>{game.gameId && <Button className="sm:w-auto" variant="secondary" disabled={pending} onClick={cancelGameEdit}>Cancel Edit</Button>}</div>
          </div>
        </section>

        <section className="rounded-xl bg-white p-6 shadow">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div><h2 className="text-2xl font-bold">Games and Scoring Review</h2><p className="mt-1 text-sm text-slate-700">Imported finals remain unscored until you explicitly process them.</p></div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className="text-sm font-semibold">Game view<select value={gameView} onChange={(event) => setGameView(event.target.value as GameView)} className="mt-1 block w-full min-w-56 rounded-lg border p-2"><option value="attention">Needs attention</option><option value="all">All games — action first</option>{gameWeeks.map((week) => <option key={week} value={`week:${week}`}>Week {week}</option>)}</select></label><Button className="sm:w-auto" variant="sports" disabled={pending || bulkPlan.eligible.length === 0} onClick={() => { setBulkResult(null); setConfirmingBulk(true); }}>Process All Eligible Finals</Button></div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[["Needs Scoring", attentionCounts.needsScoring], ["Needs Reprocessing", attentionCounts.needsReprocessing], ["Missing Ranking Context", attentionCounts.missingRankingContext], ["Current", attentionCounts.current]].map(([label, count]) => <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-black uppercase tracking-wide text-slate-600">{label}</p><p className="mt-1 text-2xl font-black text-blue-950">{count}</p></div>)}
          </div>
          <p className="mt-4 text-sm font-semibold text-slate-700">Showing {displayedGames.length} of {games.length} games</p>
          <div className="mt-4 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-4"><p><span className="font-black text-amber-800">Needs Scoring</span><br />Final result has not been processed.</p><p><span className="font-black text-red-800">Result Changed</span><br />Saved final differs from active scoring.</p><p><span className="font-black text-green-800">Scoring Current</span><br />Ledger matches the saved final.</p><p><span className="font-black text-slate-700">Not Final</span><br />Scoring is unavailable.</p></div>
          <div className="mt-3 space-y-3">{displayedGames.length ? displayedGames.map((item) => { const scoringState = getGameScoringState(item); const scoringLabel = scoringState === "scored" ? "Scoring Current" : scoringState === "needs_reprocessing" ? "Result Changed / Reprocess" : scoringState === "needs_scoring" ? "Needs Scoring" : "Not Final"; const label = (participant: GameDetail["homeParticipant"]) => `${participant.displayName}${participant.kind === "external" ? ` (${participant.classification.toUpperCase()})` : ""}`; const rankingContextAvailable = hasGameRankingContext(item); const rankingSource = item.rankings[0]?.ranking_source; return <div key={item.id} className={`flex flex-col justify-between gap-3 rounded-lg p-4 lg:flex-row lg:items-center ${game.gameId === item.id ? "bg-orange-50 ring-2 ring-orange-400" : "bg-slate-100"}`}><div><p className="font-bold">Week {item.week}: {label(item.awayParticipant)} {item.away_score ?? "—"} at {label(item.homeParticipant)} {item.home_score ?? "—"}</p><div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-700"><span>{item.game_date} · {item.status} · {item.external_provider ? item.external_provider.toUpperCase() : "Manual"}</span>{item.manual_override ? <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-black uppercase tracking-wide text-orange-800">Manual override · sync protected</span> : null}{item.provider_synced_at ? <span>Synced {formatTimestamp(item.provider_synced_at)}</span> : null}</div><p className={`mt-2 text-xs font-bold ${rankingContextAvailable ? "text-slate-700" : "rounded bg-red-100 px-2 py-1.5 text-red-800"}`}>{rankingContextAvailable ? `Pregame rankings: ${rankingSource ?? "not applicable"}` : "Scoring blocked: required pregame ranking context is missing. Review rankings before processing."}</p><p className={`${scoringState === "scored" ? "text-green-700" : scoringState === "needs_reprocessing" ? "text-red-700" : "text-amber-700"} mt-2 text-sm font-black`}>{item.status === "final" ? `Final — ${scoringLabel}` : scoringLabel}</p></div><div className="grid gap-2 sm:flex">{item.home_team_id && item.away_team_id && <Button className="sm:w-auto" variant="secondary" disabled={pending} onClick={() => editGame(item)}>{game.gameId === item.id ? "Editing" : "Edit"}</Button>}<Button className="sm:w-auto" variant="sports" disabled={pending || !canProcessScoring(item)} onClick={() => run(() => scoreGameAction(league.id, item.id))}>{scoringState === "needs_reprocessing" ? "Reprocess Scoring" : scoringState === "scored" ? "Scoring Current" : "Process Scoring"}</Button></div></div>; }) : <p className="rounded-lg bg-slate-50 p-4 text-slate-600">No games match this view.</p>}</div>
        </section>

        <section className="rounded-xl bg-white p-6 shadow"><div className="flex flex-col justify-between gap-3 sm:flex-row"><div><h2 className="text-2xl font-bold">Current Standings</h2><p className="text-sm text-slate-500">Equal totals share rank.</p></div><Link href={`/league/${league.id}/standings`} className="font-bold text-blue-700">Full standings →</Link></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{standings.rows.map((row) => <div key={row.memberId} className="rounded-lg bg-slate-100 p-4"><p className="text-sm font-black text-slate-500">#{row.rank}</p><p className="font-bold">{row.poolTeamName ?? row.ownerName}</p><p className="mt-2 text-2xl font-black">{row.totalPoints}</p></div>)}</div></section>

        <section className="rounded-xl bg-white p-6 shadow"><h2 className="text-2xl font-bold">Scoring Event Ledger</h2><p className="mt-1 text-sm text-slate-700">Active and voided events remain visible here as the league&apos;s scoring audit trail.</p><div className="mt-4 grid gap-3 md:grid-cols-3"><select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)} className="rounded-lg border p-2"><option value="">All teams</option>{draftedTeams.map((item) => <option key={item.team.id} value={item.team.id}>{item.team.school_name}</option>)}</select><select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} className="rounded-lg border p-2"><option value="">All owners</option>{standings.rows.map((row) => <option key={row.memberId} value={row.memberId}>{row.poolTeamName ?? row.ownerName}</option>)}</select><select value={weekFilter} onChange={(event) => setWeekFilter(event.target.value)} className="rounded-lg border p-2"><option value="">All weeks and season events</option>{weeks.map((week) => <option key={week} value={week}>Week {week}</option>)}</select></div><div className="mt-5 space-y-3">{filteredEvents.length ? filteredEvents.map((event) => <article key={event.id} className={`${event.voided_at ? "opacity-55" : ""} flex flex-col justify-between gap-3 rounded-lg border p-4 sm:flex-row sm:items-center`}><div><div className="flex flex-wrap items-center gap-2"><p className="font-bold">{event.team.school_name} · {event.rule.display_name}</p>{event.voided_at && <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-black">VOID</span>}</div><p className="text-sm text-slate-500">{event.week ? `Week ${event.week}` : "Season"} · {event.source_type} · {formatTimestamp(event.created_at)}</p>{event.notes && <p className="text-sm text-slate-600">{event.notes}</p>}{event.void_reason && <p className="text-sm text-red-700">Void reason: {event.void_reason}</p>}</div><div className="flex items-center gap-3"><span className={`${event.points > 0 ? "text-green-700" : "text-red-700"} text-xl font-black`}>{points(event.points)}</span>{event.source_type === "manual" && !event.voided_at && <Button className="sm:w-auto" variant="danger" disabled={pending} onClick={() => { setVoidingEvent(event); setVoidReason(""); }}>Void</Button>}</div></article>) : <p className="text-slate-500">No events match these filters.</p>}</div></section>
      </div>

      {confirmingManual && selectedTeam && selectedRule && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="manual-confirm-title"><div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"><h2 id="manual-confirm-title" className="text-xl font-bold">Confirm Scoring Event</h2><div className="mt-4 rounded-lg bg-slate-100 p-5"><p className="text-xl font-black">{selectedTeam.school_name}</p><p className="mt-1 text-lg">{selectedRule.display_name}</p><p className={`${selectedRule.points > 0 ? "text-green-700" : "text-red-700"} mt-3 text-3xl font-black`}>{points(selectedRule.points)} points</p><p className="mt-2 text-sm text-slate-500">{manual.week ? `Week ${manual.week}` : "Season-level event"}</p></div><p className="mt-4 text-sm text-slate-600">The rule value will be snapshotted in the event ledger.</p><div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button className="sm:w-auto" variant="secondary" disabled={pending} onClick={() => setConfirmingManual(false)}>Cancel</Button><Button className="sm:w-auto" variant="success" disabled={pending} onClick={confirmManual}>{pending ? "Adding…" : "Confirm Event"}</Button></div></div></div>}
      {voidingEvent && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="void-event-title"><div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"><p className="text-xs font-black uppercase tracking-[0.16em] text-red-700">Audit-required action</p><h2 id="void-event-title" className="mt-1 text-xl font-black">Void Manual Scoring Event?</h2><p className="mt-3 text-sm text-slate-700">This removes {points(voidingEvent.points)} active points for {voidingEvent.team.school_name}. The event remains in the ledger as voided.</p><label className="mt-4 block text-sm font-bold">Reason for voiding<textarea autoFocus value={voidReason} maxLength={500} onChange={(event) => setVoidReason(event.target.value)} className="mt-1 min-h-24 w-full rounded-lg border p-3" placeholder="Explain the correction for the audit history" /></label><div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button className="sm:w-auto" variant="secondary" disabled={pending} onClick={() => setVoidingEvent(null)}>Cancel</Button><Button className="sm:w-auto" variant="danger" disabled={pending || !voidReason.trim()} onClick={confirmVoidEvent}>{pending ? "Voiding…" : "Void Event"}</Button></div></div></div>}
      {confirmingBulk && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="bulk-confirm-title"><div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-2xl"><h2 id="bulk-confirm-title" className="text-xl font-bold">Process All Eligible Finals</h2>{bulkResult && !bulkResult.error ? <div className="mt-4"><p className={`rounded-lg p-3 font-bold ${(bulkResult.failed?.length ?? 0) > 0 ? "bg-amber-100 text-amber-950" : "bg-green-100 text-green-900"}`}>{bulkResult.processed?.length ?? 0} processed · {bulkResult.failed?.length ?? 0} failed</p>{(bulkResult.processed?.length ?? 0) > 0 && <div className="mt-4"><h3 className="font-bold text-green-800">Succeeded</h3><ul className="mt-2 space-y-1 text-sm">{bulkResult.processed?.map((item) => <li key={item.gameId}>{item.label} · {item.eventCount} active event{item.eventCount === 1 ? "" : "s"}</li>)}</ul></div>}{(bulkResult.failed?.length ?? 0) > 0 && <div className="mt-4"><h3 className="font-bold text-red-800">Failed</h3><ul className="mt-2 space-y-2 text-sm">{bulkResult.failed?.map((item) => <li key={item.gameId} className="rounded bg-red-50 p-2"><span className="font-bold">{item.label}</span><br />{item.reason}</li>)}</ul></div>}<Button className="mt-6 sm:w-auto" variant="secondary" onClick={() => setConfirmingBulk(false)}>Close</Button></div> : <><p className="mt-2 text-sm text-slate-700">Each game is rechecked on the server and processed through the existing authoritative scoring path.</p><div className="mt-4 grid grid-cols-2 gap-2 text-sm"><div className="rounded-lg bg-green-50 p-3"><span className="block text-2xl font-black text-green-800">{bulkPlan.eligible.length}</span>will be processed</div><div className="rounded-lg bg-slate-100 p-3"><span className="block text-2xl font-black">{bulkPlan.excluded.alreadyCurrent}</span>already current</div><div className="rounded-lg bg-red-50 p-3"><span className="block text-2xl font-black text-red-800">{bulkPlan.excluded.missingRankingContext}</span>missing ranking context</div><div className="rounded-lg bg-slate-100 p-3"><span className="block text-2xl font-black">{bulkPlan.excluded.notFinal}</span>not final</div><div className="col-span-2 rounded-lg bg-amber-50 p-3"><span className="block text-2xl font-black text-amber-800">{bulkPlan.excluded.otherwiseIneligible}</span>otherwise ineligible</div></div>{bulkResult?.error && <p className="mt-4 rounded-lg bg-red-50 p-3 font-semibold text-red-800" role="alert">{bulkResult.error}</p>}<div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button className="sm:w-auto" variant="secondary" disabled={pending} onClick={() => setConfirmingBulk(false)}>Cancel</Button><Button className="sm:w-auto" variant="sports" disabled={pending || bulkPlan.eligible.length === 0} onClick={confirmBulkScoring}>{pending ? "Processing…" : `Process ${bulkPlan.eligible.length} Game${bulkPlan.eligible.length === 1 ? "" : "s"}`}</Button></div></>}</div></div>}
    </main>
  );
}
