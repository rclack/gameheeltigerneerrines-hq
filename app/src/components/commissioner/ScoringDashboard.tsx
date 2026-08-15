"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { addManualEventAction, saveGameAction, scoreGameAction, syncCfbdScheduleAction, testCfbdConnectionAction, voidManualEventAction } from "@/app/commissioner/scoring/actions";
import Button from "@/components/ui/Button";
import { getGameScoringState } from "@/lib/cfbd/scoringState";
import { syncRunFailureDetail } from "@/lib/cfbd/diagnostics";
import type { GameDetail, SaveGameInput } from "@/services/gameService";
import type { ScoringEventDetail } from "@/services/scoringService";
import type { LeagueStandingsData } from "@/services/standingsService";
import type { ExternalSyncRun, League, ScoringRule, Team } from "@/types/database";

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
function summaryNumber(syncRun: ExternalSyncRun, key: string) {
  if (!syncRun.summary || typeof syncRun.summary !== "object" || Array.isArray(syncRun.summary)) return 0;
  const value = syncRun.summary[key];
  return typeof value === "number" ? value : 0;
}

export default function ScoringDashboard({ league, rules, events, games, standings, draftedTeams, teams, cfbdConfiguration, syncRuns }: Props) {
  const manualRules = rules.filter((rule) => rule.category !== "game_result");
  const [manual, setManual] = useState({ teamId: draftedTeams[0]?.team.id ?? "", ruleId: manualRules[0]?.id ?? "", week: "", eventDate: new Date().toISOString().slice(0, 10), notes: "" });
  const [confirmingManual, setConfirmingManual] = useState(false);
  const [game, setGame] = useState<SaveGameInput>(() => emptyGame(league));
  const [teamFilter, setTeamFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [weekFilter, setWeekFilter] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedTeam = draftedTeams.find((item) => item.team.id === manual.teamId)?.team;
  const selectedRule = rules.find((rule) => rule.id === manual.ruleId);
  const ownerByTeam = useMemo(() => new Map(draftedTeams.map((item) => [item.team.id, item.ownerMemberId])), [draftedTeams]);
  const weeks = [...new Set(events.flatMap((event) => event.week === null ? [] : [event.week]))].sort((a, b) => a - b);
  const filteredEvents = events.filter((event) => (!teamFilter || event.team_id === teamFilter) && (!ownerFilter || ownerByTeam.get(event.team_id) === ownerFilter) && (!weekFilter || event.week === Number(weekFilter)));

  async function run(action: () => Promise<{ error?: string; success?: string }>) {
    if (pending) return;
    setPending(true); setError(null); setMessage(null);
    const result = await action();
    setError(result.error ?? null); setMessage(result.success ?? null); setPending(false);
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
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function voidEvent(eventId: string) {
    const reason = window.prompt("Why is this manual scoring event being voided?");
    if (!reason?.trim()) return;
    await run(() => voidManualEventAction(league.id, eventId, reason));
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950 [&_.text-slate-500]:!text-slate-700 [&_.text-slate-600]:!text-slate-700 [&_input]:bg-white [&_input]:text-slate-950 [&_input::placeholder]:text-slate-500 [&_label]:text-slate-800 [&_select]:bg-white [&_select]:text-slate-950 [&_textarea]:bg-white [&_textarea]:text-slate-950">
      <header className="bg-blue-950 text-white"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-4 px-6 py-6 sm:flex-row sm:items-end"><div><Link href="/commissioner" className="text-sm text-blue-200 hover:text-white">← Commissioner Portal</Link><h1 className="mt-2 text-3xl font-bold">Scoring Dashboard</h1><p className="text-slate-300">{league.name} · {league.season}</p></div><div className="flex flex-col gap-2 sm:flex-row"><Link href={`/league/${league.id}`} className="rounded-lg bg-white px-4 py-2 text-center font-bold text-blue-950 hover:bg-blue-100">My League</Link><Link href={`/league/${league.id}/standings`} className="rounded-lg bg-purple-600 px-4 py-2 text-center font-bold hover:bg-purple-500">View Standings</Link></div></div></header>
      <div className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        {(message || error) && <div className={`${error ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"} rounded-lg p-4 font-semibold`} role={error ? "alert" : "status"}>{error ?? message}</div>}

        <section className="rounded-xl bg-white p-6 shadow">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div><h2 className="text-2xl font-bold">CFBD Data Sync</h2><p className="mt-1 text-sm text-slate-700">Imports provider data into internal games. It never awards points; final games require commissioner scoring confirmation.</p><p className="mt-3 font-semibold">Configuration: <span className={cfbdConfiguration === "configured" ? "text-green-700" : "text-amber-700"}>{cfbdConfiguration === "configured" ? "Configured" : "Not Configured"}</span></p></div>
            <div className="flex flex-col gap-2 sm:flex-row"><Button className="sm:w-auto" variant="secondary" disabled={pending} onClick={() => run(() => testCfbdConnectionAction(league.id))}>Test Connection</Button><Button className="sm:w-auto" variant="info" disabled={pending || cfbdConfiguration !== "configured"} onClick={() => run(() => syncCfbdScheduleAction(league.id))}>Sync {league.season} Schedule</Button></div>
          </div>
          <div className="mt-5 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b text-slate-700"><th className="p-2">Started</th><th className="p-2">Status</th><th className="p-2">Fetched</th><th className="p-2">Created</th><th className="p-2">Updated</th><th className="p-2">Unchanged</th><th className="p-2">Skipped</th><th className="p-2">Unsupported non-FBS</th><th className="p-2">New finals</th><th className="p-2">Mapping issues</th><th className="p-2">Diagnostic</th></tr></thead><tbody>{syncRuns.map((syncRun) => { const failure = syncRunFailureDetail(syncRun.summary); return <tr key={syncRun.id} className="border-b"><td className="p-2">{new Date(syncRun.started_at).toLocaleString()}</td><td className="p-2 font-bold">{syncRun.status}</td><td className="p-2">{syncRun.fetched_count || summaryNumber(syncRun, "games_fetched")}</td><td className="p-2">{syncRun.created_count}</td><td className="p-2">{syncRun.updated_count}</td><td className="p-2">{syncRun.unchanged_count}</td><td className="p-2">{syncRun.skipped_count}</td><td className="p-2">{summaryNumber(syncRun, "unsupported_non_fbs_game_count")}</td><td className="p-2">{summaryNumber(syncRun, "newly_final_count")}</td><td className="p-2">{summaryNumber(syncRun, "ambiguous_count") + summaryNumber(syncRun, "unmatched_cfbd_count") + summaryNumber(syncRun, "unresolved_fbs_mapping_game_count")}</td><td className="max-w-sm p-2">{failure ? `${failure.stage} · ${failure.category} · ${failure.message}` : "—"}</td></tr>; })}</tbody></table>{!syncRuns.length && <p className="py-4 text-slate-700">No schedule synchronization has been run.</p>}</div>
        </section>

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

          <div className="rounded-xl bg-white p-6 shadow">
            <h2 className="text-2xl font-bold">Enter or Update Game Result</h2><p className="mt-1 text-sm text-slate-700">Ranking fields are the selected source&apos;s pre-game ranks. The source remains configurable.</p>
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
            <div className="mt-4 flex gap-3"><Button className="sm:w-auto" disabled={pending || !game.homeTeamId || !game.awayTeamId || game.homeScore === null || game.awayScore === null} onClick={async () => { const result = await run(() => saveGameAction(league.id, game)); if (!result?.error) setGame(emptyGame(league)); }}>{game.gameId ? "Update Game" : "Save Final Game"}</Button>{game.gameId && <Button className="sm:w-auto" variant="secondary" onClick={() => setGame(emptyGame(league))}>Cancel Edit</Button>}</div>
          </div>
        </section>

        <section className="rounded-xl bg-white p-6 shadow"><h2 className="text-2xl font-bold">Games and Scoring Review</h2><p className="mt-1 text-sm text-slate-700">Imported finals remain unscored until you explicitly process them.</p><div className="mt-4 space-y-3">{games.length ? games.map((item) => { const scoringState = getGameScoringState(item); const scoringLabel = scoringState === "scored" ? "Scored" : scoringState === "needs_reprocessing" ? "Result Changed / Reprocess" : scoringState === "needs_scoring" ? "Needs Scoring" : "Not Final"; const label = (participant: GameDetail["homeParticipant"]) => `${participant.displayName}${participant.kind === "external" ? ` (${participant.classification.toUpperCase()})` : ""}`; const expectedSnapshots = item.home_team_id && item.away_team_id ? 2 : 0; const rankingContextAvailable = expectedSnapshots === 0 || item.rankings.length >= expectedSnapshots; const rankingSource = item.rankings[0]?.ranking_source; return <div key={item.id} className="flex flex-col justify-between gap-3 rounded-lg bg-slate-100 p-4 lg:flex-row lg:items-center"><div><p className="font-bold">Week {item.week}: {label(item.awayParticipant)} {item.away_score ?? "—"} at {label(item.homeParticipant)} {item.home_score ?? "—"}</p><p className="text-sm text-slate-700">{item.game_date} · {item.status} · {item.external_provider ? item.external_provider.toUpperCase() : "Manual"}{item.manual_override ? " · manual override" : ""}{item.provider_synced_at ? ` · synced ${new Date(item.provider_synced_at).toLocaleString()}` : ""}</p><p className={`mt-1 text-xs font-bold ${rankingContextAvailable ? "text-slate-700" : "text-red-700"}`}>{rankingContextAvailable ? `Pregame rankings: ${rankingSource ?? "not applicable"}` : "Pregame ranking context unavailable — review before scoring."}</p><p className={`${scoringState === "scored" ? "text-green-700" : scoringState === "needs_reprocessing" ? "text-red-700" : "text-amber-700"} mt-1 text-sm font-black`}>{item.status === "final" ? `Final — ${scoringLabel}` : scoringLabel}</p></div><div className="flex gap-2">{item.home_team_id && item.away_team_id && <Button className="sm:w-auto" variant="secondary" disabled={pending} onClick={() => editGame(item)}>Edit</Button>}<Button className="sm:w-auto" variant="sports" disabled={pending || item.status !== "final" || scoringState === "scored" || !rankingContextAvailable} onClick={() => run(() => scoreGameAction(league.id, item.id))}>{scoringState === "needs_reprocessing" ? "Reprocess Scoring" : scoringState === "scored" ? "Scoring Current" : "Process Scoring"}</Button></div></div>; }) : <p className="text-slate-500">No games entered yet.</p>}</div></section>

        <section className="rounded-xl bg-white p-6 shadow"><div className="flex flex-col justify-between gap-3 sm:flex-row"><div><h2 className="text-2xl font-bold">Current Standings</h2><p className="text-sm text-slate-500">Equal totals share rank.</p></div><Link href={`/league/${league.id}/standings`} className="font-bold text-blue-700">Full standings →</Link></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{standings.rows.map((row) => <div key={row.memberId} className="rounded-lg bg-slate-100 p-4"><p className="text-sm font-black text-slate-500">#{row.rank}</p><p className="font-bold">{row.poolTeamName ?? row.ownerName}</p><p className="mt-2 text-2xl font-black">{row.totalPoints}</p></div>)}</div></section>

        <section className="rounded-xl bg-white p-6 shadow"><h2 className="text-2xl font-bold">Scoring Event Ledger</h2><div className="mt-4 grid gap-3 md:grid-cols-3"><select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)} className="rounded-lg border p-2"><option value="">All teams</option>{draftedTeams.map((item) => <option key={item.team.id} value={item.team.id}>{item.team.school_name}</option>)}</select><select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} className="rounded-lg border p-2"><option value="">All owners</option>{standings.rows.map((row) => <option key={row.memberId} value={row.memberId}>{row.poolTeamName ?? row.ownerName}</option>)}</select><select value={weekFilter} onChange={(event) => setWeekFilter(event.target.value)} className="rounded-lg border p-2"><option value="">All weeks and season events</option>{weeks.map((week) => <option key={week} value={week}>Week {week}</option>)}</select></div><div className="mt-5 space-y-3">{filteredEvents.length ? filteredEvents.map((event) => <article key={event.id} className={`${event.voided_at ? "opacity-55" : ""} flex flex-col justify-between gap-3 rounded-lg border p-4 sm:flex-row sm:items-center`}><div><div className="flex flex-wrap items-center gap-2"><p className="font-bold">{event.team.school_name} · {event.rule.display_name}</p>{event.voided_at && <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-black">VOID</span>}</div><p className="text-sm text-slate-500">{event.week ? `Week ${event.week}` : "Season"} · {event.source_type} · {new Date(event.created_at).toLocaleString()}</p>{event.notes && <p className="text-sm text-slate-600">{event.notes}</p>}{event.void_reason && <p className="text-sm text-red-700">Void reason: {event.void_reason}</p>}</div><div className="flex items-center gap-3"><span className={`${event.points > 0 ? "text-green-700" : "text-red-700"} text-xl font-black`}>{points(event.points)}</span>{event.source_type === "manual" && !event.voided_at && <Button className="sm:w-auto" variant="danger" disabled={pending} onClick={() => voidEvent(event.id)}>Void</Button>}</div></article>) : <p className="text-slate-500">No events match these filters.</p>}</div></section>
      </div>

      {confirmingManual && selectedTeam && selectedRule && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="manual-confirm-title"><div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"><h2 id="manual-confirm-title" className="text-xl font-bold">Confirm Scoring Event</h2><div className="mt-4 rounded-lg bg-slate-100 p-5"><p className="text-xl font-black">{selectedTeam.school_name}</p><p className="mt-1 text-lg">{selectedRule.display_name}</p><p className={`${selectedRule.points > 0 ? "text-green-700" : "text-red-700"} mt-3 text-3xl font-black`}>{points(selectedRule.points)} points</p><p className="mt-2 text-sm text-slate-500">{manual.week ? `Week ${manual.week}` : "Season-level event"}</p></div><p className="mt-4 text-sm text-slate-600">The rule value will be snapshotted in the event ledger.</p><div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button className="sm:w-auto" variant="secondary" disabled={pending} onClick={() => setConfirmingManual(false)}>Cancel</Button><Button className="sm:w-auto" variant="success" disabled={pending} onClick={confirmManual}>{pending ? "Adding…" : "Confirm Event"}</Button></div></div></div>}
    </main>
  );
}
