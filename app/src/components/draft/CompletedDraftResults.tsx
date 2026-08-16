import Link from "next/link";

import TeamLogo from "@/components/team/TeamLogo";
import type { DraftRoomData, DraftSelection } from "@/services/draftService";

interface CompletedDraftResultsProps {
  data: DraftRoomData;
  returningToLeague: boolean;
}

export default function CompletedDraftResults({ data, returningToLeague }: CompletedDraftResultsProps) {
  const participants = [...data.participants].sort((a, b) => a.draft_position - b.draft_position);
  const picks = [...data.picks].sort((a, b) => a.overall_pick - b.overall_pick);
  const picksByMember = new Map<string, DraftSelection[]>();
  const picksByRound = new Map<number, DraftSelection[]>();

  for (const pick of picks) {
    const memberPicks = picksByMember.get(pick.league_member_id) ?? [];
    memberPicks.push(pick);
    picksByMember.set(pick.league_member_id, memberPicks);

    const roundPicks = picksByRound.get(pick.round_number) ?? [];
    roundPicks.push(pick);
    picksByRound.set(pick.round_number, roundPicks);
  }

  const roundCount = picksByRound.size;

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-orange-500/30 bg-[#071d3d]">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-xl font-black text-emerald-300" aria-hidden="true">✓</span>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-orange-300">Draft Complete</p>
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">{data.league.name} Draft Results</h1>
              <p className="mt-3 text-base text-blue-100 sm:text-lg">All selections are in. Rosters are set for the {data.league.season} season.</p>
            </div>
            <Link href={`/league/${data.league.id}`} className="inline-flex min-h-12 items-center justify-center rounded-lg bg-orange-500 px-6 py-3 font-black text-slate-950 shadow-lg shadow-orange-950/20 transition hover:bg-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:ring-offset-2 focus-visible:ring-offset-blue-950">
              Return to League Home
            </Link>
          </div>

          <dl className="mt-8 grid grid-cols-3 gap-2 border-t border-white/10 pt-5 sm:max-w-xl sm:gap-4">
            <div><dt className="text-xs font-bold uppercase tracking-wider text-blue-300">Owners</dt><dd className="mt-1 text-2xl font-black">{participants.length}</dd></div>
            <div><dt className="text-xs font-bold uppercase tracking-wider text-blue-300">Rounds</dt><dd className="mt-1 text-2xl font-black">{roundCount}</dd></div>
            <div><dt className="text-xs font-bold uppercase tracking-wider text-blue-300">Selections</dt><dd className="mt-1 text-2xl font-black">{picks.length}</dd></div>
          </dl>
        </div>
      </header>

      {returningToLeague ? <p role="status" className="bg-emerald-700 px-4 py-3 text-center text-sm font-bold text-white">Draft complete! Returning to your league…</p> : null}

      <div className="mx-auto max-w-7xl space-y-10 px-4 py-8 sm:px-6 sm:py-10">
        <section aria-labelledby="final-board-title">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-400">Final Board</p>
            <h2 id="final-board-title" className="mt-1 text-2xl font-black sm:text-3xl">Rosters by Draft Position</h2>
            <p className="mt-2 text-sm text-slate-400">Every owner&apos;s final roster, ordered by the original draft draw.</p>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {participants.map((participant) => {
              const ownerPicks = picksByMember.get(participant.league_member_id) ?? [];
              const isCurrentUser = participant.member.user_id === data.currentUserId;

              return (
                <article key={participant.id} className={`overflow-hidden rounded-2xl border bg-slate-900 shadow-lg ${isCurrentUser ? "border-orange-400 ring-1 ring-orange-400/40" : "border-slate-800"}`}>
                  <div className={`flex items-start gap-4 border-b p-4 sm:p-5 ${isCurrentUser ? "border-orange-400/30 bg-orange-500/10" : "border-slate-800 bg-slate-900"}`}>
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-950 font-mono text-lg font-black text-orange-300">#{participant.draft_position}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-lg font-black">{participant.profile?.display_name ?? "Owner"}</h3>
                        {isCurrentUser ? <span className="rounded-full bg-orange-400 px-2 py-0.5 text-[0.65rem] font-black uppercase tracking-wider text-slate-950">You</span> : null}
                      </div>
                      {participant.member.team_name ? <p className="mt-0.5 truncate text-sm font-semibold text-slate-400">{participant.member.team_name}</p> : null}
                    </div>
                  </div>
                  <ol className="divide-y divide-slate-800">
                    {ownerPicks.map((pick) => (
                      <li key={pick.id} className="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
                        <div className="flex min-w-0 items-center gap-3"><TeamLogo team={pick.team} size="sm" decorative /><div className="min-w-0">
                          <p className="truncate font-bold text-slate-100">{pick.team.school_name}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{pick.team.conference}</p>
                        </div></div>
                        <p className="shrink-0 text-right text-xs font-bold text-slate-400">Round {pick.round_number}<br /><span className="font-mono text-orange-300">Pick #{pick.overall_pick}</span></p>
                      </li>
                    ))}
                  </ol>
                </article>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-lg sm:p-6" aria-labelledby="pick-history-title">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-400">Official Record</p>
          <h2 id="pick-history-title" className="mt-1 text-2xl font-black">Pick History</h2>
          <p className="mt-2 text-sm text-slate-400">Every selection in chronological order.</p>

          <div className="mt-6 space-y-7">
            {Array.from(picksByRound.entries()).map(([round, roundPicks]) => (
              <section key={round} aria-labelledby={`round-${round}-title`}>
                <div className="flex items-center gap-3">
                  <h3 id={`round-${round}-title`} className="shrink-0 text-sm font-black uppercase tracking-wider text-blue-200">Round {round}</h3>
                  <div className="h-px flex-1 bg-slate-800" />
                </div>
                <ol className="mt-3 grid gap-2 md:grid-cols-2">
                  {roundPicks.map((pick) => (
                    <li key={pick.id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
                      <span className="w-10 shrink-0 font-mono text-sm font-black text-orange-400">#{pick.overall_pick}</span>
                      <TeamLogo team={pick.team} size="sm" decorative />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold">{pick.team.school_name}</p>
                        <p className="truncate text-sm text-slate-400">{pick.participant?.profile?.display_name ?? "Owner"}{pick.participant?.member.team_name ? ` · ${pick.participant.member.team_name}` : ""}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
