// app/(dashboard)/_components/dashboard-empty-state.tsx
//
// Renders the dashboard's friendly empty state. Used in two paths:
//
//   1. The gym has zero sales in any month — first-time setup before any
//      import has landed. The selector itself is empty; we just say
//      "import some data."
//
//   2. The user navigated to ?period=YYYY-MM for a period that doesn't
//      exist in the gym's data (typo'd URL, stale bookmark, etc.). We
//      still render the period selector with available periods so they
//      can recover with one click — the page-level resolver fell back to
//      the newest available period for that case via `resolvePeriodKey`,
//      so this exact branch only fires when there are truly no available
//      periods at all.
//
// Boundary: pure presentation. No data fetching, no Supabase. Props in,
// markup out.

import * as React from "react";

export type DashboardEmptyStateProps = {
  gymName: string;
  /** Whether the gym has ANY imported sales. Drives copy. */
  hasAnyData: boolean;
  /** Optional header slot (period selector). Rendered even when empty so
   * the page chrome stays consistent. */
  headerSlot?: React.ReactNode;
};

export function DashboardEmptyState({
  gymName,
  hasAnyData,
  headerSlot,
}: DashboardEmptyStateProps) {
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Monthly Report
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{gymName}</h1>
        </div>
        {headerSlot ? <div className="shrink-0">{headerSlot}</div> : null}
      </header>

      <div className="rounded-lg border bg-card p-10 text-center">
        <h2 className="text-lg font-semibold">No data for this period</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {hasAnyData
            ? "Choose another period above, or import sales data covering this window."
            : "Use the Import data button in the top bar to upload your CSV exports. The dashboard will populate as soon as the import completes."}
        </p>
      </div>
    </div>
  );
}
