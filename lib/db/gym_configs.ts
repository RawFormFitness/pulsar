// lib/db/gym_configs.ts
//
// Helpers for `gym_configs`. All Level-2 (configured) gym-specific values
// live in `config` jsonb — plan exclusions, channel attribution rules, promo
// windows, RFC tier boundaries, churn thresholds, data-dictionary mappings,
// custom-module references. The schema does NOT enumerate these.
//
// Helpers here are intentionally generic: they hand back the jsonb. Each
// consumer (analytics-engine, importer, validation) is responsible for
// validating the slice of config it cares about.

import type { DbClient } from "./client";
import type { Database, Json } from "./types";

export type GymConfig = Database["public"]["Tables"]["gym_configs"]["Row"];
export type GymConfigJson = Json;

/**
 * Fetch the gym_configs row for a gym. Returns null if it doesn't exist or
 * RLS hides it.
 */
export async function getGymConfig(
  client: DbClient,
  gymId: string,
): Promise<GymConfig | null> {
  const { data, error } = await client
    .from("gym_configs")
    .select("*")
    .eq("gym_id", gymId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Fetch only the `config` jsonb. Convenience for read paths that don't care
 * about version/updated_at.
 */
export async function getGymConfigJson(
  client: DbClient,
  gymId: string,
): Promise<GymConfigJson | null> {
  const row = await getGymConfig(client, gymId);
  return row?.config ?? null;
}

/**
 * Replace the gym's config json. Bumps version and updated_at. Service-role
 * only in v1 (no RLS write policy for authenticated users).
 */
export async function upsertGymConfig(
  client: DbClient,
  gymId: string,
  config: GymConfigJson,
): Promise<GymConfig> {
  const { data, error } = await client
    .from("gym_configs")
    .upsert(
      {
        gym_id: gymId,
        config: config as Database["public"]["Tables"]["gym_configs"]["Insert"]["config"],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "gym_id" },
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}
