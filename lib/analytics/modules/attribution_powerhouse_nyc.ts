// lib/analytics/modules/attribution_powerhouse_nyc.ts
//
// Level-3 module: Powerhouse NYC's lead/sale channel attribution. Reads
// the rules out of the gym's config (channel_attribution.lead_channel_rules_for_module
// and sale_attribution_rules) and runs them in order. The module exists
// because Powerhouse's lead path needs (a) lowercase-substring tag match,
// (b) source+status fork (Visitor Registration App + Guest), and (c) a
// fall-through default — together too tangled for a flat config rule
// array, but expressible as a tiny if-chain that consumes the config.
//
// Hard rule: this module reads ONLY from the config it is handed. No
// hardcoded gym slugs, no hardcoded plan names, no "if powerhouse" branch.
// Another gym wanting the same rules can register the same module name.

import type {
  AttributionContext,
  AttributionModule,
  ChannelKey,
  ClassifiedLead,
} from "../types";
import type { LeadRow, SaleRow } from "@/lib/parsers/types";

type RuleSet = {
  rules_in_order: Array<{
    if?: {
      source_equals?: string;
      status_equals?: string;
      tags_lowercase_contains_any?: string[];
    };
    then_channel?: ChannelKey;
    default_channel?: ChannelKey;
  }>;
};

function leadChannel(lead: LeadRow, ctx: AttributionContext): ChannelKey {
  const ruleset = ctx.config.channel_attribution
    .lead_channel_rules_for_module as RuleSet | undefined;
  const fallbackChannel =
    ctx.config.channel_attribution.sale_attribution_rules
      ?.no_lead_match_fallback_channel ?? "walk_in";
  if (!ruleset) {
    // Without rules we can't attribute; default to the configured no-lead
    // fallback so we never produce a third bucket.
    return fallbackChannel;
  }

  // Split the rules upfront: any rule with a `default_channel` is the
  // catch-all and is held aside; all remaining rules are evaluated in
  // order. This way a misordered config (default_channel placed before
  // a conditional rule) cannot silently short-circuit earlier rules —
  // the conditionals always run first. The last `default_channel` seen
  // wins if a config accidentally declares more than one (and we still
  // fall back to the engine-side fallback if none is declared).
  let defaultChannel: ChannelKey | null = null;
  const conditionalRules: RuleSet["rules_in_order"] = [];
  for (const r of ruleset.rules_in_order) {
    if (r.default_channel) {
      defaultChannel = r.default_channel;
    } else {
      conditionalRules.push(r);
    }
  }

  const source = (lead.source ?? "").trim();
  const status = (lead.status ?? "").trim().toLowerCase();
  const tagsLower = (lead.tags ?? []).map((t) => t.toLowerCase());

  for (const r of conditionalRules) {
    const cond = r.if;
    if (!cond) continue;
    if (cond.source_equals !== undefined && source !== cond.source_equals) continue;
    if (
      cond.status_equals !== undefined &&
      status !== cond.status_equals.toLowerCase()
    ) {
      continue;
    }
    if (cond.tags_lowercase_contains_any !== undefined) {
      const needles = cond.tags_lowercase_contains_any.map((t) => t.toLowerCase());
      const hit = tagsLower.some((have) => needles.some((n) => have.includes(n)));
      if (!hit) continue;
    }
    if (r.then_channel) return r.then_channel;
  }
  // Spec p.2: any record that fell through to no rule defaults to walk_in
  // (or whatever default_channel the config declares, or — last resort —
  // the engine's no-lead fallback).
  return defaultChannel ?? fallbackChannel;
}

function saleChannel(
  _sale: SaleRow,
  matched: ClassifiedLead | null,
  ctx: AttributionContext,
): { channel: ChannelKey; is_no_lead_match: boolean } {
  const rules = ctx.config.channel_attribution.sale_attribution_rules;
  const fallbackChannel = rules?.no_lead_match_fallback_channel ?? "walk_in";
  if (matched === null) {
    return {
      channel: fallbackChannel,
      is_no_lead_match: true,
    };
  }
  // Guest-upgrade: when the matched lead falls into a non-preferred
  // channel (Powerhouse: "guest") AND the upgrade flag is on, the sale
  // attributes to the configured no-lead fallback channel — same target
  // a totally unmatched sale would land in. Using the configured fallback
  // instead of a hardcoded "walk_in" lets a Powerhouse-shaped gym whose
  // walk-in equivalent has a different name reuse this module unchanged.
  if (
    matched.channel === "guest" &&
    rules?.guest_match_upgrades_to_walk_in_for_sale !== false
  ) {
    return { channel: fallbackChannel, is_no_lead_match: false };
  }
  return { channel: matched.channel, is_no_lead_match: false };
}

const mod: AttributionModule = { leadChannel, saleChannel };
export default mod;
