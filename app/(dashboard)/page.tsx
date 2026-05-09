// app/(dashboard)/page.tsx
//
// "Your Data" home view. Server component.
//
// Scope: Task 1 only renders facts about what's been imported (last import
// date, per-source row counts, empty state). No analytics, no charts,
// no MetricsPack — those land in Task 3.
//
// Boundary: this server component talks to lib/db/ for raw counts (which
// are facts, not derived metrics). Anything computed (conversion, MRR,
// attrition) must come from the analytics-engine, never from here.

import { CheckCircle2Icon, FileWarningIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ImportDialog } from "@/components/import-dialog";
import { Button } from "@/components/ui/button";
import {
  importHistory as importHistoryDb,
  leads as leadsDb,
  sales as salesDb,
  members as membersDb,
  rfcEntries as rfcEntriesDb,
  cancellations as cancellationsDb,
  gymConfigs as gymConfigsDb,
} from "@/lib/db";
import { requireSessionGym } from "./_lib/session";
import { PeriodSelectorClient } from "./_components/period-selector-client";

// Level 1 universal source list — every gym ingests these five formats.
// Per-gym customization lives in gym_configs (e.g., a gym without RFC
// might hide that row), not in branching here.
const SOURCES: { format: string; label: string }[] = [
  { format: "leads", label: "Leads" },
  { format: "abc_sales", label: "Sales" },
  { format: "abc_members", label: "Members" },
  { format: "abc_rfc", label: "RFC" },
  { format: "cancel_ledger", label: "Cancellations" },
];

type Locale = { code: string; timeZone: string };

function readLocaleFromConfig(config: unknown): Locale {
  // Level 2: locale + tz come from config; we fall back to the gym's tz
  // already on the gyms row, but the gyms row isn't passed here so we use
  // sane defaults if nothing's set. The locale fallback intentionally
  // doesn't hardcode "en-US" beyond this last-resort default — every
  // formatter call below threads through `locale.code`.
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const c = config as Record<string, unknown>;
    const code = typeof c.locale === "string" ? c.locale : undefined;
    const tz = typeof c.timezone === "string" ? c.timezone : undefined;
    if (code || tz) {
      return {
        code: code ?? "en-US",
        timeZone: tz ?? "UTC",
      };
    }
  }
  return { code: "en-US", timeZone: "UTC" };
}

export default async function DashboardHome() {
  const { client, gymId } = await requireSessionGym();

  // Pull facts in parallel.
  const [
    config,
    history,
    leadsCount,
    salesCount,
    rfcCount,
    cancelCount,
    latestSnapshotAsOf,
  ] = await Promise.all([
    gymConfigsDb.getGymConfigJson(client, gymId),
    importHistoryDb.listRecentImports(client, gymId, 50),
    countRows(client, gymId, "leads"),
    countRows(client, gymId, "sales"),
    countRows(client, gymId, "rfc_entries"),
    countRows(client, gymId, "cancellations"),
    membersDb.getLatestSnapshotAsOf(client, gymId),
  ]);

  // Members are snapshot rows; "row count" for the home tile is the size
  // of the latest snapshot, not all snapshots ever.
  const membersCount = latestSnapshotAsOf
    ? await membersDb.countMembersAsOf(client, gymId, latestSnapshotAsOf)
    : 0;

  const counts: Record<string, number> = {
    leads: leadsCount,
    abc_sales: salesCount,
    abc_members: membersCount,
    abc_rfc: rfcCount,
    cancel_ledger: cancelCount,
  };

  const successfulImports = history.filter(
    (h) => h.format !== "unknown" && h.row_count > 0,
  );
  const lastImport = successfulImports[0] ?? null;
  const isEmpty = successfulImports.length === 0;

  const locale = readLocaleFromConfig(config);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your data</h1>
          <p className="text-sm text-muted-foreground">
            What's currently imported into Pulsar.
          </p>
        </div>
        <PeriodSelectorClient />
      </div>

      {isEmpty ? (
        <EmptyState />
      ) : (
        <>
          <LastImportBanner
            filename={lastImport?.filename ?? null}
            importedAt={lastImport?.imported_at ?? null}
            locale={locale}
          />
          <SourceCounts counts={counts} latestSnapshotAsOf={latestSnapshotAsOf} locale={locale} />
        </>
      )}
    </div>
  );
}

async function countRows(
  client: Awaited<ReturnType<typeof requireSessionGym>>["client"],
  gymId: string,
  table: "leads" | "sales" | "rfc_entries" | "cancellations",
): Promise<number> {
  // We deliberately query each table directly with a head-only count —
  // these are cheap fact reads, not derived analytics. The lib/db helpers
  // have monthly-window counts but no "all-time" count yet. This is the
  // appropriate place to inline that since it's a one-line query.
  const { error, count } = await client
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("gym_id", gymId);
  if (error) throw error;
  return count ?? 0;
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <FileWarningIcon className="size-8 text-muted-foreground" />
        <div className="space-y-1">
          <div className="text-base font-medium">No data yet</div>
          <p className="max-w-sm text-sm text-muted-foreground">
            Import your first CSV file to start computing metrics. Pulsar
            accepts the five standard exports — leads, sales, member
            snapshot, RFC, and cancellations.
          </p>
        </div>
        <ImportDialog>
          <Button>Import your first file</Button>
        </ImportDialog>
      </CardContent>
    </Card>
  );
}

function LastImportBanner({
  filename,
  importedAt,
  locale,
}: {
  filename: string | null;
  importedAt: string | null;
  locale: Locale;
}) {
  if (!filename || !importedAt) return null;
  const dt = new Date(importedAt);
  const fmt = new Intl.DateTimeFormat(locale.code, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: locale.timeZone,
  });
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
      <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600" />
      <span className="text-muted-foreground">Last import:</span>
      <span className="truncate font-medium">{filename}</span>
      <Separator orientation="vertical" className="mx-1 h-4" />
      <span className="text-muted-foreground">{fmt.format(dt)}</span>
    </div>
  );
}

function SourceCounts({
  counts,
  latestSnapshotAsOf,
  locale,
}: {
  counts: Record<string, number>;
  latestSnapshotAsOf: Date | null;
  locale: Locale;
}) {
  const numberFmt = new Intl.NumberFormat(locale.code);
  const dateFmt = new Intl.DateTimeFormat(locale.code, {
    dateStyle: "medium",
    timeZone: locale.timeZone,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Imported rows</CardTitle>
        <CardDescription>
          Per-source row counts across this gym's data.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {SOURCES.map((s) => (
            <div
              key={s.format}
              className="rounded-lg border bg-background/40 p-3"
            >
              <div className="text-xs font-medium uppercase text-muted-foreground">
                {s.label}
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {numberFmt.format(counts[s.format] ?? 0)}
              </div>
              {s.format === "abc_members" && latestSnapshotAsOf && (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Snapshot · {dateFmt.format(latestSnapshotAsOf)}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
