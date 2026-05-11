// app/(dashboard)/_lib/run-period.ts
//
// Phase 3C-1 — single-period engine-run helper.
//
// What this is:
//   * Server-only. Wraps the page's per-period data fetch + engine call
//     into a single function so multi-period work (the chart series
//     hydrator) can compose it without duplicating the seam.
//   * Input: an authenticated DbClient, the gym id, the gym's GymConfig,
//     and a calendar-month key like "2026-04".
//   * Output: an { pack, snapshotAvailable } pair. Same shape the page
//     uses for the primary period.
//
// Why this lives here (not in lib/db or lib/analytics):
//   It's a UI composition step — the dashboard's seam where db helpers
//   and the analytics engine meet. Both lib/db and lib/analytics stay
//   period-agnostic; this helper is what teaches a dashboard page to
//   ask "give me April" or "give me March."
//
// Boundary discipline:
//   * Calls lib/db helpers (the same set the page uses today).
//   * Calls runAnalytics() with the engine-shaped input.
//   * Does NOT import any Supabase client directly; the caller passes the
//     authenticated DbClient.
//   * Does NOT format any labels or copy — that lives in the page /
//     view layer. This helper just returns the raw MetricsPack.
//
// Multi-tenancy: the caller is responsible for resolving `gymId` from
// session BEFORE calling this. We trust the inputs because the only
// caller is the dashboard page, which already enforced
// requireSessionGym().
//
// Scaling note — chart series fan-out (Phase 3C-1):
//   The chart toggle on four metric sections (Lead Gen, Sales, Losses,
//   Membership) renders trailing-six-period series. The series hydrator
//   composes this helper across SIX periods in parallel (newest plus
//   five prior).
//
//   Lead-pool hoist (Phase 3C-1, round 2): the full per-gym `leads`
//   table is now fetched ONCE per page load by the caller (the
//   dashboard page) and threaded into each runPeriod() call via the
//   optional `leadsOverride` argument. Without the hoist the page paid
//   for `getAllLeadsForGym` SEVEN times per load (primary + six series
//   periods); with it, ONCE. The remaining per-period cost is
//   sales / RFC / cancellations / members-snapshot resolution — four
//   roundtrips per period plus the one shared leads fetch. At
//   Powerhouse-scale this is comfortably under the PostgREST
//   connection-pool budget. The scaling cliff is no longer about leads
//   fan-out; the next bottleneck is the per-period sales/cancellation
//   queries crossing tens of thousands of rows.
//
//   v2 mitigation paths, in order of cheapness:
//     1. Promote series fetching to a Postgres RPC that returns
//        pre-aggregated per-period counts (skips the engine fan-out for
//        the chart-only case; preserves it for the primary tile view).
//     2. Cache `MetricsPack`s by (gym_id, period_key, content_hash) so
//        prior-period results are reused across sessions; invalidate on
//        import.
//     3. Move chart-series rendering off the page-load critical path
//        entirely — `revalidate=3600` server cache + an explicit refresh
//        affordance after an import.
//   Mirrors the listDistinctSaleDates scaling-cliff comment in
//   lib/db/sales.ts: when it bites, it'll bite all at once.

import "server-only";

import {
  cancellations as cancellationsDb,
  leads as leadsDb,
  members as membersDb,
  rfcEntries as rfcEntriesDb,
  sales as salesDb,
  type DbClient,
} from "@/lib/db";
import {
  calendarMonthPeriod,
  localDateString,
  runAnalytics,
  type AnalyticsOutput,
  type EngineInput,
  type GymConfig,
} from "@/lib/analytics";
import type {
  CancellationRow,
  LeadRow,
  MemberRow,
  RfcRow,
  SaleRow,
} from "@/lib/parsers/types";

export type PeriodRunResult = {
  pack: AnalyticsOutput;
  /** Did a members snapshot exist at-or-before period.end? When false,
   * the engine ran with an empty members_snapshot — pending-cancel and
   * other snapshot-derived metrics will read as 0 because we have no
   * observation, not because the count is zero. Page-level copy uses
   * this to disambiguate in the Pending Cancel banner. */
  snapshotAvailable: boolean;
};

/**
 * Run the analytics engine for a single calendar-month period.
 *
 * @param client - authenticated Supabase server client (caller resolved auth).
 * @param gymId  - gym id from session (NEVER from URL / request body).
 * @param config - the gym's parsed GymConfig (loaded once by the caller).
 * @param periodKey - "YYYY-MM".
 * @param priorPeriodCurrent - the prior period's `current_member_base`
 *   for the membership flow-identity chain. Pass null for one-off runs
 *   (the engine will fall back to `config.membership.start_of_month_member_base.seed_value`
 *   for the seed period). The series builder chains this across the
 *   window so membership-chart Current Member Base is meaningful at
 *   every point.
 * @param leadsOverride - optional pre-fetched lead pool for this gym.
 *   When provided, runPeriod skips its own `getAllLeadsForGym` call and
 *   uses the override. The dashboard page passes this in to hoist the
 *   lead-pool fetch out of the multi-period fan-out (one fetch per page
 *   load instead of seven). The engine still needs every lead for the
 *   gym (sale-attribution path looks at prior-month leads), so this
 *   override carries the FULL gym pool, not a period-filtered slice.
 */
export async function runPeriod(
  client: DbClient,
  gymId: string,
  config: GymConfig,
  periodKey: string,
  priorPeriodCurrent: number | null = null,
  leadsOverride?: LeadRow[],
): Promise<PeriodRunResult> {
  const period = calendarMonthPeriod(periodKey, config.timezone.value);
  const fromYmd = localDateString(period.start, period.timezone);
  const toYmd = localDateString(period.end, period.timezone);

  // Members snapshot cutoff is period.end (gym-local exclusive end as a
  // UTC instant). See app/(dashboard)/page.tsx header comment and
  // lib/db/members.ts → getLatestSnapshotAsOfDate for the timezone
  // reasoning. Historical periods get a snapshot pinned to their own
  // boundary, not the unconditionally-latest snapshot.
  const latestAsOf = await membersDb.getLatestSnapshotAsOfDate(
    client,
    gymId,
    period.end,
  );
  const memberRows = latestAsOf
    ? await membersDb.getMembersAsOf(client, gymId, latestAsOf)
    : [];

  // The engine needs prior-month leads on the sale-attribution path
  // (a sale in April can match a March lead). When the caller hoisted
  // the lead pool out (multi-period fan-out), we reuse it; otherwise
  // we fetch it here. Paginated to avoid the PostgREST 1k cap.
  const leadsPromise: Promise<LeadRow[]> = leadsOverride
    ? Promise.resolve(leadsOverride)
    : (leadsDb.getAllLeadsForGym(client, gymId) as unknown as Promise<
        LeadRow[]
      >);
  const [leadRows, saleRows, rfcRows, cancelRows] = await Promise.all([
    leadsPromise,
    salesDb.getSalesForMonth(client, gymId, period.start, period.end),
    rfcEntriesDb.getRfcEntriesForMonth(client, gymId, period.start, period.end),
    cancellationsDb.getCancellationsInPeriod(client, gymId, fromYmd, toYmd),
  ]);

  const engineInput: EngineInput = {
    gym_id: gymId,
    period,
    leads: leadRows as unknown as LeadRow[],
    sales: saleRows as unknown as SaleRow[],
    members_snapshot: memberRows as unknown as MemberRow[],
    rfc_entries: rfcRows as unknown as RfcRow[],
    cancellations: cancelRows as unknown as CancellationRow[],
    prior_period_current_member_base: priorPeriodCurrent,
  };

  const pack = runAnalytics(engineInput, config);
  return { pack, snapshotAvailable: latestAsOf !== null };
}
