// lib/db/cancellations.ts
//
// Helpers for `cancellations` — Cancel Report rows.
//
// PROJECT.md deviation from the spec PDF:
//   v1 does NOT split into cancels vs revocations and does NOT store reason
//   text. The Cancel Report's date window is captured on import_history.
//
// Natural key: (gym_id, agreement_number).

import type { DbClient } from "./client";
import type { Database } from "./types";

export type Cancellation = Database["public"]["Tables"]["cancellations"]["Row"];
export type CancellationInsert =
  Database["public"]["Tables"]["cancellations"]["Insert"];

/**
 * All cancellations associated with a specific import_history row.
 *
 * The Cancel Report has no per-row date column — the report header carries
 * the period, so monthly cancel counts come from the import that covers
 * that period. The analytics engine joins through import_history to know
 * which import to read.
 */
export async function getCancellationsForImport(
  client: DbClient,
  gymId: string,
  importId: string,
): Promise<Cancellation[]> {
  // No direct import_id FK on cancellations in v1 — we filter by the
  // imported_at window of that import_history row. Callers that already
  // know the window can use getCancellationsImportedInWindow directly.
  const { data: imp, error: impErr } = await client
    .from("import_history")
    .select("imported_at")
    .eq("gym_id", gymId)
    .eq("id", importId)
    .maybeSingle();
  if (impErr) throw impErr;
  if (!imp) return [];

  // Imports for cancel reports are atomic; rows from this import will share
  // imported_at within a small jitter. Use the import's imported_at as a
  // tight window.
  return getCancellationsImportedInWindow(
    client,
    gymId,
    new Date(imp.imported_at),
    new Date(new Date(imp.imported_at).getTime() + 60_000),
  );
}

/**
 * Cancellations whose `imported_at` is in [from, to). Cheap because we have
 * no other date column on this table.
 */
export async function getCancellationsImportedInWindow(
  client: DbClient,
  gymId: string,
  from: Date,
  to: Date,
): Promise<Cancellation[]> {
  const { data, error } = await client
    .from("cancellations")
    .select("*")
    .eq("gym_id", gymId)
    .gte("imported_at", from.toISOString())
    .lt("imported_at", to.toISOString())
    .order("imported_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/**
 * Bulk upsert keyed on (gym_id, agreement_number).
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
      onConflict: "gym_id,agreement_number",
      count: "exact",
    });

  if (error) throw error;
  return count ?? 0;
}

/**
 * Total count of cancellations stored for this gym. The analytics engine
 * uses this for the v1 "Cancellations" losses metric (one undifferentiated
 * stream per the deviation).
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
