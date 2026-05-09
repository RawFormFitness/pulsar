// lib/db/members.ts
//
// Helpers for `members` — snapshot rows from the ABC Active Members report.
// Snapshots are keyed (gym_id, agreement_number, as_of). To reconstruct the
// member base "as of" a given date, take the latest snapshot ≤ that date
// per agreement_number.

import type { DbClient } from "./client";
import type { Database } from "./types";
import { paginate } from "./_pagination";

export type Member = Database["public"]["Tables"]["members"]["Row"];
export type MemberInsert = Database["public"]["Tables"]["members"]["Insert"];

/**
 * All snapshot rows imported with a specific as_of timestamp. Useful for
 * "show me the snapshot the importer just produced" flows.
 *
 * Paginated. Powerhouse NYC's snapshot is ~1,370 rows; without paging the
 * default PostgREST cap of 1,000 silently dropped 370 rows including most
 * of the Pending Cancel population.
 */
export async function getMembersAsOf(
  client: DbClient,
  gymId: string,
  asOf: Date,
): Promise<Member[]> {
  return paginate<Member>(() =>
    client
      .from("members")
      .select("*")
      .eq("gym_id", gymId)
      .eq("as_of", asOf.toISOString())
      .order("agreement_number", { ascending: true }),
  );
}

/**
 * Latest snapshot timestamp present for this gym, or null if none. Used by
 * the analytics engine to find "current" member state.
 */
export async function getLatestSnapshotAsOf(
  client: DbClient,
  gymId: string,
): Promise<Date | null> {
  const { data, error } = await client
    .from("members")
    .select("as_of")
    .eq("gym_id", gymId)
    .order("as_of", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? new Date(data.as_of) : null;
}

/**
 * Members whose `last_visit_date` is older than `cutoff` in the latest
 * snapshot. Powers the churn-risk action layer (configurable threshold,
 * default 30 days set per-gym in gym_configs.config).
 *
 * Note: this only filters within the most-recent as_of for the gym.
 */
export async function getChurnRiskMembers(
  client: DbClient,
  gymId: string,
  cutoff: Date,
): Promise<Member[]> {
  const latest = await getLatestSnapshotAsOf(client, gymId);
  if (!latest) return [];

  return paginate<Member>(() =>
    client
      .from("members")
      .select("*")
      .eq("gym_id", gymId)
      .eq("as_of", latest.toISOString())
      .lt("last_visit_date", cutoff.toISOString().slice(0, 10)) // date column
      .order("last_visit_date", { ascending: true }),
  );
}

/**
 * Bulk upsert snapshot rows. Idempotent on (gym_id, agreement_number,
 * as_of) — re-running an importer for the same as_of overwrites in place
 * without duplication.
 */
export async function upsertMembersSnapshot(
  client: DbClient,
  gymId: string,
  rows: Omit<MemberInsert, "gym_id">[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const stamped: MemberInsert[] = rows.map((r) => ({ ...r, gym_id: gymId }));
  const { error, count } = await client
    .from("members")
    .upsert(stamped, {
      onConflict: "gym_id,agreement_number,as_of",
      count: "exact",
    });

  if (error) throw error;
  return count ?? 0;
}

/**
 * Count of members in the snapshot at as_of. Used for "Start-of-Month
 * Member Base" / "Current Member Base" metrics.
 */
export async function countMembersAsOf(
  client: DbClient,
  gymId: string,
  asOf: Date,
): Promise<number> {
  const { error, count } = await client
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("gym_id", gymId)
    .eq("as_of", asOf.toISOString());

  if (error) throw error;
  return count ?? 0;
}
