"use client";

// components/dashboard/section-chart-toggle.tsx
//
// Per-section view toggle: tile grid <-> trailing-period line chart.
//
// Phase 3C-1 scope (locked):
//   * Four sections only: Lead Gen, Sales, Losses, Membership.
//   * Conversion + Pipeline Velocity do NOT get this toggle.
//   * State is per-section — toggling Lead Gen does not affect Sales,
//     etc. (Each section has its own provider.)
//   * Toggle resets to tile view on page reload (no localStorage,
//     no URL persistence). Per locked decision: refresh preserves the
//     URL period but tile view is always the default landing state.
//
// Composition:
//
//   <SectionChartToggleProvider seriesKey="lead_generation" locale="en-US">
//     <MetricSection
//       title="Lead Generation"
//       headerSlot={<ChartToggleHeaderButton />}
//     >
//       <ChartToggleBody>
//         {tiles}
//       </ChartToggleBody>
//     </MetricSection>
//   </SectionChartToggleProvider>
//
// The provider wraps both the header button AND the body, so they
// share the same toggle state via React context. The button renders
// into the section header (via the new `headerSlot` prop on
// MetricSection), and the body switches between the tile children and
// the chart depending on the toggle.
//
// Boundary discipline:
//   * No db / engine access. Charts are pure presentation.
//   * Series data is read from the SeriesProvider context (populated
//     by the SeriesHydrator suspense boundary in the page).

import * as React from "react";
import { LineChartIcon, LayoutGridIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useSeries } from "./series-context";
import { MetricChart } from "./metric-chart";

export type SeriesKey =
  | "lead_generation"
  | "sales"
  | "losses"
  | "membership";

// --- internal context -----------------------------------------------------
// One context per provider. The provider is rendered ONCE per section
// (four times per page in v1), so the context tree is shallow.

type ToggleContextValue = {
  chartView: boolean;
  setChartView: (v: boolean) => void;
  seriesKey: SeriesKey;
  locale: string;
  ariaLabel: string;
};

const SectionToggleContext =
  React.createContext<ToggleContextValue | null>(null);

export type SectionChartToggleProviderProps = {
  seriesKey: SeriesKey;
  /** Locale for chart-tooltip number formatting. */
  locale?: string;
  /** Aria label override — defaults to a section-agnostic
   * "Toggle chart view". */
  ariaLabel?: string;
  children: React.ReactNode;
};

/** Wraps a section with toggle state. Renders nothing of its own —
 * the section header and body components read the state from
 * context. */
export function SectionChartToggleProvider({
  seriesKey,
  locale = "en-US",
  ariaLabel,
  children,
}: SectionChartToggleProviderProps) {
  const [chartView, setChartView] = React.useState(false);
  return (
    <SectionToggleContext.Provider
      value={{
        chartView,
        setChartView,
        seriesKey,
        locale,
        ariaLabel: ariaLabel ?? "Toggle chart view",
      }}
    >
      {children}
    </SectionToggleContext.Provider>
  );
}

/** Icon button rendered into the section's headerSlot. Reads toggle
 * state from SectionToggleContext. Returns null outside a provider
 * so a misuse silently no-ops rather than throwing. */
export function ChartToggleHeaderButton() {
  const ctx = React.useContext(SectionToggleContext);
  if (!ctx) return null;
  const { chartView, setChartView, ariaLabel } = ctx;
  return (
    <button
      type="button"
      onClick={() => setChartView(!chartView)}
      aria-label={ariaLabel}
      aria-pressed={chartView}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md border bg-card text-muted-foreground transition-colors",
        "hover:bg-accent hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        chartView && "bg-accent text-foreground",
      )}
    >
      {chartView ? (
        <LayoutGridIcon className="h-4 w-4" />
      ) : (
        <LineChartIcon className="h-4 w-4" />
      )}
    </button>
  );
}

/** Body wrapper: renders `children` (the tile grid) when toggle is
 * off, the chart when toggle is on. Reads series data from the
 * SeriesProvider context.
 *
 * Tile view applies the section's default responsive grid layout
 * ourselves (rather than relying on MetricSection's bodyClassName)
 * because the tile-vs-chart switch happens at client-render time and
 * the wrapper has to swap layout mode without re-mounting. The
 * containing MetricSection is configured with `bodyClassName=""` so it
 * doesn't double-apply the grid.
 */
export function ChartToggleBody({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = React.useContext(SectionToggleContext);
  const series = useSeries();
  if (!ctx)
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {children}
      </div>
    );
  const { chartView, seriesKey, locale } = ctx;

  if (!chartView) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {children}
      </div>
    );
  }

  const data = series.status === "ready" ? series.pack[seriesKey] : null;
  const pending = series.status === "pending";
  const errored = series.status === "error";

  if (data) {
    return (
      <MetricChart labels={data.labels} points={data.points} locale={locale} />
    );
  }
  if (pending) {
    return (
      <div className="flex h-64 w-full items-center justify-center rounded-md border bg-card text-sm text-muted-foreground sm:h-80">
        Loading trend...
      </div>
    );
  }
  if (errored) {
    return (
      <div className="flex h-64 w-full items-center justify-center rounded-md border border-destructive/30 bg-destructive/5 text-sm text-destructive sm:h-80">
        Could not load trend data.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {children}
    </div>
  );
}
