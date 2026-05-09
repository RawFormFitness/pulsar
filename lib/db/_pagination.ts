// lib/db/_pagination.ts
//
// Pagination utility for row-returning helpers in lib/db.
//
// Why this exists:
//   PostgREST (the layer behind supabase-js) caps unbounded `select *`
//   queries at 1,000 rows by default. A naive `.from(t).select("*").eq(...)`
//   silently returns the first 1,000 matching rows even when more exist.
//   This is the cause of an entire family of "missing data" bugs:
//   the helper looks correct, the SQL looks correct, but the dataset is
//   silently truncated. For Powerhouse NYC's hosted snapshot, the members
//   table has 1,370 rows; 370 were dropped including 6 of 13 Pending Cancel
//   members, which broke the dashboard's loss block.
//
// Design:
//   * Helpers that return `Row[]` MUST go through `paginate(...)` so
//     truncation cannot happen by accident.
//   * The factory closure is invoked per page so each call gets a fresh
//     PostgREST query builder. Builders are stateful — re-using one across
//     pages would carry the previous .range() with it.
//   * Page size defaults to 1,000 (PostgREST's hard cap). We could request
//     larger pages by setting an explicit Range header on the client, but
//     defending against the default cap is the goal here, not chasing
//     throughput. If a future helper genuinely needs to stream tens of
//     thousands of rows, it can pass a smaller pageSize OR be rewritten as
//     a server-side aggregation.
//
// Convention:
//   * Every helper here still accepts gymId as its second positional
//     argument. The factory closure is responsible for `.eq("gym_id", ...)`
//     scoping. paginate() does not enforce that — it can't see your filter
//     chain — so the per-helper review is what catches a missing scope.

import type { PostgrestError } from "@supabase/supabase-js";

/** What a PostgREST query builder must look like to be paginated. We type
 * this minimally to avoid coupling to a specific generated table type. */
type RangeQuery<Row> = {
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: Row[] | null; error: PostgrestError | null }>;
};

export interface PaginateOptions {
  /** Maximum rows per request. PostgREST's default cap is 1,000 — going
   * higher requires a server-side config change we don't control on hosted
   * Supabase. Lower values are useful for memory-bounded callers. */
  pageSize?: number;
  /** Hard ceiling on total rows returned, as a paranoia stop. Defaults to
   * 200,000 — far larger than any v1 gym's data, but small enough that a
   * runaway loop fails loudly instead of OOMing. */
  maxRows?: number;
}

/**
 * Loops `.range(start, start + pageSize - 1)` against the query produced by
 * `factory()` until the response is shorter than `pageSize`. Returns all
 * accumulated rows.
 *
 * Each call to `factory()` MUST construct an independent query — re-using
 * a builder across iterations carries state from the previous .range().
 * The simplest correct shape is:
 *
 *   const rows = await paginate<Row>(() =>
 *     client.from("t").select("*").eq("gym_id", gymId).order("id"),
 *   );
 *
 * Ordering is the caller's responsibility. Without an `.order()`, page
 * boundaries can return inconsistent rows (PostgREST does not guarantee a
 * stable order across pages absent ORDER BY).
 */
export async function paginate<Row>(
  factory: () => RangeQuery<Row>,
  options: PaginateOptions = {},
): Promise<Row[]> {
  const pageSize = options.pageSize ?? 1000;
  const maxRows = options.maxRows ?? 200_000;

  if (pageSize <= 0) throw new Error("paginate: pageSize must be > 0");
  if (maxRows <= 0) throw new Error("paginate: maxRows must be > 0");

  const out: Row[] = [];
  let offset = 0;

  while (out.length < maxRows) {
    const upper = offset + pageSize - 1;
    const { data, error } = await factory().range(offset, upper);
    if (error) throw error;
    const page = data ?? [];
    out.push(...page);
    if (page.length < pageSize) return out;
    offset += pageSize;
  }

  throw new Error(
    `paginate: exceeded maxRows=${maxRows}. Either narrow the query or raise maxRows.`,
  );
}
