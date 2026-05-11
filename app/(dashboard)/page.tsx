// app/(dashboard)/page.tsx
//
// Phase 3B — monthly report with period selector.
// Phase 3C-1 — per-section chart toggles for four metric sections,
//              backed by a trailing-six-period series.
//
// What this page is, intentionally:
//   * Server component. Fetches the primary period's MetricsPack from the
//     analytics-engine (via runPeriod()), hands it to <DashboardView />,
//     and starts a parallel <Suspense>-streamed series fetch across the
//     trailing six periods for the in-section chart toggles.
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
//   * Members snapshot filtering is delegated to runPeriod() (which
//     applies the same period.end cutoff the page used to apply inline).
//     See app/(dashboard)/_lib/run-period.ts for the helper.
//
// Snapshot cutoff at period.end:
//   Pinned in runPeriod(). For historical periods (e.g. selecting April
//   when we're sitting in May), feeding the engine the unconditionally-
//   latest snapshot would leak post-period state into the report.
//   See lib/db/members.ts → getLatestSnapshotAsOfDate for the timezone
//   reasoning (informed by commit f67f068's queue_date fix). When no
//   snapshot exists at or before period.end the engine runs with an
//   empty members_snapshot — Pending Cancel reads 0 by construction;
//   the dashboard surfaces that as "no snapshot available" copy on the
//   Pending Cancel banner rather than treating it as a real reconciliation
//   variance.

import "server-only";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as React from "react";

import { type GymConfig } from "@/lib/analytics";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { SeriesHydrator } from "@/components/dashboard/series-hydrator";
import { SeriesErrorPusher } from "@/components/dashboard/series-error-pusher";
import { leads as leadsDb } from "@/lib/db";
import { requireSessionGym } from "./_lib/session";
import { listAvailablePeriods, resolvePeriodKey } from "./_lib/periods";
import { runPeriod } from "./_lib/run-period";
import { buildTrailingWindow, fetchSeries } from "./_lib/series";
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

  // ---- Lead pool: fetched ONCE per page load --------------------------
  // The engine needs every lead for the gym on the sale-attribution path
  // (a sale in April can match a March lead). Before round-2 review, we
  // re-fetched this seven times per page load (primary + six series
  // periods). Now we fetch once and thread it through both the primary
  // runPeriod call AND every series period via the `leadsOverride`
  // argument. See app/(dashboard)/_lib/run-period.ts header for the
  // hoist rationale.
  const leads = await leadsDb.getAllLeadsForGym(client, gymId);

  // ---- Series for chart toggles (suspended) ---------------------------
  // Trailing six periods ending at the primary. Built off the same
  // available-periods list so we never query for a period the gym
  // doesn't have data for.
  //
  // Why we don't await this here: it would block first paint on five
  // additional engine runs. Wrapping it in <Suspense> below lets React
  // stream the primary tiles to the browser first; the chart series
  // arrives a moment later and the four toggleable sections update via
  // context.
  //
  // We BUILD this promise above the primary await so the series fan-out
  // starts in parallel with the primary period's data fetches. The
  // awaiting happens inside <Suspense> below.
  //
  // See app/(dashboard)/_lib/run-period.ts header for the scaling-cliff
  // notes on this multi-period fan-out.
  const trailingWindow = buildTrailingWindow(available, resolvedKey);
  const seriesPromise = fetchSeries(
    client,
    gymId,
    config,
    trailingWindow,
    leads,
  );

  // ---- Primary period: engine run via run-period helper ---------------
  // The seam where db helpers + analytics engine meet. The helper does
  // the same fetch+filter dance the page used to do inline; pulling it
  // out lets the series hydrator below compose the SAME helper across
  // the trailing six periods without duplicating logic.
  const { pack, snapshotAvailable } = await runPeriod(
    client,
    gymId,
    config,
    resolvedKey,
    null,
    leads,
  );
  const periodLabel = periodLabelFor(resolvedKey, locale);

  const seriesSlot = (
    <React.Suspense fallback={null}>
      <AwaitSeriesHydrator promise={seriesPromise} />
    </React.Suspense>
  );

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
      snapshotAvailable={snapshotAvailable}
      seriesSlot={seriesSlot}
    />
  );
}

/** Tiny server-side awaiter so we can keep the SeriesHydrator a
 * non-async component. React 19 supports awaiting in server components,
 * which suspends rendering until the promise resolves; the parent
 * <Suspense> shows its fallback (null — invisible) until then.
 *
 * Error handling: a transient PostgREST hiccup on any of the six
 * parallel runs inside fetchSeries() throws. We catch it here and push
 * the SeriesProvider into its "error" state so the per-section chart
 * toggle degrades gracefully (the toggle shows "Could not load trend
 * data." inside chart view; tile view is unaffected because tiles read
 * the primary period's pack, not the series pack). Letting the throw
 * propagate would crash the entire route, which is the wrong tradeoff
 * — the primary tiles are the report; the chart series is enhancement. */
async function AwaitSeriesHydrator({
  promise,
}: {
  promise: Promise<Parameters<typeof SeriesHydrator>[0]["pack"]>;
}) {
  try {
    const pack = await promise;
    return <SeriesHydrator pack={pack} />;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return <SeriesErrorPusher message={message} />;
  }
}
