// lib/db/promo_windows.ts
//
// Helpers for `promo_windows` — per-gym promo cohort definitions.
// Stored as rows so the v1.5 UI can manage them; the analytics engine may
// also pull windows from gym_configs.config — both are valid in v1.

import type { DbClient } from "./client";
import type { Database } from "./types";

export type PromoWindow = Database["public"]["Tables"]["promo_windows"]["Row"];
export type PromoWindowInsert =
  Database["public"]["Tables"]["promo_windows"]["Insert"];

/**
 * All promo windows defined for a gym, ordered by start_date.
 *
 * Not paginated: a gym defines a handful (Powerhouse NYC has ~5 in v1).
 * Even at 100 promos this fits easily under the PostgREST 1,000-row cap.
 * If a gym ever crosses that, switch this to use `paginate()` from
 * `lib/db/_pagination.ts`.
 */
export async function listPromoWindows(
  client: DbClient,
  gymId: string,
): Promise<PromoWindow[]> {
  const { data, error } = await client
    .from("promo_windows")
    .select("*")
    .eq("gym_id", gymId)
    .order("start_date", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/**
 * Promo windows that overlap the date range [from, to]. Used by the
 * validation engine ("untagged sales in known promo dates") and by the
 * forecast tier sort.
 *
 * Not paginated for the same reason as `listPromoWindows` — promo-window
 * counts are small per gym.
 */
export async function getPromoWindowsOverlapping(
  client: DbClient,
  gymId: string,
  from: Date,
  to: Date,
): Promise<PromoWindow[]> {
  const fromIso = from.toISOString().slice(0, 10);
  const toIso = to.toISOString().slice(0, 10);
  const { data, error } = await client
    .from("promo_windows")
    .select("*")
    .eq("gym_id", gymId)
    .lte("start_date", toIso)
    .gte("end_date", fromIso)
    .order("start_date", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/**
 * Insert a new promo window. Service-role only in v1.
 */
export async function createPromoWindow(
  client: DbClient,
  gymId: string,
  input: Omit<PromoWindowInsert, "gym_id">,
): Promise<PromoWindow> {
  const { data, error } = await client
    .from("promo_windows")
    .insert({ ...input, gym_id: gymId })
    .select()
    .single();

  if (error) throw error;
  return data;
}
