// lib/analytics/conversion.ts
//
// Conversion-metric registry + computer.
//
// The shape of every conversion metric is universal: numerator /
// denominator, with safe handling of zero denominators. The *which*
// numerator/denominator is config-specified by the metric's `formula`
// (a universal shape key) plus a `channel` parameter. This file maps
// each known formula to a Level-1 implementation; the config decides
// which formulas to surface, what to call them, and which channel each
// applies to.
//
// To add a new universal formula: extend FORMULAS below. To rename a
// label, reorder, change channel, or add a new channel-scoped metric,
// edit config — no code change.

import type { LeadRow } from "@/lib/parsers/types";
import { isLocalDateInPeriod } from "./period";
import type {
  ChannelKey,
  ClassifiedLead,
  ClassifiedSale,
  ConversionEntry,
  GymConfig,
  Period,
} from "./types";
import { normalizeSaleName } from "./names";

type FormulaInput = {
  channel: ChannelKey;
  classifiedLeads: ClassifiedLead[];
  classifiedSales: ClassifiedSale[];
  inPeriodLead: (lead: LeadRow) => boolean;
  waiverInPeriod: (lead: LeadRow) => boolean;
  period: Period;
  config: GymConfig;
};

type Formula = (input: FormulaInput) => { numerator: number; denominator: number };

/**
 * Universal conversion formulas, parameterized by channel. The config
 * declares each metric's display label, which formula key to use, and
 * which channel to apply it to. Powerhouse's four metrics map to two
 * formulas: visit_conversion (web), visit_to_sale_conversion (web), and
 * sales_conversion (one entry for web, one for walk_in).
 */
const FORMULAS: Record<string, Formula> = {
  // visit_conversion — leads in period (this channel) AND waiver in period
  //                    / leads in period (this channel).
  visit_conversion: ({ channel, classifiedLeads, inPeriodLead, waiverInPeriod }) => {
    let num = 0;
    let den = 0;
    for (const cl of classifiedLeads) {
      if (cl.channel !== channel) continue;
      if (!inPeriodLead(cl.row)) continue;
      den++;
      if (waiverInPeriod(cl.row)) num++;
    }
    return { numerator: num, denominator: den };
  },

  // visit_to_sale_conversion — leads in period (this channel) with waiver in
  //   period AND name in period sales / leads in period with waiver in period.
  visit_to_sale_conversion: ({
    channel,
    classifiedLeads,
    classifiedSales,
    inPeriodLead,
    waiverInPeriod,
  }) => {
    const saleNames = new Set(
      classifiedSales
        .map((s) => normalizeSaleName(s.row.member_name))
        .filter((s) => s.length > 0),
    );
    let num = 0;
    let den = 0;
    for (const cl of classifiedLeads) {
      if (cl.channel !== channel) continue;
      if (!inPeriodLead(cl.row)) continue;
      if (!waiverInPeriod(cl.row)) continue;
      den++;
      if (saleNames.has(cl.normalized_name)) num++;
    }
    return { numerator: num, denominator: den };
  },

  // sales_conversion — sales attributed to this channel in period /
  //                    leads in period (this channel).
  // Spec note (web variant): numerator counts sales matched to ANY prior
  // lead of this channel, even out-of-period leads — so it can exceed
  // the in-period lead count. Implementation: every sale with
  // channel==target counts in numerator (period-filter is implicit since
  // the engine only feeds in-period sales).
  sales_conversion: ({ channel, classifiedLeads, classifiedSales, inPeriodLead }) => {
    let den = 0;
    for (const cl of classifiedLeads) {
      if (cl.channel !== channel) continue;
      if (!inPeriodLead(cl.row)) continue;
      den++;
    }
    let num = 0;
    for (const cs of classifiedSales) {
      if (cs.channel !== channel) continue;
      num++;
    }
    return { numerator: num, denominator: den };
  },
};

/**
 * Map a config's metric `key` to its universal formula and applicable
 * channel. The Powerhouse v4 config uses keys like "web_visit_conversion"
 * — we split them as `<channel>_<formula>` for backwards compatibility,
 * but a config can also be explicit by setting `formula` and `channel`
 * fields directly. Either form works.
 */
function resolveMetric(meta: {
  key: string;
  formula?: string;
  channel?: ChannelKey;
}): { formula: Formula; channel: ChannelKey } {
  // Explicit form wins.
  if (meta.formula && meta.channel) {
    const f = FORMULAS[meta.formula];
    if (!f) throw new Error(`Unknown conversion formula "${meta.formula}".`);
    return { formula: f, channel: meta.channel };
  }
  // Compatibility form: parse "<channel>_<formula>" out of the key.
  // Recognized formulas: visit_conversion, visit_to_sale_conversion,
  // sales_conversion. We do longest-suffix match.
  const formulaSuffixes = Object.keys(FORMULAS).sort((a, b) => b.length - a.length);
  for (const suf of formulaSuffixes) {
    if (meta.key.endsWith(`_${suf}`)) {
      const channel = meta.key.slice(0, meta.key.length - suf.length - 1);
      return { formula: FORMULAS[suf], channel };
    }
  }
  throw new Error(
    `Cannot resolve conversion metric key "${meta.key}". Use either an explicit { formula, channel } pair or the convention <channel>_<formula> with formula in {${formulaSuffixes.join(", ")}}.`,
  );
}

export function computeConversions(
  classifiedLeads: ClassifiedLead[],
  classifiedSales: ClassifiedSale[],
  config: GymConfig,
  period: Period,
): ConversionEntry[] {
  const inPeriodLead = (lead: LeadRow) => {
    if (!lead.created_at) return false;
    const t = Date.parse(lead.created_at);
    return t >= period.start.getTime() && t < period.end.getTime();
  };
  const waiverInPeriod = (lead: LeadRow) =>
    isLocalDateInPeriod(lead.waiver_signed_date, period);

  const out: ConversionEntry[] = [];
  const metrics = config.conversion_metrics.metrics;
  const min = config.conversion_metrics.sanity_bounds.min_ratio;
  const max = config.conversion_metrics.sanity_bounds.max_ratio;

  for (const [label, def] of Object.entries(metrics)) {
    const { formula, channel } = resolveMetric(def);
    const { numerator, denominator } = formula({
      channel,
      classifiedLeads,
      classifiedSales,
      inPeriodLead,
      waiverInPeriod,
      period,
      config,
    });
    const ratio = denominator === 0 ? null : numerator / denominator;
    const outside = ratio !== null && (ratio < min || ratio > max);
    out.push({
      key: def.key,
      label,
      ratio,
      numerator,
      denominator,
      outside_sanity_bounds: outside,
    });
  }
  return out;
}

/** Round a ratio to one decimal of percent (0.2544 -> 25.4). Internal-only
 * helper so display formatting stays in run.ts where the dashboard contract
 * lives. Returns null when the ratio is null. */
export function ratioToOneDecimalPercent(r: number | null): number | null {
  if (r === null) return null;
  return Math.round(r * 1000) / 10;
}
