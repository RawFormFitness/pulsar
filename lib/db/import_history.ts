// lib/db/import_history.ts
//
// Helpers for `import_history` — one row per CSV file ingested. The
// `source_hash` column makes re-imports idempotent (the importer skips
// uploads whose hash matches a previous import for the same gym).

import type { DbClient } from "./client";
import type { Database } from "./types";

export type ImportHistory =
  Database["public"]["Tables"]["import_history"]["Row"];
export type ImportHistoryInsert =
  Database["public"]["Tables"]["import_history"]["Insert"];

/**
 * Recent imports for a gym, newest first. `limit` is capped at 200.
 */
export async function listRecentImports(
  client: DbClient,
  gymId: string,
  limit: number = 50,
): Promise<ImportHistory[]> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const { data, error } = await client
    .from("import_history")
    .select("*")
    .eq("gym_id", gymId)
    .order("imported_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw error;
  return data ?? [];
}

/**
 * Look up an import by source_hash so the importer can short-circuit a
 * duplicate upload. Returns null if no prior import for this gym matches.
 */
export async function findImportBySourceHash(
  client: DbClient,
  gymId: string,
  sourceHash: string,
): Promise<ImportHistory | null> {
  const { data, error } = await client
    .from("import_history")
    .select("*")
    .eq("gym_id", gymId)
    .eq("source_hash", sourceHash)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Most recent import of a given format (e.g., "abc_members") for a gym.
 * Used to find the snapshot to drive analytics from.
 */
export async function getLatestImportOfFormat(
  client: DbClient,
  gymId: string,
  format: string,
): Promise<ImportHistory | null> {
  const { data, error } = await client
    .from("import_history")
    .select("*")
    .eq("gym_id", gymId)
    .eq("format", format)
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Record an import. Service-role only in v1. Returns the inserted row so
 * the caller can attach validation_runs to its id.
 */
export async function recordImport(
  client: DbClient,
  gymId: string,
  input: Omit<ImportHistoryInsert, "gym_id">,
): Promise<ImportHistory> {
  const { data, error } = await client
    .from("import_history")
    .insert({ ...input, gym_id: gymId })
    .select()
    .single();

  if (error) throw error;
  return data;
}
