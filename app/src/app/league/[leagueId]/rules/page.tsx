import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { groupScoringRules, scoringPointsLabel } from "@/lib/league/scoring-rules-display";
import { createClient } from "@/lib/supabase/server";
import { getScoringRules } from "@/services/scoringService";

function availabilityLabel(value: number | null, singular: string) {
  if (value === null) return "Not active";
  return `${value} ${value === 1 ? singular : `${singular}s`}`;
}

export default async function ScoringRulesPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/league/${leagueId}/rules`)}`);

  const [{ data: league }, { data: membership }, rules] = await Promise.all([
    supabase.from("leagues").select("*").eq("id", leagueId).maybeSingle(),
    supabase.from("league_members").select("id").eq("league_id", leagueId).eq("user_id", user.id).maybeSingle(),
    getScoringRules(supabase, leagueId),
  ]);
  if (!league || !membership) notFound();

  const groups = groupScoringRules(rules);
  const lineupActive = league.starters_per_week !== null && league.lineups_enabled_from_week !== null;
  const captainActive = league.captain_uses_per_team !== null && league.captain_enabled_from_week !== null;

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b-4 border-orange-500 bg-blue-950 text-white">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          <Link href={`/league/${league.id}`} className="text-sm font-bold text-blue-200 hover:text-white">← League Home</Link>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.22em] text-orange-300">Official owner guide</p>
          <h1 className="mt-1 text-3xl font-black sm:text-4xl">How Scoring Works</h1>
          <p className="mt-2 max-w-3xl text-blue-100">The active {league.name} rubric for the {league.season} season. Point values below come directly from the same scoring-rule records used by the scoring ledger.</p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:px-6 sm:py-8">
        <section className="overflow-hidden rounded-2xl bg-white shadow-lg" aria-labelledby="official-total-heading">
          <div className="bg-gradient-to-r from-orange-500 to-orange-400 p-5 text-white sm:p-6">
            <p className="text-xs font-black uppercase tracking-widest text-orange-950">The short version</p>
            <h2 id="official-total-heading" className="mt-1 text-2xl font-black">How your official total is built</h2>
          </div>
          <div className="grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-white p-5"><p className="text-2xl font-black text-orange-600">1</p><h3 className="mt-1 font-black">Earn rule points</h3><p className="mt-2 text-sm leading-6 text-slate-600">A final game can trigger more than one applicable rule. Ranked tiers and the G5/Power result are separate awards and can stack.</p></div>
            <div className="bg-white p-5"><p className="text-2xl font-black text-orange-600">2</p><h3 className="mt-1 font-black">Starter status decides</h3><p className="mt-2 text-sm leading-6 text-slate-600">Only scoring earned by an active starter for that team&apos;s game and week counts in My Score and the standings.</p></div>
            <div className="bg-white p-5"><p className="text-2xl font-black text-orange-600">3</p><h3 className="mt-1 font-black">Captain can double it</h3><p className="mt-2 text-sm leading-6 text-slate-600">If the starter is your locked Captain, every positive and negative point from that team/game is doubled after normal scoring is calculated.</p></div>
            <div className="bg-white p-5"><p className="text-2xl font-black text-orange-600">4</p><h3 className="mt-1 font-black">The ledger is official</h3><p className="mt-2 text-sm leading-6 text-slate-600">Standings add final, active, counting ledger points. Voided records and bench potential do not count.</p></div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2" aria-label="Weekly lineup scoring rules">
          <article className="rounded-2xl border-2 border-blue-800 bg-white p-5 shadow sm:p-6">
            <p className="text-xs font-black uppercase tracking-widest text-blue-700">Weekly lineup</p>
            <h2 className="mt-1 text-2xl font-black">Start / Bench</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 text-center">
              <div className="rounded-xl bg-blue-950 p-3 text-white"><p className="text-2xl font-black">{availabilityLabel(league.starters_per_week, "starter")}</p><p className="text-xs text-blue-200">Maximum each week</p></div>
              <div className="rounded-xl bg-slate-100 p-3"><p className="text-2xl font-black">{Math.max(league.teams_per_owner - (league.starters_per_week ?? league.teams_per_owner), 0)}</p><p className="text-xs text-slate-500">Bench slots when all play</p></div>
            </div>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-700">
              <li>• Each team stays editable until its own scheduled kickoff. An early game does not freeze later teams.</li>
              <li>• Bye, canceled, postponed, and no-game teams are not eligible starters. A week may have empty starter slots when too few owned teams play.</li>
              <li>• Benched-team results can appear in My Score as potential, non-counting points so you can see the lineup impact. They add zero to the official total.</li>
              <li>• Week 0 is a full scoring and lineup week. Week 1 may carry eligible Week 0 starters forward.</li>
            </ul>
            {!lineupActive && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-900">Start/Bench is not active for this league; legacy all-owned-teams counting applies.</p>}
          </article>

          <article className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-5 shadow sm:p-6">
            <p className="text-xs font-black uppercase tracking-widest text-amber-800">Weekly boost</p>
            <h2 className="mt-1 text-2xl font-black">★ Captain&apos;s Choice</h2>
            <div className="mt-4 rounded-xl bg-amber-400 p-4 text-amber-950"><p className="text-3xl font-black">2×</p><p className="font-bold">all positive and negative team/game scoring</p></div>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-700">
              <li>• Captain is optional each week and must be one of your starters.</li>
              <li>• Bench and no-game teams cannot be Captain.</li>
              <li>• Selection locks at that Captain team&apos;s individual kickoff. Before kickoff, you may change or clear it.</li>
              <li>• This league allows {availabilityLabel(league.captain_uses_per_team, "Captain use")} per owned team for the season. A future choice reserves a use; it becomes used when locked.</li>
            </ul>
            {captainActive && league.captain_usage_policy === "optional" && <p className="mt-4 rounded-lg border border-amber-300 bg-white/70 p-3 text-sm font-bold text-amber-950">No Captain is required in any individual week. Unused opportunities may expire.</p>}
            {!captainActive && <p className="mt-4 rounded-lg border border-amber-300 bg-white/70 p-3 text-sm font-bold text-amber-950">Captain&apos;s Choice is not active for this league.</p>}
          </article>
        </section>

        <section className="rounded-2xl bg-blue-950 p-5 text-white shadow sm:p-6" aria-labelledby="rankings-heading">
          <p className="text-xs font-black uppercase tracking-widest text-orange-300">Game-result context</p>
          <h2 id="rankings-heading" className="mt-1 text-2xl font-black">Rankings, Power &amp; G5</h2>
          <div className="mt-4 grid gap-4 text-sm leading-6 text-blue-100 md:grid-cols-3">
            <div className="rounded-xl bg-white/10 p-4"><h3 className="font-black text-white">Pregame ranking</h3><p className="mt-1">Ranked-win rules use the authoritative ranking snapshot captured for that game—not a team&apos;s ranking after the result. The AP Top 25 is used before the configured CFP rankings transition; CFP rankings are used afterward.</p></div>
            <div className="rounded-xl bg-white/10 p-4"><h3 className="font-black text-white">Ranked tiers stack</h3><p className="mt-1">A win over No. 5 or better earns Win, Win over ranked, Win over Top 15, and Win over Top 5. A win over No. 6–15 earns the first three; No. 16–25 earns Win plus Win over ranked.</p></div>
            <div className="rounded-xl bg-white/10 p-4"><h3 className="font-black text-white">Power / G5 result</h3><p className="mt-1">Conference classifications for the season determine Power and G5 status. A G5 win over a Power team adds the G5 bonus, and that Power team also receives the listed upset-loss penalty.</p></div>
          </div>
        </section>

        <section aria-labelledby="rubric-heading">
          <div><p className="text-xs font-black uppercase tracking-widest text-orange-600">Authoritative rulebook</p><h2 id="rubric-heading" className="mt-1 text-2xl font-black">Active Scoring Rubric</h2><p className="mt-2 text-sm text-slate-600">All active rules are shown. Each rule creates its own ledger event when its condition is recorded.</p></div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {groups.map((group) => (
              <section key={group.category} className="overflow-hidden rounded-2xl bg-white shadow" aria-labelledby={`category-${group.category}`}>
                <div className="border-b border-slate-200 p-5"><p className="text-xs font-black uppercase tracking-widest text-orange-600">{group.eyebrow}</p><h3 id={`category-${group.category}`} className="mt-1 text-xl font-black capitalize">{group.title}</h3></div>
                <div className="divide-y divide-slate-200">
                  {group.rules.map((rule) => <article key={rule.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 p-4 sm:p-5"><div><h4 className="font-black text-blue-950">{rule.display_name}</h4><p className="mt-1 text-sm leading-5 text-slate-600">{rule.description}</p></div><span className={`${rule.points < 0 ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"} h-fit whitespace-nowrap rounded-full px-3 py-1 text-sm font-black`}>{scoringPointsLabel(rule.points)}</span></article>)}
                </div>
              </section>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-300 bg-white p-5 shadow sm:p-6" aria-labelledby="adjustments-heading">
          <p className="text-xs font-black uppercase tracking-widest text-slate-500">Corrections &amp; adjustments</p>
          <h2 id="adjustments-heading" className="mt-1 text-xl font-black">Commissioner-recorded scoring</h2>
          <p className="mt-3 text-sm leading-6 text-slate-700">Commissioners can record active non-game results—such as postseason, award, coaching, or season-statistical rules—and can void a mistaken manual record only with a reason. A manual event tied to a team and week follows that historical Start/Bench eligibility; a season-level administrative event with no week keeps league-level counting behavior. Corrections preserve the scoring ledger&apos;s audit history.</p>
        </section>
      </div>
    </main>
  );
}
