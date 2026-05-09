// lib/analytics/__tests__/non_preferred_channels.test.ts
//
// Regression test for fix (1a): the sale-to-lead matcher's
// "deprioritize this channel when picking a match" set is config-driven,
// not the hardcoded literal "guest". A gym whose transient classification
// is named "tour" must be honored by the same engine.
//
// The test would FAIL on pre-fix code (which only filtered out the literal
// string "guest") and PASSES once channels.ts reads the configured
// `non_preferred_channels` list.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runAnalytics } from "@/lib/analytics/run";
import { calendarMonthPeriod } from "@/lib/analytics/period";
import type {
  CancellationRow,
  LeadRow,
  MemberRow,
  RfcRow,
  SaleRow,
} from "@/lib/parsers/types";
import type { GymConfig } from "@/lib/analytics/types";

const GYM_ID = "33333333-3333-3333-3333-333333333333";

// Build a minimal config inline. Channels reported are "tour" and "phone";
// "tour" is the gym's transient classification — leads are real but the
// gym does not want a sale to attribute to "tour" if a "phone" lead with
// the same name also exists. No Level-3 module: the default attribution
// echoes lead.source verbatim into the channel slot.
function buildConfig(): GymConfig {
  return {
    _meta: { gym_slug: "non_preferred_test_gym" },
    timezone: { value: "America/New_York" },
    period: { type: "calendar_month", boundary: "exclusive_end" },
    channels: {
      reported: ["tour", "phone"],
      internal_only_excluded_from_counts: [],
    },
    plan_exclusions: { match: "exact", values: [] },
    channel_attribution: {
      lead_channel_module: null,
      sale_channel_module: null,
      sale_attribution_rules: {
        no_lead_match_fallback_channel: "phone",
        prefer_non_guest_match: true,
        // The point of this test: "tour" — not "guest" — is the
        // deprioritized channel. The matcher must honor this list, not
        // the literal "guest".
        non_preferred_channels: ["tour"],
      },
    },
    member_status_values: { active_value: "Active", pending_cancel_value: "Pending" },
    cancellations: {
      revocation_classification: { method: "substring_lowercase_any", revocation_substrings: [] },
      pending_cancel: { rule: "snapshot_status_only" },
      losses_tiles: ["cancels", "rfc", "revocations", "pending_cancel"],
      loss_aggregation: {
        include_in_attrition_numerator: ["cancels", "rfc", "revocations"],
        include_in_net_gain_loss_term: ["cancels", "rfc", "revocations"],
        exclude_from_attrition_numerator: ["pending_cancel"],
      },
    },
    velocity_buckets: {
      buckets: [{ key: "all", display_label: "All", min_days: null, max_days: null }],
      no_lead_match_bucket: "all",
      report_channels: ["tour", "phone", "total"],
    },
    conversion_metrics: {
      sanity_bounds: { min_ratio: 0, max_ratio: 1 },
      metrics: {},
    },
    membership: {
      current_member_base: { source: "flow_identity" },
      start_of_month_member_base: {
        source: "prior_period_current_value",
        seed_value: 0,
        fallback_when_no_prior: "seed_value",
      },
      net_gain_formula: { expression: "total_sales - losses" },
      attrition_rate_formula: { expression: "losses / start_of_month" },
    },
    validation: { checks: [] },
  };
}

function lead(args: {
  source_id: string;
  first: string;
  last: string;
  source: string;
  created_at: string;
}): LeadRow {
  return {
    gym_id: GYM_ID,
    source_id: args.source_id,
    first_name: args.first,
    last_name: args.last,
    email: null,
    phone: null,
    salesperson: null,
    source: args.source,
    status: null,
    tags: [],
    created_at: args.created_at,
    updated_at: null,
    sale_at: null,
    trial_end_at: null,
    leaving_at: null,
    leaving_reason: null,
    first_contact: null,
    waiver_signed_date: null,
    raw: {},
  };
}

function sale(args: {
  agreement_number: number;
  member_name: string;
  queue_date: string;
}): SaleRow {
  return {
    gym_id: GYM_ID,
    agreement_number: args.agreement_number,
    member_name: args.member_name,
    department: null,
    term: null,
    plan_name: "Standard",
    payment_plan: null,
    queue: null,
    queue_date: args.queue_date,
    agreement_type: null,
    salesperson: null,
    club_name: null,
    raw: {},
  };
}

test("prefer_non_guest_match honors a configured non-'guest' channel name (e.g. 'tour')", () => {
  const config = buildConfig();
  const period = calendarMonthPeriod("2026-04", config.timezone.value);

  // Two leads sharing the same normalized name. The "tour" lead is more
  // RECENT (later created_at) than the "phone" lead. Without the
  // non_preferred_channels filter, the matcher would pick the "tour"
  // lead because "most recent prior". With the filter honoring
  // non_preferred_channels=["tour"], the matcher must skip the tour lead
  // and pick the older "phone" lead instead — proving the deprioritization
  // is driven by config, not the literal string "guest".
  const leads: LeadRow[] = [
    lead({
      source_id: "L_PHONE",
      first: "Sam",
      last: "Smith",
      source: "phone",
      created_at: "2026-04-05T15:00:00.000Z",
    }),
    lead({
      source_id: "L_TOUR",
      first: "Sam",
      last: "Smith",
      source: "tour",
      // More recent than the phone lead — would win without the filter.
      created_at: "2026-04-12T15:00:00.000Z",
    }),
  ];

  const sales: SaleRow[] = [
    sale({ agreement_number: 9001, member_name: "Smith, Sam", queue_date: "2026-04-20" }),
  ];

  const out = runAnalytics(
    {
      gym_id: GYM_ID,
      period,
      leads,
      sales,
      members_snapshot: [] as MemberRow[],
      rfc_entries: [] as RfcRow[],
      cancellations: [] as CancellationRow[],
      prior_period_current_member_base: null,
    },
    config,
  );

  // The sale attributes to "phone", NOT "tour". With pre-fix code (literal
  // "guest" filter), this assertion fails: the matcher would have picked
  // the more-recent "tour" lead and the sale would land in the tour bucket.
  assert.equal(out.sales.display["Phone Sales"], 1, "sale must attribute to phone");
  assert.equal(out.sales.display["Tour Sales"], 0, "sale must NOT attribute to tour");
  assert.equal(out.sales.display["Total Sales"], 1);
});

test("non_preferred_channels=[] collapses behavior to 'use most recent prior lead' regardless of channel", () => {
  // Same two leads as above, but with the deprioritization disabled by
  // emptying the list. The matcher should now pick the more recent
  // "tour" lead (most-recent prior) and the sale must land in tour.
  const config = buildConfig();
  config.channel_attribution.sale_attribution_rules!.non_preferred_channels = [];
  const period = calendarMonthPeriod("2026-04", config.timezone.value);

  const leads: LeadRow[] = [
    lead({
      source_id: "L_PHONE",
      first: "Sam",
      last: "Smith",
      source: "phone",
      created_at: "2026-04-05T15:00:00.000Z",
    }),
    lead({
      source_id: "L_TOUR",
      first: "Sam",
      last: "Smith",
      source: "tour",
      created_at: "2026-04-12T15:00:00.000Z",
    }),
  ];

  const sales: SaleRow[] = [
    sale({ agreement_number: 9001, member_name: "Smith, Sam", queue_date: "2026-04-20" }),
  ];

  const out = runAnalytics(
    {
      gym_id: GYM_ID,
      period,
      leads,
      sales,
      members_snapshot: [] as MemberRow[],
      rfc_entries: [] as RfcRow[],
      cancellations: [] as CancellationRow[],
      prior_period_current_member_base: null,
    },
    config,
  );

  // With the list empty, most-recent prior wins -> tour lead picked ->
  // sale attributes to tour.
  assert.equal(out.sales.display["Tour Sales"], 1, "without filter, more-recent tour lead wins");
  assert.equal(out.sales.display["Phone Sales"], 0);
  assert.equal(out.sales.display["Total Sales"], 1);
});
