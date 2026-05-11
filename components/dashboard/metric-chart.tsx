"use client";

// components/dashboard/metric-chart.tsx
//
// Multi-line trend chart for the metric-section chart toggle.
//
// Recharts is lazy-loaded:
//   * Bundle bloat is forever; first-toggle flicker is one-time. We
//     pull Recharts in via next/dynamic({ ssr: false }) so the initial
//     dashboard payload does not pay for a charting lib the user might
//     never open.
//   * The dynamic loader returns a placeholder while the chunk fetches
//     (a fixed-height skeleton, so the section doesn't visually jump
//     when the chart materializes).
//
// Universality:
//   * The component accepts an arbitrary `labels` list and per-period
//     `points`. No knowledge of channels, gym keys, or section names.
//   * Missing values are emitted as `null` upstream (see
//     app/(dashboard)/_lib/series.ts) and Recharts renders them as
//     line breaks via `connectNulls={false}`.
//
// Mobile responsiveness:
//   * `ResponsiveContainer` makes Recharts fluid horizontally.
//   * We cap the chart's vertical extent at 256px on small screens
//     and 320px from sm: up.

import * as React from "react";
import dynamic from "next/dynamic";

import type { SeriesPoint } from "@/app/(dashboard)/_lib/series";

export type MetricChartProps = {
  /** Series-line labels in draw order. Must match the keys present
   * in each point's `values`. */
  labels: string[];
  /** Points ordered OLDEST -> NEWEST. */
  points: SeriesPoint[];
  /** BCP-47 locale for tooltip number formatting. */
  locale?: string;
};

/** Series palette. CSS variables so a future theme can override; the
 * defaults match Tailwind v4 colors compiled at common shades. We
 * deliberately do NOT key by channel name — the i-th label gets the
 * i-th color, which keeps the component universal. */
const LINE_COLORS = [
  "var(--chart-1, #6366f1)", // indigo-500
  "var(--chart-2, #14b8a6)", // teal-500
  "var(--chart-3, #f59e0b)", // amber-500
  "var(--chart-4, #ef4444)", // red-500
  "var(--chart-5, #8b5cf6)", // violet-500
  "var(--chart-6, #06b6d4)", // cyan-500
];

// --- Recharts lazy load ----------------------------------------------------
// We import the chart-rendering inner component from a dynamic chunk.
// The fallback is a fixed-height skeleton so layout doesn't shift.
const ChartInner = dynamic(
  () => import("./metric-chart-inner").then((m) => m.MetricChartInner),
  {
    ssr: false,
    loading: () => (
      <div className="h-64 w-full animate-pulse rounded-md bg-muted/50 sm:h-80" />
    ),
  },
);

export function MetricChart({ labels, points, locale = "en-US" }: MetricChartProps) {
  return (
    <ChartInner
      labels={labels}
      points={points}
      locale={locale}
      colors={LINE_COLORS}
    />
  );
}
