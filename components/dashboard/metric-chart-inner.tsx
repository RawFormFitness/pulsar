"use client";

// components/dashboard/metric-chart-inner.tsx
//
// The actual Recharts surface, isolated in its own file so the import
// of `recharts` can be code-split out by next/dynamic (see
// ./metric-chart.tsx). This file is never imported eagerly from the
// initial page bundle.
//
// Universality:
//   * Renders whatever `labels` and `points` it receives. No knowledge
//     of channels, gym names, or section context.
//   * Uses an ordered list of stroke colors (passed in by the wrapper).
//
// Null handling:
//   * Points emit `null` for missing observations. Recharts
//     `connectNulls={false}` renders that as a gap in the line, which
//     is what the user asked for (membership chart's missing-snapshot
//     periods).

import * as React from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { SeriesPoint } from "@/app/(dashboard)/_lib/series";

export type MetricChartInnerProps = {
  labels: string[];
  points: SeriesPoint[];
  locale: string;
  colors: string[];
};

/** Format a number with the caller's locale. Used by the tooltip. */
function fmt(n: number | null | undefined, locale: string): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat(locale).format(n);
}

/** Trim the chart's x-axis label to a compact form ("April 2026" ->
 * "Apr"). The full period label still shows in the tooltip. We strip
 * everything after the first space to keep this generic across locales:
 * "April 2026" -> "April", "avril 2026" -> "avril" — short enough for
 * 6 ticks in a narrow viewport. */
function shortMonth(label: string): string {
  const space = label.indexOf(" ");
  const head = space === -1 ? label : label.slice(0, space);
  // Cap at 4 chars so long month names like "September" don't overflow.
  return head.length > 4 ? head.slice(0, 3) : head;
}

export function MetricChartInner({
  labels,
  points,
  locale,
  colors,
}: MetricChartInnerProps) {
  // Recharts wants a flat row per period — flatten `point.values` into
  // top-level keys, keeping `periodLabel` and `_short` for axis +
  // tooltip.
  const data = points.map((p) => {
    const row: Record<string, number | string | null> = {
      periodKey: p.periodKey,
      periodLabel: p.periodLabel,
      _short: shortMonth(p.periodLabel),
    };
    for (const label of labels) {
      const v = p.values[label];
      row[label] = v === undefined ? null : v;
    }
    return row;
  });

  return (
    <div className="h-64 w-full sm:h-80">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="_short"
            stroke="var(--muted-foreground)"
            fontSize={12}
            tickLine={false}
          />
          <YAxis
            stroke="var(--muted-foreground)"
            fontSize={12}
            tickLine={false}
            width={40}
            allowDecimals={false}
          />
          <Tooltip
            // Custom tooltip so the period label shows in full ("April
            // 2026") rather than the abbreviated axis tick.
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const first = payload[0]?.payload as
                | { periodLabel?: string }
                | undefined;
              const periodLabel = first?.periodLabel ?? "";
              return (
                <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-sm">
                  <div className="font-medium text-foreground">{periodLabel}</div>
                  <div className="mt-1 space-y-0.5">
                    {payload.map((p) => (
                      <div
                        key={String(p.dataKey)}
                        className="flex items-center gap-2"
                      >
                        <span
                          aria-hidden
                          className="inline-block h-2 w-2 rounded-sm"
                          style={{ backgroundColor: p.color }}
                        />
                        <span className="text-muted-foreground">
                          {String(p.dataKey)}
                        </span>
                        <span className="ml-auto font-medium tabular-nums text-foreground">
                          {fmt(p.value as number | null, locale)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12 }}
            iconType="circle"
            iconSize={8}
          />
          {labels.map((label, i) => (
            <Line
              key={label}
              type="monotone"
              dataKey={label}
              name={label}
              stroke={colors[i % colors.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
