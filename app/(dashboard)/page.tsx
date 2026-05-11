// app/(dashboard)/page.tsx
//
// Phase 3B — monthly report with period selector.
//
// What this page is, intentionally:
//   * Server component. Fetches MetricsPack from the analytics-engine and
//     hands it to <DashboardView />, which renders.
//   * Period comes from ?period=YYYY-MM. The server validates it against
//     the gym's available periods (the set of months with any sales data).
//     Missing / malformed / unknown -> silent fallback to the newest
//     available period (see app/(dashboard)/_lib/periods.ts).
//   * Reads the gym config from `config/gyms/powerhouse_nyc.json` via
//     `fs.readFile`. PROJECT.md's "Open architectural questions" section
//     declares JSON files the canonical source of config in v1; the
//     `gym_configs` table is reserved for v2. We do NOT mix sources.
//
// Boundary discipline:
//   * This page is the report's seam where db helpers + analytics-engine
//     are called. (The /import page is its own seam for fact reads —
//     row counts, last-import metadata — that don't go through the
//     analytics engine.) Components below this page receive props and
//     render; they don't reach back to lib/db or lib/analytics.
//   * Multi-tenancy: gymId is resolved from session via requireSessionGym().
//     The page filters everything to that gym. We do NOT trust a slug
//     from the URL or body; ?period is the only URL-controlled input and
//     it cannot leak across gyms (the available-period list is itself
//     gym-scoped).
//   * Members snapshot filtering happens HERE: the page calls
//     getLatestSnapshotAsOfDate(period.end) + getMembersAsOf, then passes
//     the snapshot rows to the engine. The engine assumes a pre-filtered
//     snapshot.
//
// Snapshot cutoff at period.end:
//   For historical periods (e.g. selecting April when we're sitting in
//   May), feeding the engine the unconditionally-latest snapshot would
//   leak post-period state into the report — members who moved into
//   Pending Cancel AFTER the period ended would inflate that tile. We
//   pin the snapshot cutoff to `period.end` (the gym-local exclusive end
//   of the period, expressed as a UTC instant). See
//   lib/db/members.ts → getLatestSnapshotAsOfDate for the timezone
//   reasoning (informed by commit f67f068's queue_date fix).
//
//   Implication for thinly-populated data: if no snapshot exists at or
//   before period.end, the engine sees an empty members_snapshot. Pending
//   Cancel reads as 0, and the snapshot-derived slices for that period
//   are unavailable. This is correct: we have no observation, so we
//   report no observation rather than misattribute a future snapshot's
//   state.

import "server-only";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  cancellations as cancellationsDb,
  leads as leadsDb,
  members as membersDb,
  rfcEntries as rfcEntriesDb,
  sales as salesDb,
} from "@/lib/db";
import {
  calendarMonthPeriod,
  localDateString,
  runAnalytics,
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
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { requireSessionGym } from "./_lib/session";
import { listAvailablePeriods, resolvePeriodKey } from "./_lib/periods";
import { DashboardPeriodSelector } from "./_components/dashboard-period-selector";
import { DashboardEmptyState } from "./_components/dashboard-empty-state";

// Hardcoded gym slug for v1's JSON-config lookup. Multi-gym support in v1
// still routes through one gym at a time per session; the slug → config
// mapping will move to a `gyms.config_slug` column in v2. For now the
// dashboard's only customer is Powerhouse, and the slug is the same
// across deployments.
const POWERHOUSE_SLUG = "powerhouse_nyc";

const CONFIG_DIR = resolve(process.cwd(), "config", "gyms");

async function loadGymConfig(slug: string): Promise<GymConfig> {
  // PROJECT.md: in v1 the engine reads gym config from JSON files at
  // config/gyms/<slug>.json. The gym_configs table is reserved for v2.
  // Do NOT scatter config reads across sources.
  const text = await readFile(resolve(CONFIG_DIR, `${slug}.json`), "utf8");
  return JSON.parse(text) as GymConfig;
}

function periodLabelFor(periodKey: string, locale: string): string {
  // "2026-04" -> "April 2026 Monthly Report".
  const [yearStr, monthStr] = periodKey.split("-");
  const date = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1));
  const month = new Intl.DateTimeFormat(locale, {
    month: "long",
    timeZone: "UTC",
  }).format(date);
  return `${month} ${yearStr} Monthly Report`;
}

/** Pull `period` out of the searchParams record, accepting both Next 14's
 * resolved object and Next 15's Promise form. We hold the type loose
 * here so this page works regardless of which form Next is currently
 * shipping. */
function readPeriodFromParams(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): string | null {
  const v = searchParams?.period;
  if (typeof v === "string" && /^\d{4}-\d{2}$/.test(v)) return v;
  if (Array.isArray(v) && v.length > 0) {
    const first = v[0];
    if (typeof first === "string" && /^\d{4}-\d{2}$/.test(first)) return first;
  }
  return null;
}

type PageProps = {
  // Next 15 ships searchParams as a Promise. We `await` it below.
  searchParams: Promise<
    Record<string, string | string[] | undefined> | undefined
  >;
};

export default async function DashboardReportPage({ searchParams }: PageProps) {
  const { client, gymId } = await requireSessionGym();

  // Level-2 config — JSON file, not gym_configs table (v1).
  const config = await loadGymConfig(POWERHOUSE_SLUG);

  const gymName = config._meta.gym_name ?? config._meta.gym_slug;
  const locale = config.locale ?? "en-US";

  // ---- Resolve the period from the URL --------------------------------
  // 1. Enumerate periods the gym has sales for (one DB roundtrip).
  // 2. Read ?period= and validate. Missing / malformed / unknown -> silent
  //    fallback to newest (per Phase 3B decision).
  const available = await listAvailablePeriods(client, gymId, locale);
  const resolvedParams = await searchParams;
  const requestedPeriod = readPeriodFromParams(resolvedParams);
  const resolvedKey = resolvePeriodKey(available, requestedPeriod);

  // Selector renders even on the empty-state path so the user can switch
  // away from a typo'd URL with one click. When `available` is empty the
  // selector renders an inert "No periods available" pill (its own
  // empty-state).
  const selector = (
    <DashboardPeriodSelector
      options={available}
      value={resolvedKey ?? ""}
    />
  );

  if (!resolvedKey) {
    // No sales data at all for this gym — first-time setup, or a gym whose
    // imports haven't landed yet.
    return (
      <DashboardEmptyState
        gymName={gymName}
        hasAnyData={false}
        headerSlot={selector}
      />
    );
  }

  // Period bounds in the gym timezone (Level-2 from config).
  const period = calendarMonthPeriod(resolvedKey, config.timezone.value);
  // YMD strings for the cancellations helper, which compares against the
  // `cancel_date` column (a calendar date, not a timestamptz). Using the
  // engine's own `localDateString` keeps this identical to how the engine
  // formats period bounds internally — see lib/analytics/period.ts.
  const fromYmd = localDateString(period.start, period.timezone);
  const toYmd = localDateString(period.end, period.timezone);

  // ---- Members snapshot (page-level filtering) ------------------------
  // Cutoff is `period.end` (gym-local exclusive end as a UTC instant).
  // See header comment for the timezone reasoning; see
  // lib/db/members.ts → getLatestSnapshotAsOfDate for the helper.
  const latestAsOf = await membersDb.getLatestSnapshotAsOfDate(
    client,
    gymId,
    period.end,
  );
  const memberRows = latestAsOf
    ? await membersDb.getMembersAsOf(client, gymId, latestAsOf)
    : [];

  // ---- Other inputs in parallel ---------------------------------------
  const [leadRows, saleRows, rfcRows, cancelRows] = await Promise.all([
    // Engine filters leads by created_at locally and ALSO needs prior-month
    // leads on the sale-attribution path (a sale in April can match a March
    // lead). The helper paginates so we don't silently truncate at the
    // PostgREST 1,000-row default cap.
    leadsDb.getAllLeadsForGym(client, gymId),
    salesDb.getSalesForMonth(client, gymId, period.start, period.end),
    rfcEntriesDb.getRfcEntriesForMonth(client, gymId, period.start, period.end),
    cancellationsDb.getCancellationsInPeriod(client, gymId, fromYmd, toYmd),
  ]);

  // Cast db Row[] to the engine's parser-row type. The engine reads
  // only the fields that overlap with the Insert shape; extra columns
  // (id, imported_at) are ignored. This is the seam where two row
  // shapes meet and is the appropriate place for the cast.
  const engineInput: EngineInput = {
    gym_id: gymId,
    period,
    leads: leadRows as unknown as LeadRow[],
    sales: saleRows as unknown as SaleRow[],
    members_snapshot: memberRows as unknown as MemberRow[],
    rfc_entries: rfcRows as unknown as RfcRow[],
    cancellations: cancelRows as unknown as CancellationRow[],
    prior_period_current_member_base: null,
  };

  const pack = runAnalytics(engineInput, config);
  const periodLabel = periodLabelFor(period.key, locale);

  return (
    <DashboardView
      pack={pack}
      config={config}
      gymName={gymName}
      periodLabel={periodLabel}
      locale={locale}
      headerSlot={selector}
      // Whether a `members` snapshot existed at-or-before period.end. The
      // Pending Cancel banner uses this to append "no snapshot available
      // at <period> period end" when the engine ran with an empty
      // members_snapshot — distinguishing "we have no observation" from
      // "engine and PDF genuinely disagree." Dashboard-side because
      // explanatory copy is presentation concern; the engine's contract
      // (run with whatever snapshot you're given) doesn't need to grow
      // an explanation channel for the report layer's benefit.
      snapshotAvailable={latestAsOf !== null}
    />
  );
}
