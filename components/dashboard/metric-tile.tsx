// components/dashboard/metric-tile.tsx
//
// Generic metric tile. Server component.
//
// Renders a single label/value pair from MetricsPack output. The tile is
// universal (Level 1): every gym renders metrics through this component.
// Per-gym customization happens upstream — the analytics-engine produces
// the {label, value} entries, the page maps over them, and this component
// only knows how to format and display.
//
// Numbers are formatted via Intl.NumberFormat with a caller-provided
// locale (Level 2). Strings (e.g. pre-formatted percentages like "4.77%"
// or signed numbers like "+48") pass through verbatim.
//
// `sideSlot` is the escape hatch for tile-adjacent UI such as the Pending
// Cancel reconciliation banner. Generic on purpose: any tile in any
// section can opt into a side slot driven by upstream metadata.

import * as React from "react";

import { Card, CardContent } from "@/components/ui/card";

export type MetricTileProps = {
  label: string;
  value: number | string;
  /**
   * How to format a numeric value:
   *   - "number" (default) — Intl integer formatting (1,237).
   *   - "signed_number"     — adds a leading "+" for non-negative ints.
   *   - "passthrough"       — render whatever the engine produced as-is
   *                           (used when the engine already supplies a
   *                           formatted string, e.g. "4.77%").
   * Strings always pass through.
   */
  format?: "number" | "signed_number" | "passthrough";
  /** BCP-47 locale tag (e.g. "en-US"). */
  locale?: string;
  /** Optional rendered slot below/beside the tile body — e.g. a
   * reconciliation banner. The page controls what goes here. */
  sideSlot?: React.ReactNode;
};

function formatValue(
  value: number | string,
  format: MetricTileProps["format"],
  locale: string,
): string {
  if (typeof value === "string") return value;
  if (format === "passthrough") return String(value);
  if (format === "signed_number") {
    const sign = value > 0 ? "+" : "";
    return `${sign}${new Intl.NumberFormat(locale).format(value)}`;
  }
  return new Intl.NumberFormat(locale).format(value);
}

export function MetricTile({
  label,
  value,
  format = "number",
  locale = "en-US",
  sideSlot,
}: MetricTileProps) {
  const display = formatValue(value, format, locale);
  return (
    <Card className="h-full">
      <CardContent className="space-y-2 py-1">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="text-3xl font-semibold tabular-nums">{display}</div>
        {sideSlot ? <div className="pt-1">{sideSlot}</div> : null}
      </CardContent>
    </Card>
  );
}
