// components/dashboard/series-hydrator.tsx
//
// Server component. Awaits the chart series and then hydrates the
// in-tree SeriesProvider with the resolved pack.
//
// Why this exists:
//   * Phase 3C-1 ships the chart toggle on four sections. Tiles render
//     instantly from the page's primary-period engine run; the series
//     across the trailing 6 periods takes ~30 db roundtrips total and
//     must NOT block first paint.
//   * The page wraps <SeriesHydrator promise={...} /> in <Suspense>.
//     React streams the fallback first (primary tiles), then this
//     component when the promise resolves.
//   * On resolution, this server component renders <SeriesPusher
//     pack=... /> — a tiny client component that calls
//     useSeriesSetter to push the data into the SeriesProvider store
//     above it in the tree.
//
// Why a client "pusher" instead of plain props:
//   * The toggle (a sibling client component) lives in the section
//     header, mounted with the tiles. It can't receive series via the
//     same prop chain because the server-side data fetch is suspended.
//   * Context fixes the tree problem; the pusher converts "series
//     resolved on the server" into "context state updated on the
//     client."
//
// Boundary discipline:
//   * This file is a server component but imports a "use client"
//     sibling — fine; that's the boundary.
//   * Receives the resolved SeriesPack as a value (the caller does the
//     await), not as a Promise. Async data flow stays inside the
//     server-side composition.

import * as React from "react";

import type { SeriesPack } from "@/app/(dashboard)/_lib/series";
import { SeriesPusher } from "./series-pusher";

export type SeriesHydratorProps = {
  /** Server-resolved series pack (or a Promise the caller awaits
   * before passing). When the caller wraps this component in
   * <Suspense>, React streams while the promise is pending. */
  pack: SeriesPack;
};

/** Server component. Pushes the resolved pack into the SeriesProvider
 * store via the SeriesPusher client island. */
export function SeriesHydrator({ pack }: SeriesHydratorProps) {
  return <SeriesPusher pack={pack} />;
}
