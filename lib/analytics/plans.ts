// lib/analytics/plans.ts
//
// Plan-name normalization + exclusion check. Universal whitespace
// collapse is Level-1; the exclusion list itself is Level-2 config.

import type { SaleRow } from "@/lib/parsers/types";
import type { GymConfig } from "./types";

export function normalizePlanName(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/\s+/g, " ").trim();
}

function valuesNormalized(config: GymConfig): string[] {
  return config.plan_exclusions.values.map((v) =>
    config.plan_exclusions.match === "exact" ? v : normalizePlanName(v),
  );
}

/**
 * Returns true if this plan name should be EXCLUDED per the gym's
 * config. Comparison is post-normalization (whitespace-collapsed).
 * Used for snapshot-derived slices (plan_name only).
 */
export function isExcludedPlan(
  planName: string | null | undefined,
  config: GymConfig,
): boolean {
  const normed = normalizePlanName(planName);
  if (!normed) return false;
  return valuesNormalized(config).includes(normed);
}

/**
 * Sale-side exclusion. Powerhouse's ABC export sometimes records
 * excluded membership types in Agreement Payment Plan rather than
 * Membership Type (e.g. "Student 1 Month PIF" appears as the
 * payment_plan on a parent BasicNYC membership). Config opts in via
 * plan_exclusions.sale_match_fields. Default: ["plan_name"].
 */
export function isExcludedSale(sale: SaleRow, config: GymConfig): boolean {
  const fields = config.plan_exclusions.sale_match_fields ?? ["plan_name"];
  const list = valuesNormalized(config);
  for (const f of fields) {
    const v = normalizePlanName(sale[f] as string | null | undefined);
    if (v && list.includes(v)) return true;
  }
  return false;
}
