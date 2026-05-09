// lib/analytics/membership.ts
//
// Start-of-Month Member Base, Current Member Base, Net Gain, Attrition.
//
// Per config:
//   * Current = Start + Sales - (cancels + rfc + revocations) — flow
//     identity, NOT a snapshot count.
//   * Start = prior period's Current. For the seed period, fall back to
//     config.membership.start_of_month_member_base.seed_value.
//   * Net Gain = Sales - losses.
//   * Attrition = losses / Start. Pending Cancel is NOT in the loss term.
//
// The engine receives `prior_period_current_member_base` on input. When
// it's null and config provides a seed_value, we use the seed. We log
// nothing on this path — the seed is the documented intent.

import type { GymConfig } from "./types";

export type MembershipResult = {
  start_of_month_member_base: number;
  current_member_base: number;
  net_gain: number;
  attrition_ratio: number | null;
};

export function computeMembership(args: {
  totalSales: number;
  totalLossesForAttrition: number;
  priorPeriodCurrent: number | null | undefined;
  config: GymConfig;
}): MembershipResult {
  const { totalSales, totalLossesForAttrition, priorPeriodCurrent, config } = args;
  const seed = config.membership.start_of_month_member_base.seed_value ?? null;
  const start =
    priorPeriodCurrent != null
      ? priorPeriodCurrent
      : seed != null
        ? seed
        : 0;

  const current = start + totalSales - totalLossesForAttrition;
  const netGain = totalSales - totalLossesForAttrition;
  const attrition = start === 0 ? null : totalLossesForAttrition / start;

  return {
    start_of_month_member_base: start,
    current_member_base: current,
    net_gain: netGain,
    attrition_ratio: attrition,
  };
}

/** Round attrition ratio to 4-decimal-percent (0.04770 -> 4.77 -> "4.77%").
 * The fixture asserts both the ratio (rounded to 4 places) and the
 * "4.77%" display string. */
export function attritionToTwoDecimalPercent(r: number | null): number | null {
  if (r === null) return null;
  return Math.round(r * 10000) / 100;
}
