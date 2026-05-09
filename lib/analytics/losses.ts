// lib/analytics/losses.ts
//
// The four loss tiles for Powerhouse: Cancels, RFC, Revocations, Pending
// Cancel. The shape is universal:
//   * cancels + revocations come from cancellation rows in period,
//     partitioned by reason-text substring match (config-driven).
//   * rfc count = rfc_entries.length for the period (parser already
//     filtered by status_date upstream; the engine just counts).
//   * pending_cancel comes from the snapshot, filtered to the active
//     "Pending Cancel" status AND not in plan_exclusions.
//
// Revocation classification is config-driven (substring match on reason
// text), so swapping in a new gym means changing the config, not the code.
// See cancellations.revocation_classification in the gym config.

import type { CancellationRow, MemberRow, RfcRow } from "@/lib/parsers/types";
import { isExcludedPlan } from "./plans";
import type { GymConfig, LossesInternal } from "./types";

/** True when a cancellation row's reason matches any configured
 * revocation substring (lowercase substring compare). */
export function isRevocation(
  row: CancellationRow,
  config: GymConfig,
): boolean {
  const rule = config.cancellations.revocation_classification;
  if (rule.method !== "substring_lowercase_any") return false;
  const reason = (row.reason ?? "").toLowerCase();
  if (!reason) return false;
  return rule.revocation_substrings.some((s) => reason.includes(s.toLowerCase()));
}

export type LossesResult = {
  internal: LossesInternal;
  revocations_detail: {
    count: number;
    rows: { cancel_date: string; member_name: string; reason: string | null }[];
  };
};

export function computeLosses(
  cancellations: CancellationRow[],
  rfc: RfcRow[],
  membersSnapshot: MemberRow[],
  config: GymConfig,
): LossesResult {
  const cancelsRows: CancellationRow[] = [];
  const revocationsRows: CancellationRow[] = [];
  for (const row of cancellations) {
    if (isRevocation(row, config)) revocationsRows.push(row);
    else cancelsRows.push(row);
  }

  const cancels = cancelsRows.length;
  const revocations = revocationsRows.length;
  const rfcCount = rfc.length;

  // Pending Cancel — snapshot status filter + plan exclusions (per config rule).
  const pendingValue = config.member_status_values.pending_cancel_value;
  let pendingCancel = 0;
  for (const m of membersSnapshot) {
    if ((m.member_status ?? "").trim() !== pendingValue) continue;
    if (isExcludedPlan(m.plan_name, config)) continue;
    pendingCancel++;
  }

  // Total losses = sum of tiles in include_in_attrition_numerator.
  const includeKeys = config.cancellations.loss_aggregation.include_in_attrition_numerator;
  const tileMap: Record<string, number> = {
    cancels,
    rfc: rfcCount,
    revocations,
    pending_cancel: pendingCancel,
  };
  let totalLosses = 0;
  for (const k of includeKeys) totalLosses += tileMap[k] ?? 0;

  return {
    internal: {
      cancels,
      rfc: rfcCount,
      revocations,
      pending_cancel: pendingCancel,
      total_losses_for_attrition_and_net_gain: totalLosses,
    },
    revocations_detail: {
      count: revocations,
      rows: revocationsRows.map((r) => ({
        cancel_date: r.cancel_date,
        member_name: r.member_name,
        reason: r.reason ?? null,
      })),
    },
  };
}
