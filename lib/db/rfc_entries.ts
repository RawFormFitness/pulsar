// lib/db/rfc_entries.ts
//
// Helpers for `rfc_entries` — members removed for collections (ABC RFC
// report). Natural key (gym_id, agreement_number, status_date).

import type { DbClient } from "./client";
import type { Database } from "./types";
import { paginate } from "./_pagination";

export type RfcEntry = Database["public"]["Tables"]["rfc_entries"]["Row"];
export type RfcEntryInsert =
  Database["public"]["Tables"]["rfc_entries"]["Insert"];

/**
 * RFC entries whose status_date falls in [monthStart, monthEnd). Used for
 * the monthly RFC count in the losses block.
 *
 * `status_date` is a `date` column (no time-of-day) so we compare with
 * YYYY-MM-DD strings. The same gym-timezone caveat noted in
 * `lib/db/sales.ts.getSalesForMonth` applies — see that helper's comment.
 *
 * Paginated to defend against the PostgREST 1,000-row cap.
 */
export async function getRfcEntriesForMonth(
  client: DbClient,
  gymId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<RfcEntry[]> {
  const fromYmd = monthStart.toISOString().slice(0, 10);
  const toYmd = monthEnd.toISOString().slice(0, 10);
  return paginate<RfcEntry>(() =>
    client
      .from("rfc_entries")
      .select("*")
      .eq("gym_id", gymId)
      .gte("status_date", fromYmd)
      .lt("status_date", toYmd)
      .order("status_date", { ascending: true })
      .order("id", { ascending: true }),
  );
}

/**
 * RFC entries with `days_past_due >= minDaysPastDue`. Used for the past-due
 * forecast workflow; the urgency-tier boundaries themselves are configured
 * in gym_configs.config (Level 2), so this helper just filters on a number.
 *
 * Paginated.
 */
export async function getRfcEntriesByMinDaysPastDue(
  client: DbClient,
  gymId: string,
  minDaysPastDue: number,
): Promise<RfcEntry[]> {
  return paginate<RfcEntry>(() =>
    client
      .from("rfc_entries")
      .select("*")
      .eq("gym_id", gymId)
      .gte("days_past_due", minDaysPastDue)
      .order("days_past_due", { ascending: false })
      .order("id", { ascending: true }),
  );
}

/**
 * Bulk upsert keyed on (gym_id, agreement_number, status_date).
 */
export async function upsertRfcEntries(
  client: DbClient,
  gymId: string,
  rows: Omit<RfcEntryInsert, "gym_id">[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const stamped: RfcEntryInsert[] = rows.map((r) => ({ ...r, gym_id: gymId }));
  const { error, count } = await client
    .from("rfc_entries")
    .upsert(stamped, {
      onConflict: "gym_id,agreement_number,status_date",
      count: "exact",
    });

  if (error) throw error;
  return count ?? 0;
}

/**
 * Count RFC entries within a date window.
 */
export async function countRfcEntriesForMonth(
  client: DbClient,
  gymId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<number> {
  const { error, count } = await client
    .from("rfc_entries")
    .select("id", { count: "exact", head: true })
    .eq("gym_id", gymId)
    .gte("status_date", monthStart.toISOString().slice(0, 10))
    .lt("status_date", monthEnd.toISOString().slice(0, 10));

  if (error) throw error;
  return count ?? 0;
}
