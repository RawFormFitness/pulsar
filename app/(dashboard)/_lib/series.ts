// app/(dashboard)/_lib/series.ts
//
// Phase 3C-1 — multi-period series for the chart toggle on four metric
// sections (Lead Gen, Sales, Losses, Membership).
//
// What this is:
//   * Server-only. Composes runPeriod() across the trailing six periods
//     (newest = the primary period, plus the five immediately prior
//     available periods).
//   * Output: a SeriesPack with one series per chartable section. Each
//     series is a list of `{ periodKey, periodLabel, values }` points,
//     ordered OLDEST -> NEWEST so Recharts draws left-to-right.
//
// Universality:
//   * `values` is a Record<string, number | null> keyed by the engine's
//     DISPLAY LABEL (e.g. "Web Leads", "Cancels", "Current Member Base").
//     We do NOT key by internal channel keys here — the labels are
//     stable across periods within one config and a gym with renamed
//     labels gets correct chart legends without code changes. The
//     dashboard's existing tile-rendering code already iterates these
//     same labels.
//   * The set of series labels for a section is the union of labels
//     observed across the window's points (in practice they match the
//     primary period's labels because the config doesn't change
//     mid-window; using the union is robustness against future config
//     edits dropping a channel between periods).
//   * Losses series: we drop "Pending Cancel" if the engine flagged
//     pending_cancel_known_gap for ANY point in the window — historic
//     points use the spec-derived value, current points may not, and
//     the trend would be misleading. (For Powerhouse April that gap
//     applies only to 2026-04; pre/post points have an honest 0 from
//     the engine. We keep the line.)
//     Actually: a known_gap means engine and PDF disagree — the engine's
//     emitted value is still the engine's value, consistent across the
//     window. We KEEP the line and let the section's reconciliation
//     banner explain the variance on the primary tile.
//
// Membership chart: chained Current Member Base, conditionally gated on
// snapshot availability.
//
//   Two corrections vs a naive "render the engine's per-period
//   current_member_base" approach:
//
//   1. Chain across the window. The engine's `current_member_base` is a
//      flow-identity calculation: start + sales - losses. `start` comes
//      from the prior period's Current (chained), or — for the
//      configured seed period — from `config.membership.start_of_month_member_base.seed_value`.
//      Running each period independently with `prior_period_current_member_base = null`
//      gives every period the SEED as its start, which is correct for
//      the seed period only and garbage for every other period. The
//      series builder chains the engine's per-period delta
//      (`sales - losses`) onto the seed in chronological order, so the
//      line is meaningful across the whole window.
//
//   2. Conditional null on missing snapshot. Whether a missing snapshot
//      invalidates the chained Current depends on the gym's loss-
//      aggregation config:
//
//        * If `config.cancellations.loss_aggregation.include_in_attrition_numerator`
//          INCLUDES "pending_cancel", then the chain's per-period delta
//          (sales - losses_for_attrition_and_net_gain) depends on the
//          snapshot. Without a snapshot, Pending Cancel reads 0, losses
//          are understated, the chained Current is overstated. We emit
//          `null` for that point.
//
//        * If pending_cancel is EXCLUDED (as in Powerhouse's config,
//          which puts pending_cancel in the forward-looking-indicator
//          bucket only), the per-period delta is independent of the
//          snapshot and the chained Current is mathematically correct
//          even when the snapshot is missing. We emit the chained value.
//
//      Recharts `connectNulls={false}` renders a `null` as a gap in the
//      line, honest about missing observation rather than dragging the
//      line to a misleading value. The conditional gate is universal /
//      config-driven, NOT a Powerhouse-special-case.
//
// Boundary discipline:
//   * Calls runPeriod() per period in parallel.
//   * No direct lib/db access; runPeriod is the seam.
//   * Returns plain JSON-serializable data — the SeriesProvider context
//     hydrates into client components from this shape.

import "server-only";

import type { DbClient } from "@/lib/db";
import type { GymConfig } from "@/lib/analytics";
import type { LeadRow } from "@/lib/parsers/types";
import { runPeriod } from "./run-period";
import type { PeriodOption } from "./periods";

/** One point on a series — one period's value(s) for one section. */
export type SeriesPoint = {
  /** Calendar-month key like "2026-04". */
  periodKey: string;
  /** Display label like "April 2026" (locale-aware, from PeriodOption). */
  periodLabel: string;
  /** Series-label -> numeric value (or null when the dashboard layer
   * has decided we have no defensible observation for this point —
   * see membership-chart null rule above). */
  values: Record<string, number | null>;
};

/** A named series (one set of lines) over a window of periods. */
export type SeriesData = {
  /** Display labels of the lines in this series, in deterministic
   * draw order (matches the primary period's label order). */
  labels: string[];
  /** Points ordered OLDEST -> NEWEST. */
  points: SeriesPoint[];
};

/** Series pack for the four chartable sections. */
export type SeriesPack = {
  /** Trailing window in chronological order (oldest -> newest). */
  window: PeriodOption[];
  /** Lead Generation lines (per-channel, excludes the "Total" row by
   * default so the chart is per-channel comparison rather than total
   * dominating). */
  lead_generation: SeriesData;
  /** Sales lines — per-channel; total excluded for the same reason. */
  sales: SeriesData;
  /** Losses lines — all configured loss tiles (Cancels, RFC, Revocations,
   * Pending Cancel for Powerhouse). */
  losses: SeriesData;
  /** Membership lines — Current Member Base only. Start-of-Month is
   * deterministically Current-shifted-by-one; Net Gain is sales-losses
   * (which the Sales+Losses charts already convey). Attrition Rate is
   * a pre-formatted percent string from the engine, not a number, so
   * it's excluded here. */
  membership: SeriesData;
};

/**
 * Build the trailing-six-period window ending at `primaryKey` from the
 * full available-period list. The list is sorted DESCENDING (newest
 * first) coming out of listAvailablePeriods.
 *
 * Returns periods in CHRONOLOGICAL order (oldest -> newest) so the
 * chart draws left-to-right.
 *
 * If fewer than six periods exist (or the primary isn't in the list,
 * which shouldn't happen given resolvePeriodKey), we return whatever
 * is available — a short series still renders.
 */
export function buildTrailingWindow(
  available: PeriodOption[],
  primaryKey: string,
  size: number = 6,
): PeriodOption[] {
  const primaryIdx = available.findIndex((p) => p.key === primaryKey);
  if (primaryIdx === -1) return [];
  // available[primaryIdx] is the newest end of the window. Walk forward
  // (i.e. into older periods) up to `size-1` more.
  const end = primaryIdx + size; // exclusive end
  const slice = available.slice(primaryIdx, end);
  // slice is desc; reverse to chronological.
  return slice.slice().reverse();
}

/** True when `nextKey` is the calendar-month period immediately after
 * `key`. Both are "YYYY-MM" strings. Used by the membership chain when
 * the seed period is just-past the window's right edge. */
function isCalendarSuccessor(key: string, nextKey: string): boolean {
  const m1 = /^(\d{4})-(\d{2})$/.exec(key);
  const m2 = /^(\d{4})-(\d{2})$/.exec(nextKey);
  if (!m1 || !m2) return false;
  let y = Number(m1[1]);
  let m = Number(m1[2]);
  m += 1;
  if (m === 13) {
    m = 1;
    y += 1;
  }
  const expected = `${y}-${String(m).padStart(2, "0")}`;
  return expected === nextKey;
}

/** "Web Leads" / "Walk-in Leads" without the configured total-row label. */
function nonTotalEntries(
  display: Record<string, number>,
  totalLabel: string,
): Array<[string, number]> {
  return Object.entries(display).filter(([label]) => label !== totalLabel);
}

/**
 * Run the engine for every period in `window` (in parallel) and project
 * the chartable sections into series.
 *
 * Why parallel: each runPeriod() does ~4 db roundtrips (sales / RFC /
 * cancellations / members-snapshot — the leads pool is hoisted out of
 * the fan-out and threaded in via `leads`). Sequenced, the series build
 * would take 24 RTTs serially. Parallelized, the page is limited by
 * the slowest single period — typically <500ms at Powerhouse scale.
 *
 * @param leads - the per-gym lead pool, pre-fetched once by the caller.
 *   Passed to every runPeriod() invocation so we don't refetch the full
 *   leads table for each window point. See app/(dashboard)/page.tsx
 *   and app/(dashboard)/_lib/run-period.ts header for the hoist
 *   rationale.
 *
 * See app/(dashboard)/_lib/run-period.ts header for the scaling-cliff
 * note on this fan-out.
 */
export async function fetchSeries(
  client: DbClient,
  gymId: string,
  config: GymConfig,
  window: PeriodOption[],
  leads: LeadRow[],
): Promise<SeriesPack> {
  // Resolve display labels from config (with fallbacks identical to the
  // engine's DEFAULT_LABELS chain — see lib/analytics/run.ts).
  const totalLeadsLabel =
    config.display_labels?.lead_generation?.total_leads ?? "Total Leads";
  const totalSalesLabel =
    config.display_labels?.sales?.total_sales ?? "Total Sales";
  const currentMemberBaseLabel =
    config.display_labels?.membership?.current_member_base ??
    "Current Member Base";

  // Parallel engine runs across the window. Lead pool is hoisted by
  // the caller and threaded into each run via `leads`.
  const runs = await Promise.all(
    window.map((p) => runPeriod(client, gymId, config, p.key, null, leads)),
  );

  // ---- Lead Generation ------------------------------------------------
  // Labels = primary (newest) period's per-channel labels, in emission
  // order. (Engine emits per-channel entries first, then total — we slice
  // off the total below.)
  const newest = runs[runs.length - 1];
  const leadLabels = newest
    ? nonTotalEntries(newest.pack.lead_generation.display, totalLeadsLabel).map(
        ([k]) => k,
      )
    : [];
  const leadPoints: SeriesPoint[] = window.map((p, i) => {
    const display = runs[i].pack.lead_generation.display;
    const values: Record<string, number | null> = {};
    for (const label of leadLabels) {
      values[label] = label in display ? display[label] : null;
    }
    return { periodKey: p.key, periodLabel: p.label, values };
  });

  // ---- Sales ----------------------------------------------------------
  const salesLabels = newest
    ? nonTotalEntries(newest.pack.sales.display, totalSalesLabel).map(
        ([k]) => k,
      )
    : [];
  const salesPoints: SeriesPoint[] = window.map((p, i) => {
    const display = runs[i].pack.sales.display;
    const values: Record<string, number | null> = {};
    for (const label of salesLabels) {
      values[label] = label in display ? display[label] : null;
    }
    return { periodKey: p.key, periodLabel: p.label, values };
  });

  // ---- Losses ---------------------------------------------------------
  // All loss tiles, in the order the engine emitted them (which is the
  // config-driven losses_tiles order).
  const lossesLabels = newest
    ? Object.keys(newest.pack.losses.display)
    : [];
  const lossesPoints: SeriesPoint[] = window.map((p, i) => {
    const display = runs[i].pack.losses.display;
    const values: Record<string, number | null> = {};
    for (const label of lossesLabels) {
      values[label] = label in display ? display[label] : null;
    }
    return { periodKey: p.key, periodLabel: p.label, values };
  });

  // ---- Membership -----------------------------------------------------
  // Current Member Base only, with chaining + null-on-missing-snapshot.
  // See header comment.
  //
  // Chain anchor:
  //   * `seed_value` from config.membership.start_of_month_member_base.
  //     For Powerhouse this is 1237 (the April-2026 seed).
  //   * `seed_period` declares which period the seed corresponds to as
  //     a START of month. Periods strictly BEFORE the seed get no chain
  //     anchor (we can't run the engine backwards), so they fall back
  //     to per-period engine output — which, for runs with
  //     priorPeriodCurrent=null, equals seed + delta. That's nonsense
  //     for pre-seed periods. We emit null instead.
  const seedValue =
    config.membership.start_of_month_member_base.seed_value ?? null;
  const seedPeriod =
    config.membership.start_of_month_member_base.seed_period ?? null;
  const membershipLabels = newest ? [currentMemberBaseLabel] : [];

  // Compute chained Current Member Base across the window.
  //
  // Forward chain: starting from the seed period (start = seed_value),
  //   each period's Current = prior Current + delta where
  //   delta = total_sales - total_losses_for_attrition_and_net_gain.
  //
  // Backward chain: for periods strictly before the seed (which would
  //   otherwise need a historical anchor we don't have), we can derive
  //   their Current arithmetically: prior Current = seed - sum(deltas of
  //   periods AT or AFTER the prior period and BEFORE OR AT the seed
  //   period). Equivalently:
  //     chained_current[i-1] = chained_current[i] - delta[i]
  //   walking back from the seed. This works because Start[seed] is
  //   equal to Current[seed - 1] by the chain identity.
  //
  //   Caveat: back-chaining relies on the engine's per-period delta
  //   being correct (which means the period's losses must be complete).
  //   Whether that's true when a snapshot is missing depends on whether
  //   `pending_cancel` is in `include_in_attrition_numerator` — see
  //   the conditional-gate logic in the membership-map below and the
  //   header comment for the universality argument. The back-chain
  //   arithmetic here is unchanged; the gate is applied at emit time
  //   so the chained values stay available for the cases where they
  //   ARE defensible.
  const chainedByIndex: Array<number | null> = new Array(window.length).fill(
    null,
  );
  const seedIdx = seedPeriod
    ? window.findIndex((p) => p.key === seedPeriod)
    : -1;
  if (seedValue !== null && seedPeriod) {
    if (seedIdx !== -1) {
      // Seed is INSIDE the window. Forward chain from seed.
      let cur = seedValue;
      for (let i = seedIdx; i < window.length; i++) {
        const r = runs[i];
        const delta =
          r.pack.sales.internal.total_sales -
          r.pack.losses.internal.total_losses_for_attrition_and_net_gain;
        cur = cur + delta;
        chainedByIndex[i] = cur;
      }
      // Backward chain from seed. At the seed period, Start = seed_value,
      // and Start = prior-period Current. So Current[seedIdx-1] = seed.
      let back = seedValue;
      for (let i = seedIdx - 1; i >= 0; i--) {
        chainedByIndex[i] = back;
        const r = runs[i];
        const delta =
          r.pack.sales.internal.total_sales -
          r.pack.losses.internal.total_losses_for_attrition_and_net_gain;
        back = back - delta;
      }
    } else if (
      // Seed is one period strictly AFTER the window's right edge. We
      // know Current[window.last] = seedValue by chain identity, so
      // back-chain the entire window from that anchor.
      window.length > 0 &&
      seedPeriod > window[window.length - 1].key &&
      // Only attempt this when the seed is the IMMEDIATE successor;
      // running the engine for periods between window_end and seed is
      // out of scope for v1 (it'd require extra engine runs that the
      // page didn't budget for). The crude check below tests
      // calendar-adjacency without parsing the keys: if seedPeriod
      // appears as a fresh available period in `window` order one slot
      // beyond the right edge.
      isCalendarSuccessor(window[window.length - 1].key, seedPeriod)
    ) {
      let back = seedValue;
      for (let i = window.length - 1; i >= 0; i--) {
        chainedByIndex[i] = back;
        const r = runs[i];
        const delta =
          r.pack.sales.internal.total_sales -
          r.pack.losses.internal.total_losses_for_attrition_and_net_gain;
        back = back - delta;
      }
    }
    // Else: window ends >1 period before the seed, or starts after the
    // seed and engine output for the gap isn't computed. Membership
    // chart shows no points — degenerate but honest. v2 work item.
  }

  // Conditional null-gate on snapshot availability. See the header
  // comment "Conditional null on missing snapshot" for the rationale.
  //
  // Rule: when pending_cancel IS included in the attrition numerator,
  // the chained Current depends on the snapshot — emit null where the
  // snapshot was missing. When pending_cancel is NOT in the attrition
  // numerator (e.g. Powerhouse, which treats it as a forward-looking
  // indicator), the chain math is snapshot-independent and we emit the
  // chained value.
  //
  // This is config-driven and universal; do NOT hardcode any per-gym
  // branch here.
  const pendingCancelGatesChart =
    config.cancellations.loss_aggregation.include_in_attrition_numerator.includes(
      "pending_cancel",
    );
  const membershipPoints: SeriesPoint[] = window.map((p, i) => {
    const chained = chainedByIndex[i];
    // null when:
    //   * we have no chained value at all (pre-seed periods with no
    //     usable anchor — see the chainedByIndex initialization), OR
    //   * pending_cancel gates the chart AND this point's snapshot was
    //     missing (the engine's losses term would be understated).
    const snapshotBlocks =
      pendingCancelGatesChart && !runs[i].snapshotAvailable;
    const value = chained !== null && !snapshotBlocks ? chained : null;
    return {
      periodKey: p.key,
      periodLabel: p.label,
      values: { [currentMemberBaseLabel]: value },
    };
  });

  return {
    window,
    lead_generation: { labels: leadLabels, points: leadPoints },
    sales: { labels: salesLabels, points: salesPoints },
    losses: { labels: lossesLabels, points: lossesPoints },
    membership: { labels: membershipLabels, points: membershipPoints },
  };
}
