// lib/db/sales.ts
//
// Helpers for `sales` (ABC Ignite "Membership Sales by Sign Date" rows).
// Natural key (gym_id, agreement_number).

import type { DbClient } from "./client";
import type { Database } from "./types";
import { paginate } from "./_pagination";

export type Sale = Database["public"]["Tables"]["sales"]["Row"];
export type SaleInsert = Database["public"]["Tables"]["sales"]["Insert"];

/**
 * Sales whose queue_date falls within the gym-local month [monthStart,
 * monthEnd). Used by the analytics engine for monthly sale counts and
 * conversion math.
 *
 * Why we filter on YYYY-MM-DD strings, not toISOString() bounds:
 *   The schema stores `queue_date` as `timestamptz` (a historical type
 *   choice — the parser actually emits a calendar date YYYY-MM-DD, which
 *   Postgres lifts to midnight UTC on insert). Filtering with full UTC
 *   timestamps drops boundary rows: April 1 stored as `2026-04-01T00:00:00+00`
 *   is < `2026-04-01T04:00:00Z` (April 1 ET midnight) and gets excluded.
 *   Comparing against the calendar-date prefix of the gym-local boundary
 *   matches the parser's convention and the analytics engine's
 *   `isLocalDateInPeriod` semantics.
 *
 * Caveat — gym timezone offset:
 *   `monthStart.toISOString().slice(0, 10)` returns the UTC calendar date
 *   of the boundary. For zones at or west of UTC (UTC-N, including all
 *   US timezones), the gym-local-midnight UTC instant has the same UTC
 *   calendar date as the gym-local date — so this is correct for v1's
 *   only customer (Powerhouse NYC, ET). For zones east of UTC (e.g.,
 *   Tokyo +09:00), the UTC calendar date can lag by one day, which would
 *   shift the filter window. When a non-Western-Hemisphere gym lands,
 *   either narrow `queue_date` to `date` at the schema level OR pass a
 *   pre-formatted gym-local YYYY-MM-DD pair into a new helper.
 *
 * Paginated — sales grows past the 1,000-row PostgREST cap quickly for
 * any moderately-sized gym, even per-month.
 */
export async function getSalesForMonth(
  client: DbClient,
  gymId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<Sale[]> {
  const fromYmd = monthStart.toISOString().slice(0, 10);
  const toYmd = monthEnd.toISOString().slice(0, 10);
  return paginate<Sale>(() =>
    client
      .from("sales")
      .select("*")
      .eq("gym_id", gymId)
      .gte("queue_date", fromYmd)
      .lt("queue_date", toYmd)
      .order("queue_date", { ascending: true })
      .order("id", { ascending: true }),
  );
}

/**
 * Fetch a sale by ABC agreement number.
 */
export async function getSaleByAgreementNumber(
  client: DbClient,
  gymId: string,
  agreementNumber: number,
): Promise<Sale | null> {
  const { data, error } = await client
    .from("sales")
    .select("*")
    .eq("gym_id", gymId)
    .eq("agreement_number", agreementNumber)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Bulk upsert keyed on (gym_id, agreement_number). Re-imports idempotent.
 */
export async function upsertSales(
  client: DbClient,
  gymId: string,
  rows: Omit<SaleInsert, "gym_id">[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const stamped: SaleInsert[] = rows.map((r) => ({ ...r, gym_id: gymId }));
  const { error, count } = await client
    .from("sales")
    .upsert(stamped, {
      onConflict: "gym_id,agreement_number",
      count: "exact",
    });

  if (error) throw error;
  return count ?? 0;
}

/**
 * Distinct `queue_date` calendar-date strings (YYYY-MM-DD) for the gym,
 * ascending. Returns the raw date strings — month-key derivation in the
 * gym timezone is the caller's responsibility (see app/(dashboard)/_lib/
 * periods.ts for the period-list projection).
 *
 * Why date strings and not pre-aggregated month keys: the DB stores
 * `queue_date` as `timestamptz` (see `getSalesForMonth` comment), and the
 * UTC calendar prefix of the stored instant can disagree with the gym-
 * local month for timezones east of UTC. Returning raw dates lets the
 * caller apply the same `localDateString(...)` projection the analytics
 * engine uses, so the selector's period list cannot drift from the
 * engine's period filter.
 *
 * Paginated — sales easily exceed the 1,000-row PostgREST cap. We select
 * a single column to keep page weight low.
 */
// Scaling note: this is a full-table scan over `queue_date` for the gym.
// Fine at Powerhouse's scale (~hundreds of sales/month), but a known
// scaling cliff — revisit with a Postgres RPC (e.g. `select distinct
// date_trunc('month', queue_date)`) or a materialized monthly-keys view
// once any gym's `sales` row count exceeds ~50k.
export async function listDistinctSaleDates(
  client: DbClient,
  gymId: string,
): Promise<string[]> {
  const rows = await paginate<{ queue_date: string | null }>(() =>
    client
      .from("sales")
      .select("queue_date")
      .eq("gym_id", gymId)
      .order("queue_date", { ascending: true })
      .order("id", { ascending: true }),
  );
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.queue_date) continue;
    seen.add(r.queue_date.slice(0, 10));
  }
  return [...seen].sort();
}

/**
 * Cheap count of sales in a window. Uses the same calendar-date filtering
 * convention as `getSalesForMonth` — see that helper's comment for why.
 */
export async function countSalesForMonth(
  client: DbClient,
  gymId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<number> {
  const fromYmd = monthStart.toISOString().slice(0, 10);
  const toYmd = monthEnd.toISOString().slice(0, 10);
  const { error, count } = await client
    .from("sales")
    .select("id", { count: "exact", head: true })
    .eq("gym_id", gymId)
    .gte("queue_date", fromYmd)
    .lt("queue_date", toYmd);

  if (error) throw error;
  return count ?? 0;
}
