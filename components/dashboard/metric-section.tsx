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

import * as React from "react";

export type MetricSectionProps = {
  title: string;
  /** Optional descriptive text shown under the title. */
  description?: string;
  /** Optional section-level slot rendered between title and tile grid.
   * Typical use: a reconciliation banner that applies to the whole
   * section (engine vs PDF variance). The page controls the content —
   * see SectionReconciliationBanner. */
  banner?: React.ReactNode;
  children: React.ReactNode;
};

export function MetricSection({
  title,
  description,
  banner,
  children,
}: MetricSectionProps) {
  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {banner ? <div>{banner}</div> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {children}
      </div>
    </section>
  );
}
