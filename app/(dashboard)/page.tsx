// app/(dashboard)/page.tsx
//
// Phase 3A — STATIC April 2026 monthly report for Powerhouse NYC.
//
// What this page is, intentionally:
//   * Server component. Fetches MetricsPack from the analytics-engine and
//     hands it to <DashboardView />, which renders.
//   * Hardcoded to April 2026 + Powerhouse NYC. No period or gym selector.
//     v1's only customer is Powerhouse, and the engine output for Apr 2026
//     is the v1 acceptance test target.
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
//     from the URL or body.
//   * Members snapshot filtering happens HERE: the page calls
//     getLatestSnapshotAsOf + getMembersAsOf, then passes the snapshot
//     rows to the engine. The engine assumes a pre-filtered snapshot.

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

// Phase 3A: hardcoded to April 2026 for the static acceptance render.
// When period selection re-lands the value comes from the URL/state.
const PERIOD_KEY = "2026-04";

// Hardcoded gym slug. Multi-gym support in v1 still routes through one
// gym at a time per session; this page assumes the session resolves to
// the Powerhouse gym for now. If a future test gym is wired in, the
// slug comes from gym_meta lookup keyed off session.gymId, not from a
// URL param.
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
  // "2026-04" -> "April 2026 Monthly Report" (per the user spec).
  const [yearStr, monthStr] = periodKey.split("-");
  const date = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1));
  const month = new Intl.DateTimeFormat(locale, {
    month: "long",
    timeZone: "UTC",
  }).format(date);
  return `${month} ${yearStr} Monthly Report`;
}

export default async function DashboardReportPage() {
  const { client, gymId } = await requireSessionGym();

  // Level-2 config — JSON file, not gym_configs table (v1).
  const config = await loadGymConfig(POWERHOUSE_SLUG);

  // Period bounds in the gym timezone (Level-2 from config).
  const period = calendarMonthPeriod(PERIOD_KEY, config.timezone.value);
  // YMD strings for the cancellations helper, which compares against the
  // `cancel_date` column (a calendar date, not a timestamptz). Using the
  // engine's own `localDateString` keeps this identical to how the engine
  // formats period bounds internally — see lib/analytics/period.ts.
  const fromYmd = localDateString(period.start, period.timezone);
  const toYmd = localDateString(period.end, period.timezone);

  // ---- Members snapshot (page-level filtering, per Phase 3A spec) ----
  // 1. Find latest as_of for this gym.
  // 2. Fetch the rows at that as_of.
  // 3. Hand to engine.
  const latestAsOf = await membersDb.getLatestSnapshotAsOf(client, gymId);
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

  // Header copy: gym name + period label, both Level-2/derived. Never
  // hardcoded gym strings in components below this point.
  const gymName = config._meta.gym_name ?? config._meta.gym_slug;
  // Locale: read from config (BCP-47), default to "en-US". Powerhouse
  // leaves it unset and rides the default; a future fr-CA gym sets
  // config.locale = "fr-CA" and Intl.* formatting follows.
  const locale = config.locale ?? "en-US";
  const periodLabel = periodLabelFor(period.key, locale);

  return (
    <DashboardView
      pack={pack}
      config={config}
      gymName={gymName}
      periodLabel={periodLabel}
      locale={locale}
    />
  );
}
