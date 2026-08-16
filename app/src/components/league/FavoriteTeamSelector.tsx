"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { updateFavoriteTeam, type FavoriteTeamState } from "@/app/league/[leagueId]/actions";
import TeamLogo from "@/components/team/TeamLogo";
import Button from "@/components/ui/Button";

interface FavoriteTeamOption {
  id: string;
  school_name: string;
  abbreviation: string;
  conference: string;
  primary_color: string | null;
  logo_url: string | null;
}

export default function FavoriteTeamSelector({
  leagueId,
  teams,
  favoriteTeamId,
}: {
  leagueId: string;
  teams: FavoriteTeamOption[];
  favoriteTeamId: string | null;
}) {
  const router = useRouter();
  const action = updateFavoriteTeam.bind(null, leagueId);
  const [state, formAction, pending] = useActionState(action, {} as FavoriteTeamState);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(favoriteTeamId ?? "");
  const selected = teams.find((team) => team.id === selectedId) ?? null;
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    return teams
      .filter((team) => !term || `${team.school_name} ${team.abbreviation} ${team.conference}`.toLowerCase().includes(term))
      .slice(0, 8);
  }, [query, teams]);

  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success, state.favoriteTeamId]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="favorite-team-heading">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100">{selected ? <TeamLogo team={selected} size="md" decorative /> : <span className="text-lg font-black text-blue-950">GH</span>}</span>
        <div className="min-w-0 flex-1"><p className="text-xs font-black uppercase tracking-widest text-slate-500">Favorite Program</p><h2 id="favorite-team-heading" className="truncate font-black">{selected?.school_name ?? "GameHeelTigerNeerRines default"}</h2></div>
      </div>
      <details className="mt-3 group">
        <summary className="cursor-pointer list-none rounded-lg border border-blue-800 px-4 py-2 text-center text-sm font-black text-blue-800 hover:bg-blue-50">{favoriteTeamId ? "Change favorite team" : "Choose a favorite team"}</summary>
        <p className="mt-3 text-sm text-slate-600">Choose any FBS team. This follows your account across leagues.</p>
        <form action={formAction} className="mt-3 space-y-3">
        <input type="hidden" name="favoriteTeamId" value={selectedId} />
        <label htmlFor="favorite-team-search" className="sr-only">Search FBS teams</label>
        <input
          id="favorite-team-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search schools or conferences"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
        />
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-1" aria-label="FBS team choices">
          {matches.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => { setSelectedId(team.id); setQuery(team.school_name); }}
              className={`${selectedId === team.id ? "border-blue-700 bg-blue-50 text-blue-950" : "border-transparent bg-white text-slate-700 hover:bg-slate-100"} flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100"><TeamLogo team={team} size="sm" decorative /></span>
              <span className="h-7 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: team.primary_color ?? "#172554" }} />
              <span className="min-w-0 flex-1"><span className="block truncate font-black">{team.school_name}</span><span className="block truncate text-xs opacity-70">{team.conference}</span></span>
              {selectedId === team.id && <span className="text-xs font-black uppercase">Selected</span>}
            </button>
          ))}
          {!matches.length && <p className="p-3 text-sm text-slate-500">No FBS teams match that search.</p>}
        </div>
        {selected && <p className="rounded-lg bg-slate-100 p-3 text-sm"><span className="font-black">Ready to save:</span> {selected.school_name}</p>}
        <div className="grid grid-cols-2 gap-2">
          <Button type="submit" disabled={pending || selectedId === favoriteTeamId}>{pending ? "Saving…" : "Save Favorite"}</Button>
          <button type="submit" name="favoriteTeamId" value="" onClick={() => setSelectedId("")} disabled={pending || !favoriteTeamId} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">Use Default</button>
        </div>
        {state.error && <p className="text-sm font-semibold text-red-700">{state.error}</p>}
        {state.success && <p className="text-sm font-semibold text-green-700">{state.success}</p>}
        </form>
      </details>
    </section>
  );
}
