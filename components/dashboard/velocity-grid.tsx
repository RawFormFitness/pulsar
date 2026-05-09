// components/dashboard/velocity-grid.tsx
//
// Server component. Renders the cumulative pipeline-velocity table —
// rows are channel labels (Web / Walk-in / Total), columns are the
// engine's bucket display labels plus a row-total column.
//
// The component is universal (Level 1): it iterates whatever channels
// and buckets the engine produces. Bucket labels and the row-total label
// come from MetricsPack, not hardcoded copy. A gym configured with five
// buckets and three channels would render correctly with no changes
// here.

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type VelocityCell = {
  count: number;
  display_percent: number;
  display: string;
};

export type VelocityGridProps = {
  /** Ordered list of channel display labels (e.g. ["Web", "Walk-in", "Total"]). */
  channelLabels: string[];
  /** Ordered list of bucket display labels (e.g. ["Same day", "Within 7 days", ...]). */
  bucketLabels: string[];
  /** Display label for the running-total column (e.g. "Total Sales"). */
  totalLabel: string;
  /** Per-channel cell map keyed by bucket label, plus the total under
   * `totalLabel` (which is a number, not a cell object). Mirrors
   * `pack.pipeline_velocity.channels`. */
  channels: Record<string, Record<string, VelocityCell | number>>;
  /** Caller locale for formatting integer counts. */
  locale?: string;
};

export function VelocityGrid({
  channelLabels,
  bucketLabels,
  totalLabel,
  channels,
  locale = "en-US",
}: VelocityGridProps) {
  const numberFmt = new Intl.NumberFormat(locale);

  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-32">Channel</TableHead>
            {bucketLabels.map((b) => (
              <TableHead key={b} className="text-right">
                {b}
              </TableHead>
            ))}
            <TableHead className="text-right">{totalLabel}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {channelLabels.map((channel) => {
            const row = channels[channel] ?? {};
            const total = row[totalLabel];
            return (
              <TableRow key={channel}>
                <TableCell className="font-medium">{channel}</TableCell>
                {bucketLabels.map((b) => {
                  const cell = row[b];
                  if (typeof cell === "number" || cell === undefined) {
                    return (
                      <TableCell key={b} className="text-right tabular-nums">
                        —
                      </TableCell>
                    );
                  }
                  return (
                    <TableCell key={b} className="text-right tabular-nums">
                      <span>{numberFmt.format(cell.count)}</span>
                      <span className="ml-1 text-muted-foreground">
                        ({cell.display_percent}%)
                      </span>
                    </TableCell>
                  );
                })}
                <TableCell className="text-right font-semibold tabular-nums">
                  {typeof total === "number" ? numberFmt.format(total) : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">
        Cumulative percentages: each bucket includes all sales closed within
        that timeframe or sooner.
      </p>
    </div>
  );
}
