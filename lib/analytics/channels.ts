// lib/analytics/channels.ts
//
// Universal lead/sale channel classification + sale-to-lead matching.
//
// Lead channel: delegated to the configured Level-3 module (or, when a
// gym leaves the module unset, defaulted to "echo the lead.source field"
// — a simple baseline that we expect rarely to suffice but keeps the
// engine usable for trivial gyms before they ship a custom module).
//
// Sale-to-lead matching is universal:
//   1. normalized-name equality on the lead pool;
//   2. prefer the most-recent prior lead (created_at <= sale_date);
//   3. fall back to the closest-after-sale lead;
//   4. prefer non-Guest matches when both classifications are available.
//
// Sale channel: the matched lead's channel, possibly translated by the
// module (Powerhouse upgrades guest matches to walk_in for sale-side
// reporting). Unmatched sales fall through to the configured no-lead
// channel (walk_in for Powerhouse) with is_no_lead_match=true.

import type { LeadRow, SaleRow } from "@/lib/parsers/types";
import { normalizeLeadName, normalizeSaleName } from "./names";
import { localDateString } from "./period";
import type {
  AttributionContext,
  AttributionModule,
  ChannelKey,
  ClassifiedLead,
  ClassifiedSale,
  GymConfig,
} from "./types";

/** Default lead-channel function used when the gym's config does not
 * register a module. Echoes lead.source verbatim (lower-cased) into the
 * channel slot. Sufficient for hypothetical gyms whose channels equal
 * their source values; otherwise the gym must register a module. */
function defaultLeadChannel(lead: LeadRow): ChannelKey {
  const s = (lead.source ?? "").trim().toLowerCase();
  return s === "" ? "unknown" : s;
}

/** Default sale-channel function — pass-through. */
function defaultSaleChannel(
  matched: ClassifiedLead | null,
  fallback: ChannelKey,
): { channel: ChannelKey; is_no_lead_match: boolean } {
  if (matched === null) return { channel: fallback, is_no_lead_match: true };
  return { channel: matched.channel, is_no_lead_match: false };
}

/**
 * Classify every lead in the input. The configured channel module decides
 * how each row maps to a channel; we attach the normalized name once so
 * the matcher doesn't recompute it 8000 times.
 */
export function classifyLeads(
  leads: LeadRow[],
  config: GymConfig,
  module: AttributionModule | null,
): ClassifiedLead[] {
  const ctx: AttributionContext = { config };
  return leads.map((row) => ({
    row,
    channel: module
      ? module.leadChannel(row, ctx)
      : defaultLeadChannel(row),
    normalized_name: normalizeLeadName(row.first_name, row.last_name),
  }));
}

/**
 * Classify a sale by:
 *   1. Finding the best matching lead by normalized name.
 *   2. Asking the module (or default) what sale-channel the match implies.
 *   3. Computing days_to_close.
 *
 * "Best match" rules per universal Level-1 protocol; see file header.
 */
export function classifySale(
  sale: SaleRow,
  leadIndex: Map<string, ClassifiedLead[]>,
  config: GymConfig,
  module: AttributionModule | null,
  timezone: string,
): ClassifiedSale {
  const ctx: AttributionContext = { config };
  const fallback =
    config.channel_attribution.sale_attribution_rules
      ?.no_lead_match_fallback_channel ?? "walk_in";

  const sName = normalizeSaleName(sale.member_name);
  const candidates = leadIndex.get(sName) ?? [];

  let chosen: ClassifiedLead | null = null;
  if (candidates.length > 0) {
    const saleMs = sale.queue_date ? Date.parse(sale.queue_date) : NaN;
    const saRules = config.channel_attribution.sale_attribution_rules;
    // The "non-preferred channels" set is config-driven. Powerhouse names
    // ["guest"] here; another gym's transient channel might be ["tour"]
    // or anything else. The flag prefer_non_guest_match (kept under its
    // historical name for backwards compatibility) gates whether the
    // matcher honors the list at all. If the flag is false OR the list
    // is empty/missing, behavior collapses to "use the most recent prior
    // lead regardless of channel".
    const nonPreferredList = saRules?.non_preferred_channels ?? [];
    const preferNonNonPreferred =
      saRules?.prefer_non_guest_match !== false && nonPreferredList.length > 0;
    const isNonPreferred = (ch: ChannelKey) => nonPreferredList.includes(ch);

    // Split candidates into prior and after-sale lists, preserving sort
    // by created_at within each. The DB helper already orders ascending;
    // re-sort defensively in case the input came from elsewhere.
    const sorted = [...candidates].sort(
      (a, b) => Date.parse(a.row.created_at) - Date.parse(b.row.created_at),
    );
    const prior = sorted.filter((c) => Date.parse(c.row.created_at) <= saleMs);
    const after = sorted.filter((c) => Date.parse(c.row.created_at) > saleMs);

    function pickPreferringNonNonPreferred(
      pool: ClassifiedLead[],
    ): ClassifiedLead | null {
      if (pool.length === 0) return null;
      if (!preferNonNonPreferred) return pool[pool.length - 1];
      const preferred = pool.filter((c) => !isNonPreferred(c.channel));
      if (preferred.length > 0) return preferred[preferred.length - 1];
      return pool[pool.length - 1];
    }

    if (prior.length > 0) {
      // Most-recent prior lead. Prefer non-non-preferred among ties of "prior".
      chosen = pickPreferringNonNonPreferred(prior);
    } else if (after.length > 0) {
      // Fall back to closest-after-sale lead.
      const sortedAfter = [...after].sort(
        (a, b) => Date.parse(a.row.created_at) - Date.parse(b.row.created_at),
      );
      // Closest-after = earliest after the sale.
      const earliest = sortedAfter[0];
      if (preferNonNonPreferred && isNonPreferred(earliest.channel)) {
        const preferred = sortedAfter.find((c) => !isNonPreferred(c.channel));
        chosen = preferred ?? earliest;
      } else {
        chosen = earliest;
      }
    }
  }

  const decision = module
    ? module.saleChannel(sale, chosen, ctx)
    : defaultSaleChannel(chosen, fallback);

  // days_to_close per spec: difference of CALENDAR DATES in the gym's
  // timezone, not raw timestamp diff. The lead carries a UTC ISO
  // timestamp; the sale carries a calendar date. We localize both into
  // the gym timezone and diff their YYYY-MM-DD values.
  let daysToClose: number | null = null;
  if (chosen && sale.queue_date) {
    const leadLocalYmd = localDateString(new Date(chosen.row.created_at), timezone);
    const saleYmd = sale.queue_date.slice(0, 10);
    const leadDayUtc = Date.parse(`${leadLocalYmd}T00:00:00Z`);
    const saleDayUtc = Date.parse(`${saleYmd}T00:00:00Z`);
    if (!Number.isNaN(leadDayUtc) && !Number.isNaN(saleDayUtc)) {
      daysToClose = Math.round((saleDayUtc - leadDayUtc) / (1000 * 60 * 60 * 24));
    }
  }

  return {
    row: sale,
    channel: decision.channel,
    matched_lead: chosen,
    is_no_lead_match: decision.is_no_lead_match,
    normalized_name: sName,
    days_to_close: daysToClose,
  };
}

/** Build a normalized-name -> ClassifiedLead[] index over the full lead
 * universe (including out-of-period leads — sale-to-lead matching crosses
 * period boundaries). */
export function buildLeadIndex(
  classifiedLeads: ClassifiedLead[],
): Map<string, ClassifiedLead[]> {
  const idx = new Map<string, ClassifiedLead[]>();
  for (const cl of classifiedLeads) {
    if (!cl.normalized_name) continue;
    const list = idx.get(cl.normalized_name);
    if (list) list.push(cl);
    else idx.set(cl.normalized_name, [cl]);
  }
  return idx;
}
