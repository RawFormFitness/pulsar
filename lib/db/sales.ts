// lib/db/sales.ts
//
// Helpers for `sales` (ABC Ignite "Membership Sales by Sign Date" rows).
// Natural key (gym_id, agreement_number).

import type { DbClient } from "./client";
import type { Database } from "./types";

export type Sale = Database["public"]["Tables"]["sales"]["Row"];
export type SaleInsert = Database["public"]["Tables"]["sales"]["Insert"];

/**
 * Sales whose queue_date is within [monthStart, monthEnd). Used by the
 * analytics engine for monthly sale counts and conversion math.
 */
export async function getSalesForMonth(
  client: DbClient,
  gymId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<Sale[]> {
  const { data, error } = await client
    .from("sales")
    .select("*")
    .eq("gym_id", gymId)
    .gte("queue_date", monthStart.toISOString())
    .lt("queue_date", monthEnd.toISOString())
    .order("queue_date", { ascending: true });

  if (error) throw error;
  return data ?? [];
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
 * Cheap count of sales in a window.
 */
export async function countSalesForMonth(
  client: DbClient,
  gymId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<number> {
  const { error, count } = await client
    .from("sales")
    .select("id", { count: "exact", head: true })
    .eq("gym_id", gymId)
    .gte("queue_date", monthStart.toISOString())
    .lt("queue_date", monthEnd.toISOString());

  if (error) throw error;
  return count ?? 0;
}
