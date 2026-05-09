// components/dashboard/metric-section.tsx
//
// Server component. Wraps a titled section of the dashboard with a
// responsive tile grid. Section content is supplied by the page — this
// component is universal (Level 1) and does not know what metrics it
// hosts.

import * as React from "react";

export type MetricSectionProps = {
  title: string;
  /** Optional descriptive text shown under the title. */
  description?: string;
  children: React.ReactNode;
};

export function MetricSection({
  title,
  description,
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {children}
      </div>
    </section>
  );
}
