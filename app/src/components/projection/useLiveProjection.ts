"use client";

import { useCallback, useEffect, useState } from "react";

import type { LiveProjectionResult } from "@/lib/projection/live-projection";
import { LIVE_PROJECTION_REFRESH_MS } from "@/lib/projection/presentation";

export function useLiveProjection(leagueId: string, fixtureProjection: LiveProjectionResult | null = null) {
  const [projection, setProjection] = useState<LiveProjectionResult | null>(fixtureProjection);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [clock, setClock] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    if (fixtureProjection) return;
    try {
      const response = await fetch(`/api/leagues/${leagueId}/live-projection`, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(`projection_read_${response.status}`);
      setProjection(await response.json() as LiveProjectionResult);
      setRefreshFailed(false);
      setClock(Date.now());
    } catch (error) {
      console.error("[live-projection-ui]", error instanceof Error ? error.message : "read_failed");
      setProjection(null);
      setRefreshFailed(true);
    }
  }, [fixtureProjection, leagueId]);

  useEffect(() => {
    if (fixtureProjection) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, LIVE_PROJECTION_REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fixtureProjection, refresh]);

  return { projection, refreshFailed, clock, refresh };
}
