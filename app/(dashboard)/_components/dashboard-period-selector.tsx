"use client";

// app/(dashboard)/_components/dashboard-period-selector.tsx
//
// Phase 3B period selector for the monthly report dashboard.
//
// What this is:
//   * Client component. Renders a <select> bound to ?period=YYYY-MM.
//   * On change, calls `router.replace({ scroll: false })` so the server
//     component re-renders the page with the newly-selected period.
//   * Read-only display of available periods; the list comes from the
//     server-side `listAvailablePeriods` projection, never from a fresh
//     DB query here.
//
// Why router.replace and not router.push:
//   The period selector is a view toggle, not a navigation event. Pushing
//   onto history would let the browser back-button scrub through every
//   period the user clicked, which is annoying and not the user mental
//   model. `replace` swaps the current entry in place — back-button
//   behaves intuitively (returns to whichever page brought you to the
//   dashboard, not to "April 2026").
//
// Why { scroll: false }:
//   The dashboard is a long vertical scroll. A normal navigation would
//   jump the user to the top each time they change period; scroll: false
//   preserves their position, which is what they want when they're, e.g.,
//   comparing the Losses block across months.
//
// Why <select> and not the shadcn `<Tabs>` already imported by the legacy
// `period-selector.tsx`:
//   * The legacy selector is mode-based (MTD/YTD/Custom) — a different UX
//     than "pick a completed month from a list of N." That selector is
//     left in place untouched; it'll find its home on a future analytics
//     surface that genuinely needs rolling windows.
//   * The available-month list is unbounded (Powerhouse already has 10
//     months in v1). Tabs would wrap or overflow ugly.
//   * Native <select> is keyboard-accessible by default, mobile-friendly
//     (iOS opens the wheel picker, Android opens the dropdown), and a
//     single line in the markup. It's the right primitive here.
//
// Forbidden things this component does NOT do (boundary discipline):
//   * It does NOT query Supabase. Available periods come in as props.
//   * It does NOT recompute the report. It only changes the URL; the
//     server component re-fetches and re-renders the analytics-engine
//     output for the new period.
//   * It does NOT branch on gym slug or hardcode any gym-specific label.

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import type { PeriodOption } from "../_lib/periods";

export type DashboardPeriodSelectorProps = {
  /** Available periods, sorted desc (newest first). */
  options: PeriodOption[];
  /** The currently-rendered period key. The server resolves this from
   * ?period= with a silent fallback (see resolvePeriodKey); the value
   * passed here is what the page is actually showing. */
  value: string;
  className?: string;
};

export function DashboardPeriodSelector({
  options,
  value,
  className,
}: DashboardPeriodSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const onChange = React.useCallback(
    (next: string) => {
      if (next === value) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set("period", next);
      // router.replace with { scroll: false } — see header comment for why.
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams, value],
  );

  // Defensive: if `value` somehow isn't in `options` (shouldn't happen
  // given the server resolves first), render an inert select rather than
  // throwing. Empty options also gets an inert state — the page renders
  // an empty-state shell elsewhere when there's nothing to show.
  if (options.length === 0) {
    return (
      <div
        className={cn(
          "rounded-md border bg-card px-3 py-1.5 text-sm text-muted-foreground",
          className,
        )}
      >
        No periods available
      </div>
    );
  }

  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm",
        className,
      )}
    >
      <span className="text-muted-foreground">Period:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        aria-label="Select report period"
      >
        {options.map((opt) => (
          <option key={opt.key} value={opt.key}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
