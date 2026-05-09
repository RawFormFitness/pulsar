// lib/analytics/validation.ts
//
// Universal validation checks. Names + rule shapes are universal; the
// thresholds (e.g., conversion sanity bounds) come from config. Each
// check is a pure function over the engine's intermediate output.
//
// New checks live here. Per-gym toggles can be added by reading the
// config.validation.checks list and gating which ones run, but for v1
// every Powerhouse-listed check has a universal-shape implementation
// below and runs unconditionally.

import type {
  ClassifiedSale,
  ConversionEntry,
  GymConfig,
  LossesInternal,
  ValidationResult,
  VelocityChannelCounts,
} from "./types";

type Args = {
  config: GymConfig;
  /** Per-channel sale counts keyed by channel key (e.g. {web:49, walk_in:58}). */
  saleCounts: Record<string, number>;
  totalLeads: number;
  totalSales: number;
  losses: LossesInternal;
  startOfMonth: number;
  currentMemberBase: number;
  conversions: ConversionEntry[];
  velocity: Record<string, VelocityChannelCounts>;
  classifiedSales: ClassifiedSale[];
};

export function runValidations(a: Args): ValidationResult[] {
  const out: ValidationResult[] = [];
  const wanted = new Set(a.config.validation.checks.map((c) => c.name));

  if (wanted.has("sales_reconcile")) {
    // Universal reconciliation: sum of every reported channel's sale
    // count must equal total sales. Gym-agnostic w.r.t. channel set.
    const channels = a.config.channels.reported;
    const sum = channels.reduce((acc, ch) => acc + (a.saleCounts[ch] ?? 0), 0);
    const passed = sum === a.totalSales;
    out.push({
      name: "sales_reconcile",
      passed,
      details: { per_channel: a.saleCounts, sum, total: a.totalSales },
    });
  }

  if (wanted.has("velocity_rows_reconcile")) {
    // For each channel, the cumulative final bucket should equal the channel's total.
    const buckets = a.config.velocity_buckets.buckets;
    const finalKey = buckets[buckets.length - 1]?.key;
    const failures: Record<string, { final: number; total: number }> = {};
    for (const [ch, vc] of Object.entries(a.velocity)) {
      const final = finalKey ? (vc.buckets[finalKey] ?? 0) : 0;
      if (final !== vc.total) failures[ch] = { final, total: vc.total };
    }
    out.push({
      name: "velocity_rows_reconcile",
      passed: Object.keys(failures).length === 0,
      details: failures,
    });
  }

  if (wanted.has("member_math_reconciles")) {
    const lhs = a.startOfMonth + a.totalSales - a.losses.total_losses_for_attrition_and_net_gain;
    const passed = lhs === a.currentMemberBase;
    out.push({
      name: "member_math_reconciles",
      passed,
      details: {
        start: a.startOfMonth,
        sales: a.totalSales,
        losses: a.losses.total_losses_for_attrition_and_net_gain,
        expected_current: lhs,
        actual_current: a.currentMemberBase,
      },
    });
  }

  if (wanted.has("conversion_within_sanity_bounds")) {
    const failed = a.conversions.filter((c) => c.outside_sanity_bounds);
    out.push({
      name: "conversion_within_sanity_bounds",
      passed: failed.length === 0,
      details: {
        bounds: a.config.conversion_metrics.sanity_bounds,
        outside: failed.map((f) => ({ label: f.label, ratio: f.ratio })),
      },
    });
  }

  if (wanted.has("no_zero_denominator_divisions")) {
    const zeroDen = a.conversions.filter((c) => c.denominator === 0);
    out.push({
      name: "no_zero_denominator_divisions",
      // Universal rule: if denominator is zero the engine MUST emit null
      // rather than 0. Pass means every zero-denominator metric has a
      // null ratio.
      passed: zeroDen.every((c) => c.ratio === null),
      details: { zero_denominator_metrics: zeroDen.map((c) => c.label) },
    });
  }

  if (wanted.has("unmatched_sale_attribution")) {
    const unmatched = a.classifiedSales.filter((s) => s.is_no_lead_match);
    // This check warns; it does not fail. We surface count for the dashboard.
    out.push({
      name: "unmatched_sale_attribution",
      passed: unmatched.length === 0,
      details: { count: unmatched.length },
    });
  }

  if (wanted.has("channel_universe_complete")) {
    const reported = new Set(a.config.channels.reported);
    const offenders = a.classifiedSales
      .filter((s) => !reported.has(s.channel))
      .map((s) => ({
        agreement_number: s.row.agreement_number,
        channel: s.channel,
      }));
    out.push({
      name: "channel_universe_complete",
      passed: offenders.length === 0,
      details: { offenders },
    });
  }

  if (wanted.has("promo_window_coverage")) {
    // Promo window coverage is informational at this stage — the engine
    // doesn't yet annotate sales with cohort tags. Always-pass with a
    // note so the validation result still surfaces structurally.
    out.push({
      name: "promo_window_coverage",
      passed: true,
      details: { note: "Cohort tagging not yet implemented in v1; check is structural only." },
    });
  }

  return out;
}
