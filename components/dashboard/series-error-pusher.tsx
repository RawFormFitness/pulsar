"use client";

// components/dashboard/series-error-pusher.tsx
//
// Tiny client island. Companion to series-pusher.tsx but for the
// failure path: when fetchSeries() throws inside the AwaitSeriesHydrator
// server-component awaiter, we render this instead. It pushes the
// SeriesProvider into its "error" state on mount.
//
// Why a separate island instead of a prop on SeriesPusher:
//   * Symmetry — SeriesPusher carries a SeriesPack, this carries a
//     message string. Their interfaces are different and bundling them
//     would mean passing one or the other as undefined.
//   * Server-side awaiter chooses which to render based on try/catch,
//     so the boundary is clean: one island per outcome.
//
// What happens visually:
//   * Tile view (the default) is unaffected — tiles read from the
//     primary-period MetricsPack, which the server already resolved.
//   * Chart view (toggle on) for any of the four chartable sections
//     shows the destructive-styled "Could not load trend data." banner
//     handled by ChartToggleBody (section-chart-toggle.tsx:182-187).

import * as React from "react";
import { useSeriesSetter } from "./series-context";

export function SeriesErrorPusher({ message }: { message: string }) {
  const setSeries = useSeriesSetter();
  React.useEffect(() => {
    setSeries({ status: "error", message });
  }, [message, setSeries]);
  return null;
}
