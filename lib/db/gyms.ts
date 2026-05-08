// lib/db/gyms.ts
//
// Helpers for the `gyms` table. Most reads here are intentionally narrow —
// the schema is multi-tenant by construction, so callers should only ever
// fetch the gym they belong to. There is no `listAllGyms` for this reason.

import type { DbClient } from "./client";
import type { Database } from "./types";

export type Gym = Database["public"]["Tables"]["gyms"]["Row"];

/**
 * Fetch a single gym by id. Returns null if the row doesn't exist or RLS
 * filters it out (i.e., the caller isn't a member). The `gymId` argument is
 * required even though it's also the row id — keeps the helper signature
 * uniform with the rest of lib/db and obvious in code review.
 */
export async function getGym(
  client: DbClient,
  gymId: string,
): Promise<Gym | null> {
  const { data, error } = await client
    .from("gyms")
    .select("*")
    .eq("id", gymId)
    .maybeSingle();

  if (error) throw error;
  return data;
}
