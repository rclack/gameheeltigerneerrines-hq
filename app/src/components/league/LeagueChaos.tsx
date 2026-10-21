"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  buildChaosFeed, CHAOS_LABELS, chaosCopy, chaosObservedLabel, chaosStatus,
  type ChaosFeedItem, type ChaosFeedResponse,
} from "@/lib/chaos/presentation";

const REFRESH_MS = 180_000;
const EMPTY: ChaosFeedResponse = { active: [], transitions: [], nextCursor: null };
const SEVERITY_STYLE = {
  info: "border-slate-200 bg-slate-50 text-slate-700",
  notable: "border-blue-200 bg-blue-50 text-blue-900",
  major: "border-orange-300 bg-orange-50 text-orange-950",
  chaos: "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-950",
};

function EventLink({ item, leagueId }: { item: ChaosFeedItem; leagueId: string }) {
  const href = item.gameId ? `/league/${leagueId}/games/${item.gameId}` : `/league/${leagueId}/standings`;
  return <Link href={href} className="inline-flex min-h-11 items-center text-sm font-black text-blue-800 hover:underline">{item.gameId ? "Open Game Room" : "View standings"} →</Link>;
}

function EventCard({ item, leagueId }: { item: ChaosFeedItem; leagueId: string }) {
  const copy = chaosCopy(item);
  const status = chaosStatus(item);
  return (
    <article className={`min-w-0 rounded-xl border p-4 ${SEVERITY_STYLE[item.severity]}`} aria-label={`${CHAOS_LABELS[item.eventType] ?? "League Chaos"}: ${status}`}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-xs font-black uppercase tracking-[0.14em]">{CHAOS_LABELS[item.eventType] ?? "League Chaos"}</p>
          <p className="mt-1 break-words text-lg font-black text-blue-950">{copy.headline}</p>
        </div>
        <span className="shrink-0 rounded-full border border-current/20 bg-white/70 px-2.5 py-1 text-[11px] font-black uppercase">{item.severity}</span>
      </div>
      <p className="mt-2 break-words text-sm font-semibold">{copy.impact}</p>
      {item.lifecycle === "suspended" && <p className="mt-3 rounded-lg bg-white/70 p-3 text-sm font-bold">Last trusted state shown. This is not a current football update.</p>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-current/10 pt-3 text-xs font-bold">
        <span>{status}</span><time dateTime={item.observedAt}>{chaosObservedLabel(item.observedAt)}</time>
      </div>
      <EventLink item={item} leagueId={leagueId} />
    </article>
  );
}

export default function LeagueChaos({ leagueId, fixture = null }: { leagueId: string; fixture?: ChaosFeedResponse | null }) {
  const [data, setData] = useState<ChaosFeedResponse | null>(fixture);
  const [loading, setLoading] = useState(!fixture);
  const [failed, setFailed] = useState(false);
  const [includeInfo, setIncludeInfo] = useState(false);
  const [visibleActive, setVisibleActive] = useState(6);
  const [visibleRecent, setVisibleRecent] = useState(4);

  const refresh = useCallback(async () => {
    if (fixture) return;
    try {
      const response = await fetch(`/api/leagues/${leagueId}/chaos`, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(`chaos_read_${response.status}`);
      setData(await response.json() as ChaosFeedResponse);
      setFailed(false);
    } catch (error) {
      console.error("[league-chaos-ui]", error instanceof Error ? error.message : "read_failed");
      setFailed(true);
    } finally { setLoading(false); }
  }, [fixture, leagueId]);

  useEffect(() => {
    if (fixture) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, REFRESH_MS);
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisibility); };
  }, [fixture, refresh]);

  const model = useMemo(() => buildChaosFeed(data ?? EMPTY, includeInfo), [data, includeInfo]);
  const empty = !loading && model.active.length === 0 && model.recent.length === 0;
  return (
    <section className="rounded-2xl bg-white p-5 shadow" aria-labelledby="league-chaos-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-black uppercase tracking-widest text-fuchsia-700">Live league movement</p><h2 id="league-chaos-heading" className="mt-1 text-2xl font-black">League Chaos</h2></div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-black text-blue-800 disabled:opacity-50">Refresh</button>
      </div>
      <p className="mt-2 text-sm text-slate-600">Provisional moments from certified live league facts. Official points still settle through league scoring.</p>
      {loading && <div className="mt-4 space-y-3" aria-label="Loading League Chaos"><div className="h-28 animate-pulse rounded-xl bg-slate-100" /><div className="h-20 animate-pulse rounded-xl bg-slate-100" /></div>}
      {failed && <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4"><p className="font-black text-amber-950">League Chaos is temporarily unavailable.</p><p className="mt-1 text-sm text-amber-900">The Watchlist and official scoring are unaffected.</p><button type="button" onClick={() => void refresh()} className="mt-2 min-h-11 font-black text-blue-800 hover:underline">Try again</button></div>}
      {empty && !failed && <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5"><p className="text-xl font-black text-blue-950">It&apos;s quiet. For now.</p><p className="mt-2 max-w-2xl text-slate-600">When a Captain swings a matchup, someone climbs the standings, or a big upset threatens your league, you&apos;ll see it here.</p></div>}
      {!loading && (model.active.length > 0 || model.recent.length > 0) && <>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-black uppercase tracking-widest text-slate-500">Notable, major, and chaos-level moments</p>
          <button type="button" onClick={() => setIncludeInfo((value) => !value)} className="min-h-11 text-sm font-black text-blue-800 hover:underline">{includeInfo ? "Hide info-level events" : "Show all events"}</button>
        </div>
        {model.active.length > 0 && <div className="mt-3"><h3 className="text-lg font-black text-blue-950">Happening Now</h3><div className="mt-3 grid gap-3 lg:grid-cols-2">{model.active.slice(0, visibleActive).map((item) => <EventCard key={item.episodeId} item={item} leagueId={leagueId} />)}</div>{model.active.length > visibleActive && <button type="button" onClick={() => setVisibleActive((value) => value + 6)} className="mt-3 min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-black text-blue-800">Show more happening now</button>}</div>}
        {model.recent.length > 0 && <div className="mt-5"><h3 className="text-lg font-black text-blue-950">Recent Chaos</h3><div className="mt-3 grid gap-3 lg:grid-cols-2">{model.recent.slice(0, visibleRecent).map((item) => <EventCard key={`${item.episodeId}:${item.id}`} item={item} leagueId={leagueId} />)}</div>{model.recent.length > visibleRecent && <button type="button" onClick={() => setVisibleRecent((value) => value + 4)} className="mt-3 min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-black text-blue-800">Show more</button>}</div>}
      </>}
      <p className="mt-4 text-xs font-semibold text-slate-500">Refreshes every 3 minutes while this page is visible.</p>
    </section>
  );
}
