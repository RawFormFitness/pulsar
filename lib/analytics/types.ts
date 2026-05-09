// lib/analytics/types.ts
//
// Shared types for the analytics engine. Everything that crosses module
// boundaries inside lib/analytics/ goes through these.
//
// Design notes:
//   * Engine inputs are pre-loaded row arrays. Db helpers fetch; the engine
//     consumes. This keeps the engine pure and trivially testable in-memory.
//   * Engine outputs the dashboard-ready MetricsPack (see run.ts). Display
//     labels come from config; we never hardcode them.
//   * Multi-tenancy: every call carries gymId in `meta`. Cross-gym leakage
//     is prevented at the db-helper layer; the engine never re-fetches.

import type {
  CancellationRow,
  LeadRow,
  MemberRow,
  RfcRow,
  SaleRow,
} from "@/lib/parsers/types";

/** Reported channel keys (e.g. "web", "walk_in"). Plus the internal-only
 * "guest" classification for leads that should be excluded from counts. */
export type ChannelKey = string;

/** Period descriptor. start <= t < end, both interpreted in `timezone`. */
export type Period = {
  /** Calendar key like "2026-04". */
  key: string;
  /** UTC ISO at the period's localized start. */
  start: Date;
  /** UTC ISO at the period's localized exclusive end. */
  end: Date;
  /** IANA timezone the bounds were computed in. */
  timezone: string;
};

/** A lead with its attributed channel. */
export type ClassifiedLead = {
  row: LeadRow;
  channel: ChannelKey;
  /** Normalized name for sale matching. */
  normalized_name: string;
};

/** A sale with its attributed channel and (optionally) the matched lead. */
export type ClassifiedSale = {
  row: SaleRow;
  channel: ChannelKey;
  /** The lead that backs this sale's attribution, if any. */
  matched_lead: ClassifiedLead | null;
  /** True when no lead matched and we fell back to the no-lead channel. */
  is_no_lead_match: boolean;
  /** Normalized name used for matching. */
  normalized_name: string;
  /** days_to_close = (sale_date - lead_created).days. Null if no match. */
  days_to_close: number | null;
};

/** Engine input — row arrays plus gym metadata. */
export type EngineInput = {
  gym_id: string;
  period: Period;
  leads: LeadRow[];
  sales: SaleRow[];
  /** Member snapshot rows used for snapshot-derived slices and the
   * pending-cancel tile. The engine assumes these are already filtered to
   * the relevant snapshot. */
  members_snapshot: MemberRow[];
  rfc_entries: RfcRow[];
  /** Cancellations whose cancel_date falls inside the period. */
  cancellations: CancellationRow[];
  /** Optional override for the start-of-month base (seed period). When
   * absent the engine reads from config.membership.seed_value. */
  prior_period_current_member_base?: number | null;
};

/** Validation check result. Universal shape; thresholds live in config. */
export type ValidationResult = {
  name: string;
  passed: boolean;
  details?: Record<string, unknown>;
};

/** Tile bag for the four named loss tiles the engine computes. Pending
 * Cancel is reported but excluded from the loss aggregation per config.
 *
 * Contract: the four tile keys here (cancels, rfc, revocations,
 * pending_cancel) are the v1 universal loss-tile set. A gym's
 * `cancellations.losses_tiles` config selects which of these to render
 * and in what order — but adding a NEW tile (e.g., a "freeze churn"
 * concept that no current gym uses) requires a code change here AND in
 * `lib/analytics/losses.ts` where the per-tile compute logic lives. The
 * type is kept explicit rather than `Record<string, number>` so the
 * compiler catches mismatches between config keys and engine math; the
 * `losses_tiles` config is for ordering and visibility, not for
 * inventing new tiles. */
export type LossesInternal = {
  cancels: number;
  rfc: number;
  revocations: number;
  pending_cancel: number;
  /** Sum of the tiles config marks as in-aggregation; Powerhouse April:
   * cancels + rfc + revocations = 59. Pending Cancel never contributes. */
  total_losses_for_attrition_and_net_gain: number;
};

/** Velocity counts, in cumulative form (each cell = sum of itself + all
 * prior buckets in declared order). */
export type VelocityChannelCounts = {
  /** Per-bucket-key cumulative count. */
  buckets: Record<string, number>;
  /** Total channel sales (== cumulative final bucket). */
  total: number;
};

export type ConversionEntry = {
  /** The metric key from config (e.g. "web_visit_conversion"). */
  key: string;
  /** The exact display label from config. */
  label: string;
  /** numerator / denominator, or null when denominator is 0. */
  ratio: number | null;
  numerator: number;
  denominator: number;
  /** True when the ratio falls outside the configured sanity bounds. */
  outside_sanity_bounds: boolean;
};

export type AnalyticsOutput = {
  meta: {
    gym_id: string;
    gym_slug: string;
    period_key: string;
    period_start_iso: string;
    period_end_iso: string;
    timezone: string;
  };
  lead_generation: {
    /** Display-label-keyed dict (e.g. "Web Leads": 285 for Powerhouse April). */
    display: Record<string, number>;
    internal: Record<string, number> & { total_leads: number };
  };
  sales: {
    display: Record<string, number>;
    internal: Record<string, number> & { total_sales: number };
  };
  conversion: {
    /** Display-label keyed map of "x.x%" strings for direct render. */
    display: Record<string, string>;
    /** Display-label keyed numeric percentages (e.g. 25.4). */
    display_percentages: Record<string, number>;
    /** Internal ratios (e.g. 0.254). null when denominator=0. */
    internal_ratios: Record<string, number | null>;
    entries: ConversionEntry[];
  };
  losses: {
    display: Record<string, number>;
    internal: LossesInternal;
    revocations_detail: {
      count: number;
      rows: { cancel_date: string; member_name: string; reason: string | null }[];
    };
    /** When the configured pending_cancel rule is known to disagree with
     * the report owner's value, this tracks the gap. The engine emits its
     * computed value (per spec); the field is informational. */
    pending_cancel_known_gap?: boolean;
    /** When pending_cancel_known_gap is true, this is the PDF-side
     * counterpart value the spec-derived engine value disagrees with.
     * Surfaced for reconciliation banners on the dashboard. Optional —
     * the field is only present when the gym's config records it. */
    pending_cancel_pdf_value?: number;
  };
  membership: {
    display: Record<string, number | string>;
    internal: {
      start_of_month_member_base: number;
      current_member_base: number;
      net_gain: number;
      attrition_ratio: number | null;
    };
  };
  pipeline_velocity: {
    /** Display-label keyed channel rows. Each row is a heterogeneous map:
     * each bucket label points to a `{ count, display_percent, display }`
     * cell, and one extra entry stores the row total under the
     * sales-totals display label (config-driven via
     * `display_labels.sales.total_sales`; default "Total Sales"). The
     * total entry's value is a `number`; cell values are objects.
     * Callers narrow by key. */
    channels: Record<
      string,
      Record<
        string,
        { count: number; display_percent: number; display: string } | number
      >
    >;
    internal: Record<
      string,
      VelocityChannelCounts & { total: number }
    >;
  };
  validation_results: ValidationResult[];
};

/** Type of the named channel-attribution module. Lead and sale paths
 * receive different inputs but live in one module so a gym whose two
 * sides share rules can keep them together. */
export type AttributionModule = {
  /** Classify a single lead into a channel. */
  leadChannel: (lead: LeadRow, ctx: AttributionContext) => ChannelKey;
  /** Classify a sale's channel given the (already-classified) candidate
   * leads to choose from. The universal sale-to-lead matcher in
   * lib/analytics/channels.ts picks the lead; this function then translates
   * that match into a sale-side channel (handles "guest upgrade to
   * walk_in", "no-lead fallback", etc.). */
  saleChannel: (
    sale: SaleRow,
    matched_lead: ClassifiedLead | null,
    ctx: AttributionContext,
  ) => { channel: ChannelKey; is_no_lead_match: boolean };
};

export type AttributionContext = {
  /** The full gym config block. Modules read what they need. */
  config: GymConfig;
};

/** Reconciliation-variance marker on a config block. Period-agnostic: the
 * `period_key` field declares which period the gap applies to (e.g.
 * "2026-04"), and the engine surfaces the gap only when the period being
 * processed matches. `engine_value` and `pdf_value` are scalars for tile
 * metrics (e.g. Pending Cancel = 13 vs 18); for compound metrics like
 * per-channel lead splits the block can carry richer payloads under the
 * extension index signature, but those are documentation-only — the
 * engine reads `pdf_value` as a number when it surfaces a gap. */
export type KnownGap = {
  period_key: string;
  engine_value?: number;
  pdf_value?: number;
  status?: string;
  reasoning?: string;
  doc_link?: string;
  [k: string]: unknown;
};

// --- Config shape --------------------------------------------------------
// We type only the fields the engine actively reads. Deep `_meta` blocks
// and unrelated payload remain typed as unknown via Record<string,unknown>.
// This keeps the type pliable for new gyms that ship extra config keys.

export type GymConfig = {
  _meta: { gym_slug: string; gym_name?: string } & Record<string, unknown>;
  timezone: { value: string };
  /** Optional BCP-47 locale tag for `Intl.*` formatting (e.g. "en-US",
   * "fr-CA"). Read by the dashboard layer. Defaults to "en-US" when
   * absent. Powerhouse leaves this unset. */
  locale?: string;
  period: { type: string; boundary: string };
  channels: {
    reported: ChannelKey[];
    internal_only_excluded_from_counts?: ChannelKey[];
  };
  plan_exclusions: {
    match: "exact" | "normalized_exact";
    values: string[];
    /** Optional: which row fields to check the exclusion list against for
     * sales rows. Defaults to ["plan_name"]. Powerhouse needs
     * ["plan_name", "payment_plan"] because some excluded "plans" appear
     * in the Agreement Payment Plan column rather than Membership Type. */
    sale_match_fields?: ("plan_name" | "payment_plan")[];
  };
  channel_attribution: {
    lead_channel_module: string | null;
    sale_channel_module: string | null;
    /** Optional declarative ruleset the named module reads (Powerhouse uses this). */
    lead_channel_rules_for_module?: unknown;
    sale_attribution_rules?: {
      no_lead_match_fallback_channel: ChannelKey;
      no_lead_match_label?: string;
      guest_match_upgrades_to_walk_in_for_sale?: boolean;
      prefer_non_guest_match?: boolean;
      /** Channel keys to deprioritize when picking a sale's matching lead.
       * When prefer_non_guest_match is true (the default), the matcher
       * skips candidates whose channel ∈ this list in favor of any
       * non-listed candidate. Powerhouse uses ["guest"]; other gyms can
       * configure their own transient classification (e.g. ["tour"]).
       * Empty/missing list collapses behavior to "use the most recent
       * prior lead regardless of channel". */
      non_preferred_channels?: ChannelKey[];
    };
  };
  member_status_values: {
    active_value: string;
    pending_cancel_value: string;
  };
  cancellations: {
    revocation_classification: {
      method: "substring_lowercase_any";
      revocation_substrings: string[];
    };
    pending_cancel: {
      rule: string;
      filter?: string;
      /** Optional reconciliation marker. When the configured pending-cancel
       * rule is known to disagree with the gym's report-owner value for a
       * specific period, this block surfaces the gap to the engine output
       * (and ultimately to a dashboard banner). The engine still emits its
       * rule-derived count; this field is informational. The gap is
       * surfaced ONLY when the period being computed matches `period_key`. */
      _known_gap?: KnownGap;
    };
    losses_tiles: string[];
    loss_aggregation: {
      include_in_attrition_numerator: string[];
      include_in_net_gain_loss_term: string[];
      exclude_from_attrition_numerator?: string[];
    };
  };
  velocity_buckets: {
    buckets: {
      key: string;
      display_label: string;
      min_days: number | null;
      max_days: number | null;
    }[];
    no_lead_match_bucket: string;
    report_channels: ChannelKey[];
  };
  conversion_metrics: {
    sanity_bounds: { min_ratio: number; max_ratio: number };
    metrics: Record<
      string,
      {
        key: string;
        /** Optional: explicit formula key ("visit_conversion" etc.). Falls
         * back to parsing `<channel>_<formula>` out of `key`. */
        formula?: string;
        /** Optional: explicit channel. Required when `formula` is given. */
        channel?: ChannelKey;
        numerator?: string;
        denominator?: string;
      }
    >;
  };
  membership: {
    current_member_base: { source: "flow_identity"; formula?: string };
    start_of_month_member_base: {
      source: "prior_period_current_value";
      seed_value?: number;
      seed_period?: string;
      fallback_when_no_prior?: string;
    };
    net_gain_formula: { expression: string };
    attrition_rate_formula: { expression: string };
  };
  validation: {
    checks: { name: string; rule: string }[];
  };
  /** Display-label dictionary used by the engine to translate internal
   * tile keys into the output keys the dashboard expects. Per-gym strings
   * are Level-2: gyms may override any label, including the per-channel
   * ones (e.g. "Web Leads") and the totals row keys ("Total Leads",
   * "Total Sales"). When an override is missing the engine falls back to
   * its built-in conventional names. The Powerhouse config currently
   * relies entirely on the defaults. */
  display_labels?: {
    lead_generation?: Record<string, string> & {
      web_leads?: string;
      walk_in_leads?: string;
      total_leads?: string;
    };
    sales?: Record<string, string> & {
      web_sales?: string;
      walk_in_sales?: string;
      total_sales?: string;
    };
    losses?: Record<string, string>;
    membership?: Record<string, string>;
    velocity_channels?: Record<string, string>;
    velocity_total?: string;
  };
};
