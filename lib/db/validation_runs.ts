// lib/db/validation_runs.ts
//
// Helpers for `validation_runs` — output of validation checks attached to
// a specific import. Each check writes one row; `details` jsonb carries the
// diagnostic payload.

import type { DbClient } from "./client";
import type { Database, Json } from "./types";

export type ValidationRun =
  Database["public"]["Tables"]["validation_runs"]["Row"];
export type ValidationRunInsert =
  Database["public"]["Tables"]["validation_runs"]["Insert"];

/**
 * All validation runs attached to an import, newest first.
 */
export async function getValidationRunsForImport(
  client: DbClient,
  gymId: string,
  importId: string,
): Promise<ValidationRun[]> {
  const { data, error } = await client
    .from("validation_runs")
    .select("*")
    .eq("gym_id", gymId)
    .eq("import_id", importId)
    .order("ran_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/**
 * The most recent run for a given check_name in this gym, regardless of
 * import. Useful for "did the most-recent monthly reconciliation pass?"
 * widgets.
 */
export async function getLatestValidationRun(
  client: DbClient,
  gymId: string,
  checkName: string,
): Promise<ValidationRun | null> {
  const { data, error } = await client
    .from("validation_runs")
    .select("*")
    .eq("gym_id", gymId)
    .eq("check_name", checkName)
    .order("ran_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Record a validation run. Service-role only in v1.
 */
export async function recordValidationRun(
  client: DbClient,
  gymId: string,
  input: {
    importId: string | null;
    checkName: string;
    passed: boolean;
    details?: Json;
  },
): Promise<ValidationRun> {
  const row: ValidationRunInsert = {
    gym_id: gymId,
    import_id: input.importId,
    check_name: input.checkName,
    passed: input.passed,
    details:
      (input.details ??
        {}) as Database["public"]["Tables"]["validation_runs"]["Insert"]["details"],
  };

  const { data, error } = await client
    .from("validation_runs")
    .insert(row)
    .select()
    .single();

  if (error) throw error;
  return data;
}
