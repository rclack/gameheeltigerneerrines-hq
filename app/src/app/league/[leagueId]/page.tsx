import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import FavoriteTeamSelector from "@/components/league/FavoriteTeamSelector";
import TeamNameForm from "@/components/league/TeamNameForm";
import WeeklyLineup from "@/components/league/WeeklyLineup";
import TeamLogo from "@/components/team/TeamLogo";
import { favoriteTeamTheme } from "@/lib/league/favorite-team-theme";
import {
  getTeamSeasonRecord,
  ownerScoringSummary,
  recordLabel,
  selectRelevantOwnerGames,
} from "@/lib/league/owner-season";
import { formatRankedTeamName } from "@/lib/league/ranking-display";
import { createClient } from "@/lib/supabase/server";
import {
  getDraftParticipants,
  getDraftPicks,
  getDraftTeamIntelligence,
  getLeagueDraft,
  getMemberDraftSlot,
} from "@/services/draftService";
import { formatGameParticipant, getLeagueGames, type GameDetail } from "@/services/gameService";
import { getLeagueRoster } from "@/services/membershipService";
import { getLeagueStandings } from "@/services/standingsService";
import { getMyMaterializedLineupWeeks, getOrMaterializeMyWeeklyLineup } from "@/services/lineupService";
import { getActiveTeams } from "@/services/teamService";

function pointsLabel(points: number) {
  return `${points > 0 ? "+" : ""}${points} ${Math.abs(points) === 1 ? "point" : "points"}`;
}

function gameDateLabel(game: GameDetail) {
  const value = new Date(game.start_at ?? `${game.game_date}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(game.start_at ? { hour: "numeric" as const, minute: "2-digit" as const } : {}),
  }).format(value);
}

function gameStatusLabel(status: string) {
  if (status === "in_progress") return "Live";
  if (status === "postponed") return "Postponed";
  return "Upcoming";
}

export default async function LeaguePage({ params, searchParams }: { params: Promise<{ leagueId: string }>; searchParams: Promise<{ lineupWeek?: string }> }) {
  const { leagueId } = await params;
  const requestedLineupWeekValue = (await searchParams).lineupWeek;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/league/${leagueId}`)}`);

  const { data: league } = await supabase.from("leagues").select("*").eq("id", leagueId).maybeSingle();
  if (!league) notFound();
  const { data: membership } = await supabase
    .from("league_members")
    .select("*")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) notFound();

  const [roster, draft, standings, profile, teams] = await Promise.all([
    getLeagueRoster(supabase, league.id),
    getLeagueDraft(supabase, league.id),
    getLeagueStandings(supabase, league.id),
    supabase.from("profiles").select("*").eq("id", user.id).single().then(({ data, error }) => {
      if (error) throw error;
      return data;
    }),
    getActiveTeams(supabase),
  ]);
  const [participants, mySlot, games] = draft
    ? await Promise.all([
        getDraftParticipants(supabase, draft.id, roster.members),
        getMemberDraftSlot(supabase, draft.id, membership.id),
        getLeagueGames(supabase, league.id),
      ])
    : [[], null, []];
  const picks = draft ? await getDraftPicks(supabase, draft.id, participants, teams) : [];
  const myPicks = picks.filter((pick) => pick.league_member_id === membership.id);
  const intelligence: Record<string, Awaited<ReturnType<typeof getDraftTeamIntelligence>>[string]> = myPicks.length
    ? await getDraftTeamIntelligence(supabase, league, myPicks.map((pick) => pick.team))
    : {};
  const myTeamIds = myPicks.map((pick) => pick.team_id);
  const relevantGames = selectRelevantOwnerGames(games, myTeamIds, new Date());
  const materializedLineupWeeks = draft?.status === "complete" ? await getMyMaterializedLineupWeeks(supabase, league.id, membership.id) : [];
  const requestedLineupWeek = requestedLineupWeekValue !== undefined && /^\d+$/.test(requestedLineupWeekValue) ? Number(requestedLineupWeekValue) : null;
  const defaultLineupWeek = relevantGames.find((game) => game.status !== "final" && game.status !== "canceled")?.week ?? standings.selectedWeek;
  const lineupWeek = requestedLineupWeek !== null && materializedLineupWeeks.includes(requestedLineupWeek) ? requestedLineupWeek : defaultLineupWeek;
  const weeklyLineup = draft?.status === "complete"
    ? await getOrMaterializeMyWeeklyLineup(supabase, league.id, membership.id, lineupWeek)
    : null;
  const scoring = ownerScoringSummary(myPicks, standings.events);
  const myStanding = standings.rows.find((row) => row.memberId === membership.id);
  const favoriteTeam = teams.find((team) => team.id === profile.favorite_team_id) ?? null;
  const theme = favoriteTeamTheme(favoriteTeam);
  const draftIsPrimary = draft?.status === "live" || draft?.status === "paused" || myPicks.length === 0;
  const draftStatus = !draft
    ? "Not set up"
    : draft.status === "not_started"
      ? "Ready"
      : draft.status.charAt(0).toUpperCase() + draft.status.slice(1);

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b-4 bg-blue-950 text-white" style={{ borderColor: theme.secondary }}>
        <div className="mx-auto flex max-w-6xl flex-col justify-between gap-4 px-5 py-5 sm:flex-row sm:items-center sm:px-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-200">{favoriteTeam ? `${favoriteTeam.school_name} faithful` : `${league.season} College Football Pool`}</p>
            <h1 className="mt-1 text-2xl font-black sm:text-3xl">{league.name}</h1>
          </div>
          {league.commissioner_id === user.id && (
            <Link href={`/commissioner/${league.id}`} className="rounded-lg bg-white px-4 py-2 text-center font-bold text-blue-950 transition hover:bg-blue-100">
              Commissioner Admin
            </Link>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:px-6 sm:py-8">
        <section
          className="relative overflow-hidden rounded-2xl shadow-xl"
          aria-labelledby="my-season-heading"
          style={{
            color: theme.foreground,
            backgroundColor: theme.primary,
            backgroundImage: `radial-gradient(circle at 82% 22%, ${theme.secondary}66 0, transparent 30%), linear-gradient(120deg, ${theme.primaryDark} 0%, ${theme.primary} 62%, ${theme.secondary}99 140%)`,
            boxShadow: `0 20px 45px -28px ${theme.primary}`,
          }}
        >
          {favoriteTeam && (
            <div className="pointer-events-none absolute -right-5 -top-10 opacity-15 sm:right-8"><TeamLogo team={favoriteTeam} size="hero" decorative /></div>
          )}
          <div className="relative border-b border-white/10 p-5 sm:p-7">
            <p id="my-season-heading" className="text-xs font-black uppercase tracking-[0.22em]" style={{ color: theme.heroAccent }}>{favoriteTeam ? `${favoriteTeam.school_name} · My Season` : "My Season"}</p>
            <div className="mt-3 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <p className="text-5xl font-black leading-none sm:text-6xl">{myStanding?.totalPoints ?? 0}</p>
                <p className="mt-2 text-lg font-bold opacity-85">
                  {myStanding ? `#${myStanding.rank} in the league` : "Standings pending"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center sm:flex">
                <div className="rounded-lg border border-current/15 bg-black/10 px-4 py-3"><p className="text-2xl font-black">{myPicks.length}</p><p className="text-xs opacity-75">Teams owned</p></div>
                <div className="rounded-lg border border-current/15 bg-black/10 px-4 py-3"><p className="text-2xl font-black">{relevantGames.length}</p><p className="text-xs opacity-75">On the radar</p></div>
              </div>
            </div>
            <div className="mt-5 grid gap-2 sm:flex">
              <Link href={`/league/${league.id}/score`} className="rounded-lg px-5 py-3 text-center font-black shadow-sm transition hover:brightness-95" style={{ backgroundColor: theme.secondary, color: theme.secondaryForeground }}>View My Score</Link>
              <Link href={`/league/${league.id}/standings`} className="rounded-lg border border-current/50 px-5 py-3 text-center font-bold transition hover:bg-black/10">League Standings</Link>
              <Link href={`/league/${league.id}/rules`} className="rounded-lg border border-current/50 px-5 py-3 text-center font-bold transition hover:bg-black/10">How Scoring Works</Link>
            </div>
          </div>
        </section>

        <FavoriteTeamSelector
          leagueId={league.id}
          teams={teams.map((team) => ({ id: team.id, school_name: team.school_name, abbreviation: team.abbreviation, conference: team.conference, primary_color: team.primary_color, logo_url: team.logo_url }))}
          favoriteTeamId={favoriteTeam?.id ?? null}
        />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="min-w-0 space-y-6">
            {weeklyLineup && <WeeklyLineup leagueId={league.id} detail={weeklyLineup} availableWeeks={materializedLineupWeeks} nowIso={new Date().toISOString()} />}
            {draftIsPrimary && (
              <section className="rounded-2xl border-2 border-orange-400 bg-white p-5 shadow-lg" aria-labelledby="draft-heading">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="text-xs font-black uppercase tracking-widest text-orange-600">Draft Night</p><h2 id="draft-heading" className="mt-1 text-2xl font-black">Build your college roster</h2></div>
                  <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-black uppercase text-blue-800">{draftStatus}</span>
                </div>
                <p className="mt-3 text-slate-600">
                  {draft?.status === "live" ? "The draft is live. Enter the room to see who is on the clock." : draft?.status === "paused" ? "The draft is paused, but the board and your queue remain available." : "Your season hub will fill in as soon as teams are drafted."}
                </p>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-slate-100 p-3"><p className="text-xs text-slate-500">Position</p><p className="font-black">{mySlot ? `#${mySlot.draft_position}` : "TBD"}</p></div>
                  <div className="rounded-lg bg-slate-100 p-3"><p className="text-xs text-slate-500">Rounds</p><p className="font-black">{league.teams_per_owner}</p></div>
                  <div className="rounded-lg bg-slate-100 p-3"><p className="text-xs text-slate-500">My picks</p><p className="font-black">{myPicks.length}</p></div>
                </div>
                {draft && draft.status !== "not_started" && (
                  <Link href={`/draft/${draft.id}`} className="mt-4 block rounded-lg bg-orange-500 px-5 py-3 text-center font-black text-white hover:bg-orange-600 sm:inline-block">
                    {draft.status === "complete" ? "View Draft Results" : "Enter Draft Room"} →
                  </Link>
                )}
              </section>
            )}

            {myPicks.length > 0 && (
              <>
                <section className="rounded-2xl bg-white p-5 shadow" aria-labelledby="watchlist-heading">
                  <div className="flex items-end justify-between gap-4">
                    <div><p className="text-xs font-black uppercase tracking-widest" style={{ color: favoriteTeam ? theme.primaryText : "#EA580C" }}>What matters next</p><h2 id="watchlist-heading" className="mt-1 text-2xl font-black">Saturday Watchlist</h2></div>
                    <p className="text-xs font-semibold text-slate-500">Next {relevantGames.length} games</p>
                  </div>
                  {relevantGames.length ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {relevantGames.map((game) => {
                        const ownedIsHome = myTeamIds.includes(game.home_team_id ?? "");
                        const ownedParticipant = ownedIsHome ? game.homeParticipant : game.awayParticipant;
                        const opponent = ownedIsHome ? game.awayParticipant : game.homeParticipant;
                        const ownedRanking = game.rankings.find((ranking) => ranking.team_id === ownedParticipant?.id);
                        const opponentRanking = game.rankings.find((ranking) => ranking.team_id === opponent?.id);
                        const context = game.neutral_site ? "vs" : ownedIsHome ? "vs" : "at";
                        return (
                          <article key={game.id} className={`rounded-xl border p-4 ${game.status === "in_progress" ? "border-orange-400 bg-orange-50" : "border-slate-200 bg-slate-50"}`}>
                            <div className="flex items-center justify-between gap-2">
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase ${game.status === "in_progress" ? "bg-red-600 text-white" : "bg-blue-100 text-blue-800"}`}>{gameStatusLabel(game.status)}</span>
                              <span className="text-xs font-bold text-slate-500">Week {game.week}</span>
                            </div>
                            <div className="mt-3 flex items-center gap-3">
                              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-white shadow-sm"><TeamLogo team={ownedParticipant?.kind === "internal" ? ownedParticipant.team : { school_name: formatGameParticipant(ownedParticipant) }} size="md" decorative /></span>
                              <p className="text-lg font-black">{formatRankedTeamName(formatGameParticipant(ownedParticipant), ownedRanking?.rank)}</p>
                            </div>
                            <p className="my-1 text-xs font-bold uppercase tracking-wider text-slate-400">{context}</p>
                            <div className="flex items-center gap-2"><TeamLogo team={opponent?.kind === "internal" ? opponent.team : { school_name: formatGameParticipant(opponent) }} size="sm" decorative /><p className="font-bold text-slate-700">{formatRankedTeamName(formatGameParticipant(opponent), opponentRanking?.rank)}</p></div>
                            <div className="mt-3 border-t border-slate-200 pt-3">
                              <p className="font-bold text-blue-950">{gameDateLabel(game)}</p>
                              {game.status === "in_progress" && game.home_score !== null && game.away_score !== null && <p className="mt-1 text-sm font-black text-red-700">Live score: {game.away_score}–{game.home_score}</p>}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-4 rounded-xl bg-slate-100 p-4 text-slate-600">No current or upcoming games are on your synchronized schedule yet.</p>
                  )}
                </section>

                <section className="rounded-2xl bg-white p-5 shadow" aria-labelledby="teams-heading">
                  <div><p className="text-xs font-black uppercase tracking-widest text-orange-600">Your roster</p><h2 id="teams-heading" className="mt-1 text-2xl font-black">My Teams</h2></div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {myPicks.map((pick) => {
                      const facts = intelligence[pick.team_id];
                      const record = getTeamSeasonRecord(games, pick.team_id);
                      const contribution = scoring.totals.get(pick.team_id) ?? 0;
                      return (
                        <article key={pick.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm"><TeamLogo team={pick.team} size="md" decorative /></span><div className="min-w-0"><p className="truncate text-lg font-black text-blue-950">{formatRankedTeamName(pick.team.school_name, facts?.apRank)}</p><p className="truncate text-sm font-semibold text-slate-500">{pick.team.conference ?? "Conference unavailable"} · {facts?.classification ?? "FBS"}</p></div></div>
                            <span className="rounded-lg bg-blue-950 px-2.5 py-1 text-sm font-black text-white">{recordLabel(record)}</span>
                          </div>
                          <div className="mt-4 flex items-end justify-between border-t border-slate-200 pt-3">
                            <div><p className="text-xs text-slate-500">Score contribution</p><p className={`text-xl font-black ${contribution < 0 ? "text-red-700" : "text-green-700"}`}>{pointsLabel(contribution)}</p></div>
                            <p className="text-xs font-bold text-slate-500">R{pick.round_number} · Pick {pick.overall_pick}</p>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>

                <section className="rounded-2xl bg-white p-5 shadow" aria-labelledby="activity-heading">
                  <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-widest text-orange-600">Score movement</p><h2 id="activity-heading" className="mt-1 text-2xl font-black">Recent Activity</h2></div><Link href={`/league/${league.id}/score`} className="text-sm font-black text-blue-800 hover:underline">Full score →</Link></div>
                  {scoring.recent.length ? (
                    <div className="mt-4 divide-y divide-slate-200">
                      {scoring.recent.slice(0, 5).map((event) => (
                        <div key={event.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                          <div><p className="font-black">{event.team?.school_name ?? "Team"}</p><p className="text-sm text-slate-500">{event.rule.display_name}</p></div>
                          <p className={`shrink-0 text-lg font-black ${event.points < 0 ? "text-red-700" : "text-green-700"}`}>{pointsLabel(event.points)}</p>
                        </div>
                      ))}
                    </div>
                  ) : <p className="mt-4 rounded-xl bg-slate-100 p-4 text-slate-600">Scoring activity will appear here as your teams play.</p>}
                </section>
              </>
            )}
          </section>

          <aside className="space-y-6">
            {!draftIsPrimary && draft && (
              <section className="rounded-xl bg-white p-5 shadow">
                <p className="text-xs font-black uppercase tracking-widest text-slate-500">League context</p>
                <h2 className="mt-1 text-xl font-black">Draft Complete</h2>
                <p className="mt-2 text-sm text-slate-600">You drafted {myPicks.length} teams from position {mySlot ? `#${mySlot.draft_position}` : "TBD"}.</p>
                <Link href={`/draft/${draft.id}`} className="mt-4 block rounded-lg border-2 border-blue-800 px-4 py-2 text-center font-black text-blue-800 hover:bg-blue-50">View Draft Results</Link>
              </section>
            )}
            <section className="rounded-xl bg-white p-5 shadow"><TeamNameForm leagueId={league.id} initialName={membership.team_name} /></section>
            <section className="rounded-xl bg-white p-5 shadow">
              <h2 className="text-xl font-black">League Roster</h2>
              <div className="mt-4 space-y-3">{roster.members.map((member) => <div key={member.id}><p className="font-semibold">{member.profile?.display_name ?? "Owner"}</p><p className="text-sm text-slate-500">{member.team_name ?? "Team name not set"}</p></div>)}</div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
