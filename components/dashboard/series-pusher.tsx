"use client";

// components/dashboard/series-pusher.tsx
//
// Tiny client island. Receives the server-resolved SeriesPack and
// pushes it into the SeriesProvider store on mount.
//
// We keep this as its own file so the server-side SeriesHydrator can
// stay a server component while still triggering a client-side store
// update. The pusher renders nothing.

import * as React from "react";
import type { SeriesPack } from "@/app/(dashboard)/_lib/series";
import { useSeriesSetter } from "./series-context";

export function SeriesPusher({ pack }: { pack: SeriesPack }) {
  const setSeries = useSeriesSetter();
  // Push on mount and whenever the resolved pack reference changes
  // (e.g. user picks a new period — the page re-renders with a new
  // SeriesPack, and we update the store so the chart re-fetches).
  React.useEffect(() => {
    setSeries({ status: "ready", pack });
  }, [pack, setSeries]);
  return null;
}
