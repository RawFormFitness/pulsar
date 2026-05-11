// components/dashboard/metric-section.tsx
//
// Server component. Wraps a titled section of the dashboard with a
// responsive tile grid. Section content is supplied by the page — this
// component is universal (Level 1) and does not know what metrics it
// hosts.
//
// `banner` is an optional section-level slot rendered between the title
// and the tile grid. It exists so a section can carry a single
// reconciliation note that explains a variance affecting multiple
// downstream tiles (lead-generation cascade today; sales / revenue /
// other compound metrics in v2). The slot is generic on purpose: the
// page decides what to put there. Adding more inline `if` branches per
// section in `dashboard-view.tsx` is not the path; the pattern is "the
// page hands a node, the section renders it".
//
// `headerSlot` is an optional right-aligned slot in the section header
// row. v1 use-case: the per-section chart-toggle icon button (Phase
// 3C-1 — four metric sections each get one). Generic on purpose: a
// future section might host an "export" or "filter" affordance there.
//
// `bodyClassName` lets the caller skip the default tile-grid layout
// when the body isn't a tile grid (e.g. a chart rendered by
// ChartToggleBody). The default is the four-column responsive grid
// used by every metric section in v1.

import * as React from "react";

import { cn } from "@/lib/utils";

export type MetricSectionProps = {
  title: string;
  /** Optional descriptive text shown under the title. */
  description?: string;
  /** Optional section-level slot rendered between title and tile grid.
   * Typical use: a reconciliation banner that applies to the whole
   * section (engine vs PDF variance). The page controls the content —
   * see SectionReconciliationBanner. */
  banner?: React.ReactNode;
  /** Optional right-aligned slot in the section header row. v1
   * use-case: chart-toggle icon button. */
  headerSlot?: React.ReactNode;
  /** Override the default body wrapper className. Default is the
   * 1/2/4-column responsive tile grid. Pass an empty string (or a
   * different className) when the body content provides its own
   * layout — e.g. a full-width chart from ChartToggleBody. */
  bodyClassName?: string;
  children: React.ReactNode;
};

const DEFAULT_BODY_CLASS =
  "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4";

export function MetricSection({
  title,
  description,
  banner,
  headerSlot,
  bodyClassName,
  children,
}: MetricSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {headerSlot ? <div className="shrink-0">{headerSlot}</div> : null}
      </div>
      {banner ? <div>{banner}</div> : null}
      <div className={cn(bodyClassName ?? DEFAULT_BODY_CLASS)}>{children}</div>
    </section>
  );
}
