// lib/db/leads.ts
//
// Helpers for `leads` (Gym Sales export rows).
//
// Every helper takes `gymId` as its second positional argument. RLS already
// filters, but explicit gym_id scoping is defense in depth and makes
// cross-gym leaks obvious in code review.

import type { DbClient } from "./client";
import type { Database } from "./types";
import { paginate } from "./_pagination";

export type Lead = Database["public"]["Tables"]["leads"]["Row"];
export type LeadInsert = Database["public"]["Tables"]["leads"]["Insert"];

/**
 * Leads created within [monthStart, monthEnd). Use for monthly cohort
 * computation in the analytics engine. Bounds are exclusive at the upper
 * end so adjacent months don't double-count.
 *
 * Paginated — the lead pool grows over a gym's lifetime and quickly
 * exceeds the PostgREST 1,000-row default cap.
 */
export async function getLeadsForMonth(
  client: DbClient,
  gymId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<Lead[]> {
  return paginate<Lead>(() =>
    client
      .from("leads")
      .select("*")
      .eq("gym_id", gymId)
      .gte("created_at", monthStart.toISOString())
      .lt("created_at", monthEnd.toISOString())
      .order("created_at", { ascending: true }),
  );
}

/**
 * Every lead row stored for a gym, ordered by created_at ascending.
 *
 * The analytics engine consumes the full lead pool (not just rows in the
 * report period) because lead-to-sale matching looks back across earlier
 * months — a sale in April can match against a lead created in March, and
 * the channel-attribution path needs prior leads to disambiguate. Period
 * filtering is the engine's job, not this helper's; do NOT add
 * date-narrowing arguments here. If you need a periodized read, use
 * `getLeadsForMonth`.
 *
 * Paginated. For Powerhouse NYC's hosted data this is a few thousand rows;
 * if a future gym pushes this past tens of thousands we'll add a
 * server-side prefilter or stream the rows.
 */
export async function getAllLeadsForGym(
  client: DbClient,
  gymId: string,
): Promise<Lead[]> {
  return paginate<Lead>(() =>
    client
      .from("leads")
      .select("*")
      .eq("gym_id", gymId)
      .order("created_at", { ascending: true }),
  );
}

/**
 * Fetch a single lead by its source-system id (the export's `id` column).
 * Returns null if not found.
 */
export async function getLeadBySourceId(
  client: DbClient,
  gymId: string,
  sourceId: string,
): Promise<Lead | null> {
  const { data, error } = await client
    .from("leads")
    .select("*")
    .eq("gym_id", gymId)
    .eq("source_id", sourceId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Bulk upsert keyed on (gym_id, source_id). The importer calls this with
 * the parsed rows; re-imports are idempotent. Returns the count actually
 * written.
 *
 * Each input row MUST carry the same gymId passed in — we re-stamp it here
 * to guarantee that even if a caller forgets to set it on a row.
 */
export async function upsertLeads(
  client: DbClient,
  gymId: string,
  rows: Omit<LeadInsert, "gym_id">[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const stamped: LeadInsert[] = rows.map((r) => ({ ...r, gym_id: gymId }));
  const { error, count } = await client
    .from("leads")
    .upsert(stamped, { onConflict: "gym_id,source_id", count: "exact" });

  if (error) throw error;
  return count ?? 0;
}

/**
 * Count leads in a date window (cheap path that avoids materializing rows).
 */
export async function countLeadsForMonth(
  client: DbClient,
  gymId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<number> {
  const { error, count } = await client
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("gym_id", gymId)
    .gte("created_at", monthStart.toISOString())
    .lt("created_at", monthEnd.toISOString());

  if (error) throw error;
  return count ?? 0;
}
