// lib/analytics/run.ts
//
// Engine entry point. Pure function: (input, config) -> AnalyticsOutput.
//
// Pipeline:
//   1. Resolve the channel-attribution module (Level-3, optional).
//   2. Classify every lead in the input pool. Build a normalized-name
//      index for sale matching.
//   3. Filter leads to the period; compute per-reported-channel counts.
//   4. Filter sales to the period; classify each via the matched lead +
//      attribution module; apply plan exclusions; count per channel.
//   5. Compute conversions, velocity, losses, membership, validations.
//   6. Emit AnalyticsOutput in the dashboard's display shape.

import type { LeadRow, SaleRow } from "@/lib/parsers/types";
import { isExcludedSale } from "./plans";
import {
  buildLeadIndex,
  classifyLeads,
  classifySale,
} from "./channels";
import { computeConversions, ratioToOneDecimalPercent } from "./conversion";
import { computeVelocity } from "./velocity";
import { computeLosses } from "./losses";
import { attritionToTwoDecimalPercent, computeMembership } from "./membership";
import { runValidations } from "./validation";
import { getAttributionModule } from "./modules/registry";
import { isLocalDateInPeriod } from "./period";
import type {
  AnalyticsOutput,
  ChannelKey,
  ClassifiedSale,
  EngineInput,
  GymConfig,
} from "./types";

/** Default display-label conventions when the gym doesn't override.
 *
 * These are FALLBACKS only. Every label in this table is overridable by
 * the gym's `display_labels` config block — including the per-channel
 * keys (e.g. "Web Leads") AND the cross-channel totals row keys
 * ("Total Leads", "Total Sales"). The engine consults the override map
 * first and falls back here only when nothing is configured. */
const DEFAULT_LABELS = {
  lead_generation: {
    web: "Web Leads",
    walk_in: "Walk-in Leads",
    total_leads: "Total Leads",
  },
  sales: {
    web: "Web Sales",
    walk_in: "Walk-in Sales",
    total_sales: "Total Sales",
  },
  losses: {
    cancels: "Cancels",
    rfc: "RFC",
    revocations: "Revocations",
    pending_cancel: "Pending Cancel",
  },
  membership: {
    start_of_month_member_base: "Start-of-Month Member Base",
    current_member_base: "Current Member Base",
    net_gain: "Net Gain",
    attrition_rate: "Attrition Rate",
  },
  velocity_channels: { web: "Web", walk_in: "Walk-in" },
  velocity_total: "Total",
} as const;

/** Humanize a snake/kebab channel key: "walk_in" -> "Walk-in", "online" ->
 * "Online", "phone_v2" -> "Phone V2". Powerhouse's "walk_in" -> "Walk-in"
 * is a label convention; we keep underscores-as-hyphen for that pair. */
function humanize(s: string): string {
  return s
    .split("_")
    .map((p) => (p.length === 0 ? p : p[0].toUpperCase() + p.slice(1)))
    .join("-")
    .replace(/^-/, "");
}

/** Reads `cancellations.pending_cancel._known_gap` out of the gym config
 * and turns it into the optional `pending_cancel_known_gap` /
 * `pending_cancel_pdf_value` fields on the losses output. The gap is
 * period-scoped: it surfaces only when `gap.period_key` matches the
 * period being processed, so a gap recorded for April does not bleed
 * into May/June output. Returns `{ pending_cancel_known_gap: false }`
 * when no gap is configured or the period doesn't match. */
function buildPendingCancelGapFields(
  config: GymConfig,
  periodKey: string,
): { pending_cancel_known_gap?: boolean; pending_cancel_pdf_value?: number } {
  const gap = config.cancellations.pending_cancel?._known_gap;
  if (!gap || gap.period_key !== periodKey) {
    return { pending_cancel_known_gap: false };
  }
  const out: { pending_cancel_known_gap?: boolean; pending_cancel_pdf_value?: number } = {
    pending_cancel_known_gap: true,
  };
  if (typeof gap.pdf_value === "number") {
    out.pending_cancel_pdf_value = gap.pdf_value;
  }
  return out;
}

function labelFor(
  channel: ChannelKey,
  bucket: keyof typeof DEFAULT_LABELS,
  override: Record<string, string> | undefined,
): string {
  if (override && override[channel]) return override[channel];
  const def = DEFAULT_LABELS[bucket] as Record<string, string>;
  if (def[channel]) return def[channel];
  // Channel-keyed bucket falls back to humanized channel + suffix.
  if (bucket === "lead_generation") return `${humanize(channel)} Leads`;
  if (bucket === "sales") return `${humanize(channel)} Sales`;
  if (bucket === "velocity_channels") return humanize(channel);
  // For losses + membership the keys are tile/identity names, not channels.
  return humanize(channel);
}

export function runAnalytics(
  input: EngineInput,
  config: GymConfig,
): AnalyticsOutput {
  const moduleName = config.channel_attribution.lead_channel_module;
  const attribution = getAttributionModule(moduleName);

  const reported = config.channels.reported;
  const internalOnly = new Set(
    config.channels.internal_only_excluded_from_counts ?? [],
  );

  // ----- Leads -----
  const classifiedLeads = classifyLeads(input.leads, config, attribution);
  const leadIndex = buildLeadIndex(classifiedLeads);

  const inPeriodLead = (lead: LeadRow) => {
    if (!lead.created_at) return false;
    const t = Date.parse(lead.created_at);
    return t >= input.period.start.getTime() && t < input.period.end.getTime();
  };

  const leadCounts: Record<ChannelKey, number> = {};
  for (const ch of reported) leadCounts[ch] = 0;
  for (const cl of classifiedLeads) {
    if (!inPeriodLead(cl.row)) continue;
    if (internalOnly.has(cl.channel)) continue;
    if (leadCounts[cl.channel] === undefined) continue;
    leadCounts[cl.channel]++;
  }
  const totalLeads = reported.reduce((acc, ch) => acc + (leadCounts[ch] ?? 0), 0);

  // ----- Sales -----
  // queue_date is a calendar date in the gym's timezone (no offset). We
  // compare in local-date space to avoid the UTC-vs-local pitfall: if
  // ET is UTC-4, a "2026-04-01" date parsed as UTC midnight would be
  // 2026-03-31 20:00 ET — wrongly excluded from April. The period
  // helper compares YYYY-MM-DD strings against the period's local-date
  // start/end.
  const inPeriodSale = (sale: SaleRow) => {
    if (!sale.queue_date) return false;
    // Trim to YYYY-MM-DD if a fuller ISO was passed in.
    const ymd = sale.queue_date.slice(0, 10);
    return isLocalDateInPeriod(ymd, input.period);
  };

  // Classify only sales in the period. Plan exclusions filter rows out
  // before counting; spec p.1 Pre-Processing #4. Powerhouse's exclusions
  // can match against plan_name OR payment_plan — config opts in.
  const candidateSales = input.sales
    .filter(inPeriodSale)
    .filter((s) => !isExcludedSale(s, config));
  const classifiedSales: ClassifiedSale[] = candidateSales.map((s) =>
    classifySale(s, leadIndex, config, attribution, input.period.timezone),
  );

  const saleCounts: Record<ChannelKey, number> = {};
  for (const ch of reported) saleCounts[ch] = 0;
  for (const cs of classifiedSales) {
    if (saleCounts[cs.channel] === undefined) continue;
    saleCounts[cs.channel]++;
  }
  const totalSales = reported.reduce((acc, ch) => acc + (saleCounts[ch] ?? 0), 0);

  // ----- Conversion -----
  const conversions = computeConversions(
    classifiedLeads,
    classifiedSales,
    config,
    input.period,
  );

  // ----- Velocity -----
  const velocity = computeVelocity(classifiedSales, config);

  // ----- Losses -----
  const lossesResult = computeLosses(
    input.cancellations,
    input.rfc_entries,
    input.members_snapshot,
    config,
  );

  // ----- Membership -----
  const membership = computeMembership({
    totalSales,
    totalLossesForAttrition: lossesResult.internal.total_losses_for_attrition_and_net_gain,
    priorPeriodCurrent: input.prior_period_current_member_base ?? null,
    config,
  });

  // ----- Validation -----
  const validation = runValidations({
    config,
    saleCounts,
    totalLeads,
    totalSales,
    losses: lossesResult.internal,
    startOfMonth: membership.start_of_month_member_base,
    currentMemberBase: membership.current_member_base,
    conversions,
    velocity,
    classifiedSales,
  });

  // ----- Build dashboard output -----
  const labelOverrides = config.display_labels;

  const leadDisplay: Record<string, number> = {};
  const leadInternal: Record<string, number> & { total_leads: number } = {
    total_leads: totalLeads,
  };
  for (const ch of reported) {
    leadDisplay[labelFor(ch, "lead_generation", labelOverrides?.lead_generation)] =
      leadCounts[ch];
    leadInternal[`${ch}_leads`] = leadCounts[ch];
  }
  // Total-row label is itself Level-2 overridable. Falls back to
  // DEFAULT_LABELS.lead_generation.total_leads ("Total Leads") if no
  // gym-level override is provided.
  leadDisplay[
    labelOverrides?.lead_generation?.total_leads ??
      DEFAULT_LABELS.lead_generation.total_leads
  ] = totalLeads;

  const salesDisplay: Record<string, number> = {};
  const salesInternal: Record<string, number> & { total_sales: number } = {
    total_sales: totalSales,
  };
  for (const ch of reported) {
    salesDisplay[labelFor(ch, "sales", labelOverrides?.sales)] = saleCounts[ch];
    salesInternal[`${ch}_sales`] = saleCounts[ch];
  }
  // Total-row label is Level-2 overridable; default is "Total Sales".
  salesDisplay[
    labelOverrides?.sales?.total_sales ?? DEFAULT_LABELS.sales.total_sales
  ] = totalSales;

  // Conversion: round at presentation time only.
  const convDisplay: Record<string, string> = {};
  const convDisplayPct: Record<string, number> = {};
  const convRatios: Record<string, number | null> = {};
  for (const c of conversions) {
    const pct = ratioToOneDecimalPercent(c.ratio);
    convDisplay[c.label] = pct === null ? "N/A" : `${pct.toFixed(1)}%`;
    if (pct !== null) convDisplayPct[c.label] = pct;
    convRatios[c.key] = c.ratio;
  }

  // Losses display labels.
  const lossesDisplay: Record<string, number> = {};
  const tilesInOrder = config.cancellations.losses_tiles;
  const lossesInternalMap: Record<string, number> = {
    cancels: lossesResult.internal.cancels,
    rfc: lossesResult.internal.rfc,
    revocations: lossesResult.internal.revocations,
    pending_cancel: lossesResult.internal.pending_cancel,
  };
  for (const tile of tilesInOrder) {
    const label = labelFor(tile, "losses", labelOverrides?.losses);
    lossesDisplay[label] = lossesInternalMap[tile] ?? 0;
  }

  // Membership display.
  const memDisplay: Record<string, number | string> = {};
  memDisplay[labelFor("start_of_month_member_base", "membership", labelOverrides?.membership)] =
    membership.start_of_month_member_base;
  memDisplay[labelFor("current_member_base", "membership", labelOverrides?.membership)] =
    membership.current_member_base;
  memDisplay[labelFor("net_gain", "membership", labelOverrides?.membership)] =
    membership.net_gain;
  const attritionPct = attritionToTwoDecimalPercent(membership.attrition_ratio);
  memDisplay[labelFor("attrition_rate", "membership", labelOverrides?.membership)] =
    attritionPct === null ? "N/A" : `${attritionPct.toFixed(2)}%`;

  // Velocity rendering. Each channel row gets per-bucket {count,
  // display_percent, display}. Percentages round to whole numbers per
  // April_Output_Report.pdf.
  const velocityChannels: AnalyticsOutput["pipeline_velocity"]["channels"] = {};
  const velocityInternal: AnalyticsOutput["pipeline_velocity"]["internal"] = {};
  const reportChannels = config.velocity_buckets.report_channels;
  for (const rc of reportChannels) {
    const vc = velocity[rc];
    if (!vc) continue;
    const channelLabel =
      rc === "total"
        ? labelOverrides?.velocity_total ?? DEFAULT_LABELS.velocity_total
        : labelFor(rc, "velocity_channels", labelOverrides?.velocity_channels);
    const cells: Record<
      string,
      { count: number; display_percent: number; display: string }
    > = {};
    const total = vc.total;
    for (const b of config.velocity_buckets.buckets) {
      const c = vc.buckets[b.key] ?? 0;
      const pct = total === 0 ? 0 : Math.round((c / total) * 100);
      cells[b.display_label] = {
        count: c,
        display_percent: pct,
        display: `${c} (${pct}%)`,
      };
    }
    // Row-total label is Level-2 overridable via display_labels.sales.total_sales
    // (the same override used for the sales tile's totals row above) — falls
    // back to "Total Sales". A gym that renames its sales totals row also
    // renames the velocity row's running-total entry, so the two never drift.
    const totalSalesLabel =
      labelOverrides?.sales?.total_sales ?? DEFAULT_LABELS.sales.total_sales;
    const channelEntry: AnalyticsOutput["pipeline_velocity"]["channels"][string] = {
      ...cells,
      [totalSalesLabel]: total,
    };
    velocityChannels[channelLabel] = channelEntry;

    velocityInternal[rc] = {
      buckets: { ...vc.buckets },
      total: total,
    } as AnalyticsOutput["pipeline_velocity"]["internal"][string];
  }

  return {
    meta: {
      gym_id: input.gym_id,
      gym_slug: config._meta.gym_slug,
      period_key: input.period.key,
      period_start_iso: input.period.start.toISOString(),
      period_end_iso: input.period.end.toISOString(),
      timezone: input.period.timezone,
    },
    lead_generation: { display: leadDisplay, internal: leadInternal },
    sales: { display: salesDisplay, internal: salesInternal },
    conversion: {
      display: convDisplay,
      display_percentages: convDisplayPct,
      internal_ratios: convRatios,
      entries: conversions,
    },
    losses: {
      display: lossesDisplay,
      internal: lossesResult.internal,
      revocations_detail: lossesResult.revocations_detail,
      // Pending-cancel reconciliation marker. When the gym's config
      // declares its pending-cancel rule disagrees with a known
      // report-owner value FOR THIS PERIOD, surface that here so the
      // dashboard can show a reconciliation banner. The engine output
      // value itself is unchanged (always the rule-derived count); only
      // the marker changes. Absent block, or block whose period_key does
      // not match the period being processed, -> false (no known gap).
      ...buildPendingCancelGapFields(config, input.period.key),
    },
    membership: {
      display: memDisplay,
      internal: membership,
    },
    pipeline_velocity: {
      channels: velocityChannels,
      internal: velocityInternal,
    },
    validation_results: validation,
  };
}
