// lib/db/cancellations.ts
//
// Helpers for `cancellations` — Powerhouse cancel ledger rows.
//
// Schema (post-migration 0007): cancel_date, effective_date, member_name,
// primary_phone, email, membership_amount_cents, membership_type,
// out_of_contract, reason, raw. Natural key: (gym_id, cancel_date,
// member_name).
//
// Loss-tile classification (cancels / revocations / pending-cancel) is the
// analytics engine's job, not ours; this module just stores rows and
// supports period-window reads.

import type { DbClient } from "./client";
import type { Database } from "./types";
import { paginate } from "./_pagination";

export type Cancellation = Database["public"]["Tables"]["cancellations"]["Row"];
export type CancellationInsert =
  Database["public"]["Tables"]["cancellations"]["Insert"];

/**
 * Cancellations whose `cancel_date` falls in [from, to). The analytics
 * engine reads this window and partitions it locally into the loss tiles.
 *
 * Inputs are date-only (YYYY-MM-DD) — the column itself is `date`, not
 * `timestamptz`, so callers should pass calendar dates in the gym's
 * timezone.
 *
 * Paginated to defend against the PostgREST 1,000-row cap.
 */
export async function getCancellationsInPeriod(
  client: DbClient,
  gymId: string,
  from: string,
  to: string,
): Promise<Cancellation[]> {
  return paginate<Cancellation>(() =>
    client
      .from("cancellations")
      .select("*")
      .eq("gym_id", gymId)
      .gte("cancel_date", from)
      .lt("cancel_date", to)
      .order("cancel_date", { ascending: true })
      .order("id", { ascending: true }),
  );
}

/**
 * Bulk upsert keyed on (gym_id, cancel_date, member_name).
 */
export async function upsertCancellations(
  client: DbClient,
  gymId: string,
  rows: Omit<CancellationInsert, "gym_id">[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const stamped: CancellationInsert[] = rows.map((r) => ({
    ...r,
    gym_id: gymId,
  }));
  const { error, count } = await client
    .from("cancellations")
    .upsert(stamped, {
      onConflict: "gym_id,cancel_date,member_name",
      count: "exact",
    });

  if (error) throw error;
  return count ?? 0;
}

/**
 * Total count of cancellations stored for this gym across all periods.
 * Used by the dashboard's "Cancellations imported" status tile.
 */
export async function countCancellations(
  client: DbClient,
  gymId: string,
): Promise<number> {
  const { error, count } = await client
    .from("cancellations")
    .select("id", { count: "exact", head: true })
    .eq("gym_id", gymId);

  if (error) throw error;
  return count ?? 0;
}
