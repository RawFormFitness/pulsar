// components/dashboard/dashboard-view.tsx
//
// Server component. Composes the full monthly report from a MetricsPack
// produced by the analytics-engine, plus the gym's Level-2 config.
//
// Boundary: this component receives `pack` and `config` as props. It
// does NOT import lib/db, lib/analytics, or any Supabase client. The
// page (app/(dashboard)/page.tsx) does the data fetching and hands
// the pack/config in.
//
// Level-1 contract: every section iterates pack.<section>.display
// (or pack.pipeline_velocity.channels for the table) — never a
// hand-rolled tile per Powerhouse-specific metric. The losses tile set
// is driven by config.cancellations.losses_tiles and the engine's
// display_label translation; neither is hardcoded here.

import * as React from "react";

import type { AnalyticsOutput, GymConfig } from "@/lib/analytics";
import { MetricSection } from "./metric-section";
import { MetricTile } from "./metric-tile";
import {
  ReconciliationBanner,
  type ReconciliationBannerProps,
} from "./reconciliation-banner";
import { SectionReconciliationBanner } from "./section-reconciliation-banner";
import { ValidationBanner, type ValidationFailure } from "./validation-banner";
import { VelocityGrid } from "./velocity-grid";

export type DashboardViewProps = {
  pack: AnalyticsOutput;
  config: GymConfig;
  /** Header copy. Page derives this from config + period — never
   * hardcoded gym strings here. */
  gymName: string;
  periodLabel: string;
  /** BCP-47 locale for number/date formatting. */
  locale: string;
};

/** Build a one-line failure summary from a validation check's `details`
 * payload. Universal: we never cherry-pick by check name; we just
 * stringify the keys/values of the details object that the engine
 * already shipped. The validation block's shape is the engine's
 * concern; we render whatever it gives us. */
function summarizeDetails(details: unknown): string {
  if (!details || typeof details !== "object") return "Failed";
  const entries = Object.entries(details as Record<string, unknown>);
  if (entries.length === 0) return "Failed";
  return entries
    .map(([k, v]) => {
      if (v === null || v === undefined) return `${k}=null`;
      if (typeof v === "object") return `${k}=${JSON.stringify(v)}`;
      return `${k}=${String(v)}`;
    })
    .join(", ");
}

export function DashboardView({
  pack,
  config,
  gymName,
  periodLabel,
  locale,
}: DashboardViewProps) {
  // ---- Validation banner -------------------------------------------------
  const failures: ValidationFailure[] = pack.validation_results
    .filter((r) => !r.passed)
    .map((r) => ({
      name: r.name,
      summary: summarizeDetails(r.details),
    }));

  // ---- Sections ----------------------------------------------------------

  // Lead Generation: tiles iterated from pack.lead_generation.display.
  const leadEntries = Object.entries(pack.lead_generation.display);

  // Lead-generation reconciliation banner. Surfaced ONCE at the section
  // level (between title and tile grid) when the engine flags
  // `pack.lead_generation.known_gap`. The cascade copy explicitly tells
  // the user that downstream sections (sales-by-channel, conversion,
  // velocity) inherit this variance — that's why we don't add per-tile
  // banners to those sections. Adding more would clutter and undermine
  // the mental model that ONE upstream gap explains all downstream
  // drift.
  //
  // Engine values come from pack.lead_generation.internal (keys like
  // "web_leads", "walk_in_leads", "total_leads"). PDF values come from
  // pack.lead_generation.pdf_values keyed identically. Display labels
  // come from config.display_labels.lead_generation; missing entries
  // fall back to the engine's default labels via the same chain the
  // engine itself uses. NEVER hardcode "Web Leads"/"Walk-in Leads"/
  // "Total Leads" copy here — a future gym can override.
  //
  // TODO(v2): plumb the doc URL through pack.lead_generation.doc_link
  // (the engine could populate from `_known_gap.doc_link`, which
  // already exists in the gym config). For v1 the URL is hardcoded to
  // the GitHub blob path, mirroring the Pending Cancel banner.
  let leadGenBanner: React.ReactNode = null;
  if (
    pack.lead_generation.known_gap &&
    pack.lead_generation.pdf_values
  ) {
    const internal = pack.lead_generation.internal;
    const pdfValues = pack.lead_generation.pdf_values;
    const labels: Record<string, string> = {
      web_leads:
        config.display_labels?.lead_generation?.web_leads ?? "Web Leads",
      walk_in_leads:
        config.display_labels?.lead_generation?.walk_in_leads ??
        "Walk-in Leads",
      total_leads:
        config.display_labels?.lead_generation?.total_leads ?? "Total Leads",
    };
    // Render the keys actually present on the PDF-values payload that the
    // gym's config recorded, in the engine's emission order. A future gym
    // whose `channels.reported` is e.g. ["web","phone"] gets `web_leads`
    // + `phone_leads` rendered without a code change here.
    const keys = Object.keys(pdfValues).filter((k) => k in internal);
    const engineValues: Record<string, number> = {};
    const pdfNumeric: Record<string, number> = {};
    for (const k of keys) {
      engineValues[k] = internal[k];
      pdfNumeric[k] = pdfValues[k];
    }
    leadGenBanner = (
      <SectionReconciliationBanner
        title="PDF report shows different per-channel splits"
        engineValues={engineValues}
        pdfValues={pdfNumeric}
        labels={labels}
        order={keys}
        cascadeNote="Downstream metrics — sales by channel, conversion ratios, velocity — inherit this variance."
        // Absolute URL to the reconciliation note on GitHub. A relative
        // path resolves against the route (e.g. /dashboard) and 404s.
        // Repo is currently RawFormFitness/pulsar; if/when that changes
        // (rename, fork) update in lockstep with the Pending Cancel
        // banner's docHref.
        docHref="https://github.com/RawFormFitness/pulsar/blob/main/docs/lead_generation_reconciliation.md"
      />
    );
  }

  // Sales: tiles iterated from pack.sales.display.
  const salesEntries = Object.entries(pack.sales.display);

  // Conversion: pre-formatted "x.x%" strings; pass through.
  const conversionEntries = Object.entries(pack.conversion.display);

  // Losses: tile order comes from the engine's `display` map (which the
  // engine already ordered per config.cancellations.losses_tiles). We
  // attach the Pending Cancel reconciliation banner on the tile whose
  // display label matches the engine's translation of the
  // `pending_cancel` tile key. Mirrors the same fallback chain the
  // engine uses (config.display_labels.losses.pending_cancel ->
  // built-in default "Pending Cancel"). Resolving the label this way
  // (rather than pattern-matching on engine OUTPUT values) means two
  // tiles with the same number won't collide and a config rename will
  // flow through correctly.
  const lossesEntries = Object.entries(pack.losses.display);
  const pendingCancelLabel =
    config.display_labels?.losses?.pending_cancel ?? "Pending Cancel";

  // Membership: tiles per pack.membership.display, with format hints
  // derived from value type (string => passthrough; net_gain => signed).
  // We resolve the net-gain label from the configured display label so
  // we don't pattern-match on copy. Defaults to "Net Gain" via the
  // engine's DEFAULT_LABELS fallback path.
  const netGainLabel =
    config.display_labels?.membership?.net_gain ?? "Net Gain";

  // Pipeline velocity:
  const channelLabels = Object.keys(pack.pipeline_velocity.channels);
  const bucketLabels = config.velocity_buckets.buckets.map(
    (b) => b.display_label,
  );
  const totalLabel =
    config.display_labels?.sales?.total_sales ?? "Total Sales";

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="space-y-1">
        <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {periodLabel}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{gymName}</h1>
      </header>

      {/* Validation banner — top of page, only when failures exist. */}
      {failures.length > 0 ? <ValidationBanner failures={failures} /> : null}

      {/* Lead Generation */}
      <MetricSection title="Lead Generation" banner={leadGenBanner}>
        {leadEntries.map(([label, value]) => (
          <MetricTile
            key={label}
            label={label}
            value={value}
            locale={locale}
          />
        ))}
      </MetricSection>

      {/* Sales */}
      <MetricSection title="Sales">
        {salesEntries.map(([label, value]) => (
          <MetricTile
            key={label}
            label={label}
            value={value}
            locale={locale}
          />
        ))}
      </MetricSection>

      {/* Conversion */}
      <MetricSection title="Conversion">
        {conversionEntries.map(([label, value]) => (
          <MetricTile
            key={label}
            label={label}
            value={value}
            format="passthrough"
            locale={locale}
          />
        ))}
      </MetricSection>

      {/* Losses */}
      <MetricSection title="Losses">
        {lossesEntries.map(([label, value]) => {
          const isPendingCancel = label === pendingCancelLabel;
          let sideSlot: React.ReactNode = null;
          if (
            isPendingCancel &&
            pack.losses.pending_cancel_known_gap &&
            typeof pack.losses.pending_cancel_pdf_value === "number"
          ) {
            const banner: ReconciliationBannerProps = {
              label,
              engineValue: value,
              pdfValue: pack.losses.pending_cancel_pdf_value,
              // Absolute URL to the reconciliation note on GitHub. A
              // relative path resolves against the route (e.g. /dashboard)
              // and 404s. The repo is currently hosted at
              // RawFormFitness/pulsar; if/when that changes (rename, fork)
              // this URL needs updating in lockstep.
              docHref:
                "https://github.com/RawFormFitness/pulsar/blob/main/docs/pending_cancel_reconciliation.md",
            };
            sideSlot = <ReconciliationBanner {...banner} />;
          }
          return (
            <MetricTile
              key={label}
              label={label}
              value={value}
              locale={locale}
              sideSlot={sideSlot}
            />
          );
        })}
      </MetricSection>

      {/* Membership */}
      <MetricSection title="Membership">
        {Object.entries(pack.membership.display).map(([label, value]) => {
          const isString = typeof value === "string";
          const format: "number" | "signed_number" | "passthrough" = isString
            ? "passthrough"
            : label === netGainLabel
              ? "signed_number"
              : "number";
          return (
            <MetricTile
              key={label}
              label={label}
              value={value}
              format={format}
              locale={locale}
            />
          );
        })}
      </MetricSection>

      {/* Pipeline Velocity */}
      <section className="space-y-3">
        <div className="space-y-0.5">
          <h2 className="text-lg font-semibold tracking-tight">
            Pipeline Velocity
          </h2>
          <p className="text-sm text-muted-foreground">
            How quickly leads convert to sales, by channel.
          </p>
        </div>
        <VelocityGrid
          channelLabels={channelLabels}
          bucketLabels={bucketLabels}
          totalLabel={totalLabel}
          channels={pack.pipeline_velocity.channels}
          locale={locale}
        />
      </section>
    </div>
  );
}
