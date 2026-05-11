// app/(dashboard)/_lib/periods.ts
//
// Phase 3B period-list helpers for the dashboard's period selector.
//
// Why this lives here (not in lib/db/ or lib/analytics/):
//   It's a UI composition step that projects raw `sales.queue_date` rows
//   into the calendar-month keys that drive the selector. The projection
//   is timezone-aware in exactly the way the analytics-engine's
//   `localDateString` is, so the selector's available periods can't drift
//   from what the engine's `calendarMonthPeriod(...)` filter accepts.
//
// Source of truth for "which periods have data": `sales.queue_date`.
//   v1 reports are sales-driven (Total Sales is the centerpiece metric),
//   so a month with no sales is effectively empty for dashboard purposes.
//   Other domains (leads, RFC, cancellations) frequently have rows
//   stretching outside the sales window — using them would surface dead
//   months in the selector. Sales is the right anchor.
//
// Boundary discipline: this module reads via lib/db/sales but does NOT
// reach into Supabase directly. It is consumed only by server components
// in app/(dashboard)/ — the client selector receives the projected
// `PeriodOption[]` as props.

import "server-only";

import { sales as salesDb, type DbClient } from "@/lib/db";

/** A single option for the dashboard period selector. */
export type PeriodOption = {
  /** Calendar-month key like "2026-04". Stable across refresh; URL-safe. */
  key: string;
  /** Display label like "April 2026". Computed in the gym locale. */
  label: string;
};

/** Format "2026-04" -> "April 2026" using BCP-47 locale. */
function periodKeyToLabel(key: string, locale: string): string {
  const [yearStr, monthStr] = key.split("-");
  // UTC midnight of the first of the month, formatted in UTC, gives the
  // month name without timezone drift (we're labeling a calendar key, not
  // a wall-clock instant).
  const d = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1));
  const month = new Intl.DateTimeFormat(locale, {
    month: "long",
    timeZone: "UTC",
  }).format(d);
  return `${month} ${yearStr}`;
}

/**
 * List the calendar-month periods that have any sales rows for `gymId`.
 * Sorted DESCENDING (newest first) — matches the selector's UX
 * requirement.
 *
 * Timezone semantics:
 *   We read raw `queue_date` strings from the DB (YYYY-MM-DD prefix) and
 *   bucket on that prefix directly. The parser writes `queue_date` as a
 *   plain calendar date in the gym's timezone (ABC's Queue Date has no
 *   timezone per spec p.1), so the YMD prefix already aligns with the
 *   gym-local month. Caller is expected to use the engine's
 *   `calendarMonthPeriod(key, gymTimezone)` to materialize the matching
 *   period bounds — that's where the IANA timezone is consumed.
 *
 *   When a future gym ships truly timezone-aware queue_date timestamps,
 *   this projection grows a `timezone` parameter and converts UTC
 *   instants to gym-local dates via `lib/analytics.localDateString`
 *   before bucketing. For v1 we intentionally don't accept the timezone
 *   here so the helper signature stays honest about what it does.
 */
export async function listAvailablePeriods(
  client: DbClient,
  gymId: string,
  locale: string,
): Promise<PeriodOption[]> {
  const dates = await salesDb.listDistinctSaleDates(client, gymId);
  const monthKeys = new Set<string>();
  for (const ymd of dates) {
    monthKeys.add(ymd.slice(0, 7));
  }
  return [...monthKeys]
    .sort()
    .reverse()
    .map((key) => ({ key, label: periodKeyToLabel(key, locale) }));
}

/**
 * Pick the period to render for this request.
 *
 * Resolution order:
 *   1. If `requestedKey` is present AND matches an available period -> use it.
 *   2. Otherwise (missing/malformed/unknown) -> newest available period
 *      (silent fallback per Phase 3B decision: a stale bookmarked URL or
 *      a hand-typed period that doesn't exist shouldn't 404 or display an
 *      error banner; the dashboard just falls back to the freshest data).
 *   3. If no periods exist at all -> null. Caller renders the empty state.
 *
 * NOTE: this intentionally does NOT default to "current month" — May 2026
 * has very little data in early May (the import lag is real), so the most
 * useful landing is the freshest *completed* period.
 */
export function resolvePeriodKey(
  available: PeriodOption[],
  requestedKey: string | null | undefined,
): string | null {
  if (available.length === 0) return null;
  if (requestedKey) {
    const hit = available.find((p) => p.key === requestedKey);
    if (hit) return hit.key;
  }
  return available[0].key; // available is sorted desc
}
