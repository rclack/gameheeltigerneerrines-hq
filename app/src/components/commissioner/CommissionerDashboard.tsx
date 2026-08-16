import Link from "next/link";

import type { DraftParticipant } from "@/services/draftService";
import type { LeagueRoster } from "@/services/membershipService";
import type { Draft, League } from "@/types/database";
import type { DraftRosterSlotDetail } from "@/lib/draft/roster-rules";
import DraftSetup from "./DraftSetup";
import OwnerManagement from "./OwnerManagement";

interface CommissionerDashboardProps {
  league: League;
  roster?: LeagueRoster;
  draft?: Draft | null;
  participants?: DraftParticipant[];
  pickCount?: number;
  siteOrigin?: string;
  rosterRules?: DraftRosterSlotDetail[];
}

function formatDraftStatus(status: Draft["status"] | undefined) {
  if (!status || status === "not_started") return "Preseason";
  return status.replace("_", " ");
}

export default function CommissionerDashboard({
  league,
  roster,
  draft = null,
  participants = [],
  pickCount = 0,
  siteOrigin,
  rosterRules = [],
}: CommissionerDashboardProps) {
  const activeInvitations = roster?.invitations.filter(
    (invitation) => invitation.status === "pending" && new Date(invitation.expires_at) > new Date(),
  ) ?? [];
  const memberCount = roster?.members.length ?? 1;
  const totalPicks = league.owner_count * league.teams_per_owner;
  const ownerProgress = Math.min((memberCount / league.owner_count) * 100, 100);
  const draftProgress = totalPicks ? Math.min((pickCount / totalPicks) * 100, 100) : 0;
  const draftStatus = formatDraftStatus(draft?.status);
  const draftIsOpen = draft && draft.status !== "not_started";
  const draftIsComplete = draft?.status === "complete";
  const ownersReady = memberCount === league.owner_count && activeInvitations.length === 0;
  const draftOrderReady = participants.length === league.owner_count;
  const operationsFocus = draftIsComplete
    ? "results"
    : memberCount < league.owner_count || activeInvitations.length > 0
      ? "owners"
      : draft?.status === "live" || draft?.status === "paused"
        ? "admin"
        : "draft";
  const operationCardClass = (module: typeof operationsFocus) =>
    `flex min-h-56 flex-col rounded-2xl bg-white p-5 shadow-sm transition ${
      operationsFocus === module
        ? "border-2 border-orange-300 ring-4 ring-orange-100/70"
        : "border border-slate-200"
    }`;
  const journey = [
    { label: "League created", complete: true, current: !ownersReady },
    { label: "Owners ready", complete: ownersReady, current: ownersReady && !draftOrderReady },
    { label: "Draft order", complete: draftOrderReady, current: draftOrderReady && !draftIsOpen },
    { label: "Draft night", complete: draftIsComplete, current: Boolean(draftIsOpen && !draftIsComplete) },
    { label: "Season", complete: false, current: draftIsComplete },
  ];
  const nextAction = !ownersReady
    ? { message: "Fill every owner spot and resolve pending invitations.", href: "#owner-management", label: "Manage owners" }
    : !draftOrderReady
      ? { message: "Save a random or manual draft order for every accepted owner.", href: "#draft-operations", label: "Set draft order" }
      : !draftIsOpen
        ? { message: "Review the saved order, then start the draft when every owner is ready.", href: "#draft-operations", label: "Review draft setup" }
        : !draftIsComplete
          ? { message: "The draft is underway. Monitor the room and keep picks moving.", href: `/draft/${draft.id}`, label: "Enter draft room" }
          : { message: "Draft setup is complete. Schedule sync and scoring are your active season operations.", href: `/commissioner/${league.id}/scoring`, label: "Open scoring desk" };

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="relative overflow-hidden bg-[#061a38] text-white shadow-xl">
        <div className="pointer-events-none absolute inset-0 opacity-30" aria-hidden="true">
          <div className="absolute -right-24 -top-32 h-96 w-96 rounded-full border-[52px] border-white/5" />
          <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
          <div className="absolute bottom-0 left-0 h-px w-full bg-orange-400/60" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          <nav className="flex items-center justify-between gap-4" aria-label="Commissioner navigation">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-orange-300/40 bg-orange-500 font-black tracking-tight shadow-lg shadow-orange-950/30">
                GH
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-black uppercase tracking-[0.18em] text-white">Commissioner HQ</p>
                <p className="truncate text-xs text-blue-200">College Football League Operations</p>
              </div>
            </div>
            <Link
              href={`/league/${league.id}`}
              className="shrink-0 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-bold text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 sm:px-4"
            >
              View League
            </Link>
          </nav>

          <div className="mt-7 grid gap-6 pb-5 lg:grid-cols-[1fr_22rem] lg:items-end">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.16em]">
                <span className="rounded-full bg-orange-500 px-3 py-1 text-white">{league.season} Season</span>
                <span className="rounded-full border border-blue-300/25 bg-blue-900/50 px-3 py-1 text-blue-100 capitalize">{draftStatus}</span>
                <span className="text-blue-200">Commissioner Control</span>
              </div>
              <p className="mt-4 text-sm font-bold uppercase tracking-[0.2em] text-orange-300">League Command Center</p>
              <h1 className="mt-1.5 max-w-4xl text-4xl font-black tracking-tight text-white sm:text-5xl">
                {league.name}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-blue-100 sm:text-base">
                Manage your roster, run the college team draft, and keep the season moving from one central sideline.
              </p>
            </div>

            <div className="rounded-2xl border border-white/15 bg-white/10 p-5 shadow-2xl shadow-black/20 backdrop-blur-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-300">{draftIsComplete ? "Draft recap" : "Next up"}</p>
                  <h2 className="mt-1 text-xl font-black">{draftIsComplete ? "Draft Complete" : "Draft Room"}</h2>
                </div>
                <span className="rounded-md bg-slate-950/50 px-2.5 py-1 font-mono text-xs font-bold uppercase text-blue-100">{draftStatus}</span>
              </div>
              <p className="mt-3 text-sm leading-5 text-blue-100">
                {draftIsComplete
                  ? "The board is final. Review every selection and move into season operations."
                  : draftIsOpen
                    ? "The board is active. Enter the room to monitor picks and keep owners on schedule."
                    : "Finalize owners and draft order below, then start the league's headline event."}
              </p>
              {draftIsOpen ? (
                <Link
                  href={`/draft/${draft.id}`}
                  className="mt-5 block rounded-xl bg-orange-500 px-5 py-3 text-center text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-orange-950/30 transition hover:bg-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#061a38]"
                >
                  {draftIsComplete ? "Review Draft Results" : "Enter Draft Room"}
                </Link>
              ) : (
                <a
                  href="#draft-operations"
                  className="mt-5 block rounded-xl bg-orange-500 px-5 py-3 text-center text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-orange-950/30 transition hover:bg-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#061a38]"
                >
                  Prepare the Draft
                </a>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <section className="mb-10 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="league-journey-title">
          <div className="border-b border-slate-200 px-5 py-4 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:px-6">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">Commissioner checklist</p>
              <h2 id="league-journey-title" className="mt-1 text-xl font-black tracking-tight text-slate-950">League Journey</h2>
            </div>
            <a href={nextAction.href} className="mt-3 inline-flex rounded-lg bg-[#0b2b59] px-4 py-2.5 text-sm font-black text-white transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 sm:mt-0">
              {nextAction.label}
            </a>
          </div>
          <ol className="grid gap-px bg-slate-200 sm:grid-cols-5">
            {journey.map((stage, index) => (
              <li key={stage.label} className={`bg-white px-4 py-4 ${stage.current ? "shadow-[inset_0_-3px_0_#f97316]" : ""}`}>
                <div className="flex items-center gap-3">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ${stage.complete ? "bg-emerald-100 text-emerald-800" : stage.current ? "bg-orange-500 text-white" : "bg-slate-100 text-slate-500"}`} aria-hidden="true">
                    {stage.complete ? "✓" : index + 1}
                  </span>
                  <div>
                    <p className={`text-sm font-black ${stage.current ? "text-slate-950" : "text-slate-600"}`}>{stage.label}</p>
                    <p className="text-xs text-slate-500">{stage.complete ? "Complete" : stage.current ? "Current step" : "Coming next"}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <p className="bg-slate-50 px-5 py-3 text-sm font-medium text-slate-700 sm:px-6"><span className="font-black text-slate-950">Next:</span> {nextAction.message}</p>
        </section>

        <section aria-labelledby="league-overview-title">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">Live league snapshot</p>
              <h2 id="league-overview-title" className="mt-1 text-2xl font-black tracking-tight text-slate-950">League Overview</h2>
            </div>
            <p className="hidden text-sm text-slate-500 sm:block">Updated from your current league setup</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <article className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="absolute inset-y-0 left-0 w-1 bg-[#0b2b59]" aria-hidden="true" />
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Season</p>
              <p className="mt-3 text-3xl font-black tracking-tight text-[#0b2b59]">{league.season}</p>
              <p className="mt-2 text-sm text-slate-500">Official competition year</p>
            </article>

            <article className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="absolute inset-y-0 left-0 w-1 bg-orange-500" aria-hidden="true" />
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">League Status</p>
              <div className="mt-3 flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${draft?.status === "live" ? "animate-pulse bg-emerald-500" : "bg-orange-500"}`} aria-hidden="true" />
                <p className="text-2xl font-black capitalize tracking-tight text-slate-950">{draftStatus}</p>
              </div>
              <p className="mt-2 text-sm text-slate-500">Current phase of league play</p>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Owner Roster</p>
                  <p className="mt-3 text-3xl font-black tracking-tight text-[#0b2b59]">{memberCount}<span className="text-lg text-slate-400">/{league.owner_count}</span></p>
                </div>
                <span className="rounded-lg bg-blue-50 px-2 py-1 text-xs font-bold text-blue-800">{Math.round(ownerProgress)}%</span>
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label="Owner roster completion" aria-valuemin={0} aria-valuemax={league.owner_count} aria-valuenow={memberCount}>
                <div className="h-full rounded-full bg-[#0b2b59]" style={{ width: `${ownerProgress}%` }} />
              </div>
              <p className="mt-2 text-sm text-slate-500">Accepted league members</p>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Draft Board</p>
                  <p className="mt-3 text-3xl font-black tracking-tight text-[#0b2b59]">{pickCount}<span className="text-lg text-slate-400">/{totalPicks}</span></p>
                </div>
                <span className="rounded-lg bg-orange-50 px-2 py-1 text-xs font-bold text-orange-700">{Math.round(draftProgress)}%</span>
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label="Draft completion" aria-valuemin={0} aria-valuemax={totalPicks} aria-valuenow={pickCount}>
                <div className="h-full rounded-full bg-orange-500" style={{ width: `${draftProgress}%` }} />
              </div>
              <p className="mt-2 text-sm text-slate-500">College teams selected</p>
            </article>
          </div>
        </section>

        <section className="mt-10" aria-labelledby="league-operations-title">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">Quick access</p>
            <h2 id="league-operations-title" className="mt-1 text-2xl font-black tracking-tight">League Operations</h2>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <article className={operationCardClass("draft")}>
              <div className="flex items-center justify-between gap-2">
                <span className="w-fit rounded-md bg-blue-50 px-2 py-1 text-xs font-black uppercase tracking-wider text-blue-800">Draft</span>
                {operationsFocus === "draft" ? <span className="text-[0.65rem] font-black uppercase tracking-widest text-orange-700">Up next</span> : null}
              </div>
              <h3 className="mt-4 text-lg font-black">Draft Setup</h3>
              <p className="mt-2 text-sm leading-5 text-slate-500">Set the owner order, confirm readiness, and run draft night.</p>
              <a href="#draft-operations" className="mt-auto block rounded-lg bg-[#0b2b59] px-4 py-2.5 text-center text-sm font-bold text-white transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2">{draftIsComplete ? "Review Draft" : draftIsOpen ? "Manage Draft" : "Open Draft Setup"}</a>
            </article>

            <article className={operationCardClass("owners")}>
              <div className="flex items-center justify-between gap-2">
                <span className="w-fit rounded-md bg-slate-100 px-2 py-1 text-xs font-black uppercase tracking-wider text-slate-700">Roster</span>
                {operationsFocus === "owners" ? <span className="text-[0.65rem] font-black uppercase tracking-widest text-orange-700">Needs attention</span> : null}
              </div>
              <h3 className="mt-4 text-lg font-black">Owners</h3>
              <p className="mt-2 text-sm leading-5 text-slate-500">Invite owners, track open spots, and manage pending invitations.</p>
              <a href="#owner-management" className="mt-auto block rounded-lg bg-slate-800 px-4 py-2.5 text-center text-sm font-bold text-white transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2">Manage Owners</a>
            </article>

            <article className={operationCardClass("results")}>
              <div className="flex items-center justify-between gap-2">
                <span className="w-fit rounded-md bg-emerald-50 px-2 py-1 text-xs font-black uppercase tracking-wider text-emerald-800">Results</span>
                {operationsFocus === "results" ? <span className="text-[0.65rem] font-black uppercase tracking-widest text-orange-700">Current focus</span> : null}
              </div>
              <h3 className="mt-4 text-lg font-black">Season Results</h3>
              <p className="mt-2 text-sm leading-5 text-slate-500">Review the league table and your team&apos;s scoring breakdown.</p>
              <div className="mt-auto grid grid-cols-2 gap-2 pt-5">
                <Link href={`/league/${league.id}/standings`} className="rounded-lg bg-[#0b2b59] px-3 py-2.5 text-center text-sm font-bold text-white transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2">Standings</Link>
                <Link href={`/league/${league.id}/score`} className="rounded-lg bg-slate-100 px-3 py-2.5 text-center text-sm font-bold text-slate-800 transition hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2">My Score</Link>
              </div>
            </article>

            <article className={operationCardClass("admin")}>
              <div className="flex items-center justify-between gap-2">
                <span className="w-fit rounded-md bg-red-50 px-2 py-1 text-xs font-black uppercase tracking-wider text-red-800">Admin</span>
                {operationsFocus === "admin" ? <span className="text-[0.65rem] font-black uppercase tracking-widest text-orange-700">In season</span> : null}
              </div>
              <h3 className="mt-4 text-lg font-black">Scoring Administration</h3>
              <p className="mt-2 text-sm leading-5 text-slate-500">Sync game data, review outcomes, and process official league scoring.</p>
              <Link href={`/commissioner/${league.id}/scoring`} className="mt-auto rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-center text-sm font-bold text-red-800 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2">Open Scoring</Link>
            </article>
          </div>
        </section>

        {roster && siteOrigin ? (
          <OwnerManagement
            leagueId={league.id}
            ownerCount={league.owner_count}
            members={roster.members}
            invitations={roster.invitations}
            siteOrigin={siteOrigin}
          />
        ) : null}

        {roster ? (
          <DraftSetup
            leagueId={league.id}
            ownerCount={league.owner_count}
            teamsPerOwner={league.teams_per_owner}
            members={roster.members}
            invitations={roster.invitations}
            draft={draft}
            participants={participants}
            rosterRules={rosterRules}
          />
        ) : null}

        {roster && activeInvitations.length > 0 ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
            {activeInvitations.length} roster spot{activeInvitations.length === 1 ? " is" : "s are"} currently reserved by pending invitations.
          </p>
        ) : null}
      </div>
    </main>
  );
}
