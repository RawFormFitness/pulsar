// lib/analytics/__tests__/test_gym_b.test.ts
//
// Second-gym configurability test. Builds a synthetic minimal fixture
// for "test_gym_b" — a hypothetical gym with intentionally different
// channels (online / phone / referral), different velocity buckets
// (3 buckets at different cuts), different excluded plans, different
// active-status value, and NO Level-3 attribution module — and asserts
// the same engine produces the right output.
//
// If this test happened to pass only because Powerhouse's logic accidentally
// also worked for it, that would be a configurability fail. The synthetic
// inputs are constructed so the math is impossible to satisfy without
// honoring this gym's specific config (channel keys, bucket geometry,
// status string, exclusion list).

import { test } from "node:test";
import assert from "node:assert/strict";

import { runAnalytics } from "@/lib/analytics/run";
import { calendarMonthPeriod } from "@/lib/analytics/period";
import { loadConfig } from "./_load_fixtures";
import type {
  CancellationRow,
  LeadRow,
  MemberRow,
  RfcRow,
  SaleRow,
} from "@/lib/parsers/types";

const GYM_ID = "22222222-2222-2222-2222-222222222222";

// Build a lead with the minimum required fields. created_at must be in
// April 2026 in America/Denver.
function lead(args: {
  source_id: string;
  first: string;
  last: string;
  source: string;
  created_at: string;
  waiver?: string | null;
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
    waiver_signed_date: args.waiver ?? null,
    raw: {},
  };
}

function sale(args: {
  agreement_number: number;
  member_name: string;
  queue_date: string;
  plan_name: string | null;
}): SaleRow {
  return {
    gym_id: GYM_ID,
    agreement_number: args.agreement_number,
    member_name: args.member_name,
    department: null,
    term: null,
    plan_name: args.plan_name,
    payment_plan: null,
    queue: null,
    queue_date: args.queue_date,
    agreement_type: null,
    salesperson: null,
    club_name: null,
    raw: {},
  };
}

function member(args: {
  agreement_number: number;
  status: string;
  plan_name?: string | null;
}): MemberRow {
  return {
    gym_id: GYM_ID,
    agreement_number: args.agreement_number,
    as_of: "2026-05-01T00:00:00.000Z",
    member_status: args.status,
    plan_name: args.plan_name ?? "Standard",
    member_name: `M${args.agreement_number}`,
    primary_member: null,
    next_due_amount: null,
    renewal_cash: null,
    renewal_eft: null,
    renewal_statement: null,
    expiration_date: null,
    primary_phone: null,
    payment_plan: null,
    email: null,
    gender: null,
    age: null,
    last_visit_date: null,
    begin_date: null,
    visits_used: null,
    check_in_count: null,
    club_name: null,
    management_group: null,
    mrr: null,
    raw: {},
  };
}

function rfcRow(agreement_number: number, status_date: string): RfcRow {
  return {
    gym_id: GYM_ID,
    agreement_number,
    status_date,
    club_name: null,
    member_name: null,
    member_status: null,
    begin_date: null,
    last_billing_date: null,
    term: null,
    payment_method: null,
    plan_name: null,
    salesperson: null,
    next_due_amount: null,
    total_past_due: null,
    days_past_due: null,
    raw: {},
  };
}

function cancelRow(args: {
  cancel_date: string;
  member_name: string;
  reason?: string | null;
}): CancellationRow {
  return {
    gym_id: GYM_ID,
    cancel_date: args.cancel_date,
    member_name: args.member_name,
    primary_phone: null,
    email: null,
    effective_date: null,
    membership_amount_cents: null,
    membership_type: null,
    out_of_contract: null,
    reason: args.reason ?? null,
    raw: {},
  };
}

test("second-gym configurability — engine respects test_gym_b's channels, buckets, status, exclusions", async () => {
  const config = await loadConfig("test_gym_b");
  const period = calendarMonthPeriod("2026-04", config.timezone.value);

  // Build an absurdly compact dataset where every count is verifiable.
  //
  // Leads (default attribution = lead.source lower-cased -> channel key):
  //   3 online, 2 phone, 1 referral. Total = 6.
  //   Plus 1 May lead that should NOT count.
  const leads: LeadRow[] = [
    lead({ source_id: "L1", first: "Alice", last: "One", source: "online", created_at: "2026-04-02T15:00:00.000Z", waiver: "2026-04-02" }),
    lead({ source_id: "L2", first: "Bob", last: "Two", source: "online", created_at: "2026-04-05T15:00:00.000Z", waiver: "2026-04-05" }),
    lead({ source_id: "L3", first: "Carol", last: "Three", source: "online", created_at: "2026-04-10T15:00:00.000Z" }),
    lead({ source_id: "L4", first: "Dave", last: "Four", source: "phone", created_at: "2026-04-12T15:00:00.000Z" }),
    lead({ source_id: "L5", first: "Eve", last: "Five", source: "phone", created_at: "2026-04-20T15:00:00.000Z" }),
    lead({ source_id: "L6", first: "Frank", last: "Six", source: "referral", created_at: "2026-04-25T15:00:00.000Z" }),
    // Out-of-period — must not count.
    lead({ source_id: "L7", first: "Out", last: "Period", source: "online", created_at: "2026-05-02T15:00:00.000Z" }),
  ];

  // Sales: 4 in April. Two match online leads (Alice, Bob), one matches a
  // phone lead (Dave), one has no matching lead -> falls back to phone
  // (config's no_lead_match_fallback_channel).
  // Plus one excluded "Comp Membership" sale that must NOT count.
  const sales: SaleRow[] = [
    sale({ agreement_number: 1001, member_name: "One, Alice", queue_date: "2026-04-03", plan_name: "Standard" }),
    sale({ agreement_number: 1002, member_name: "Two, Bob", queue_date: "2026-04-09", plan_name: "Standard" }),
    sale({ agreement_number: 1003, member_name: "Four, Dave", queue_date: "2026-04-15", plan_name: "Standard" }),
    sale({ agreement_number: 1004, member_name: "Mystery, Sale", queue_date: "2026-04-28", plan_name: "Standard" }),
    // Excluded plan — should be filtered out before counting.
    sale({ agreement_number: 1005, member_name: "Excluded, X", queue_date: "2026-04-15", plan_name: "Comp Membership" }),
  ];

  // RFC: 1 row in period.
  const rfc: RfcRow[] = [rfcRow(9001, "2026-04-22")];

  // Cancellations: 2 voluntary + 1 with "banned" reason (revocation).
  // Plus 1 excluded by membership snapshot status logic? No, cancel
  // ledger doesn't apply plan_exclusions.
  const cancellations: CancellationRow[] = [
    cancelRow({ cancel_date: "2026-04-08", member_name: "Foo, Bar", reason: "moving" }),
    cancelRow({ cancel_date: "2026-04-12", member_name: "Baz, Qux", reason: "too expensive" }),
    cancelRow({ cancel_date: "2026-04-22", member_name: "Bad, Apple", reason: "Member banned for misbehavior" }),
  ];

  // Members snapshot: 3 with status "Pending" (this gym's pending-cancel
  // value). One has the excluded plan "Staff Plan" so it must NOT count.
  const members: MemberRow[] = [
    member({ agreement_number: 5001, status: "Pending" }),
    member({ agreement_number: 5002, status: "Pending" }),
    member({ agreement_number: 5003, status: "Pending", plan_name: "Staff Plan" }),
    member({ agreement_number: 5004, status: "Active" }),
  ];

  const out = runAnalytics(
    {
      gym_id: GYM_ID,
      period,
      leads,
      sales,
      members_snapshot: members,
      rfc_entries: rfc,
      cancellations,
      prior_period_current_member_base: null,
    },
    config,
  );

  // ----- Lead generation -----
  // Default labels: "Online Leads", "Phone Leads", "Referral Leads"
  // (labelFor humanizes underscored channel keys). The totals-row label
  // is overridden by config to "All Leads" — exercises the Level-2
  // override path (per-channel labels are not overridden, proving the
  // engine still falls back for those).
  assert.equal(out.lead_generation.display["Online Leads"], 3, "online lead count");
  assert.equal(out.lead_generation.display["Phone Leads"], 2, "phone lead count");
  assert.equal(out.lead_generation.display["Referral Leads"], 1, "referral lead count");
  assert.equal(out.lead_generation.display["All Leads"], 6, "total leads (overridden label)");
  // The default key MUST NOT be present — proves the override replaced it,
  // it didn't shadow it.
  assert.equal(
    out.lead_generation.display["Total Leads"],
    undefined,
    "default 'Total Leads' must be absent when override is configured",
  );

  // ----- Sales -----
  assert.equal(out.sales.display["Online Sales"], 2, "online sales");
  // 1 phone lead match + 1 unmatched fallback to phone = 2.
  assert.equal(out.sales.display["Phone Sales"], 2, "phone sales");
  assert.equal(out.sales.display["Referral Sales"], 0, "referral sales");
  // Overridden total label.
  assert.equal(out.sales.display["All Sales"], 4, "total sales (overridden label)");
  assert.equal(
    out.sales.display["Total Sales"],
    undefined,
    "default 'Total Sales' must be absent when override is configured",
  );

  // ----- Conversion -----
  // Only one metric configured: "Online Sales Conversion" with key
  // "online_sales_conversion" -> formula sales_conversion on channel "online".
  // numerator = 2 (online sales), denominator = 3 (online leads in period).
  // ratio = 2/3 = 0.666..., display = 66.7%.
  assert.equal(out.conversion.display_percentages["Online Sales Conversion"], 66.7);
  assert.equal(out.conversion.display["Online Sales Conversion"], "66.7%");

  // ----- Losses -----
  assert.equal(out.losses.display["Cancels"], 2);
  assert.equal(out.losses.display["RFC"], 1);
  assert.equal(out.losses.display["Revocations"], 1);
  // Pending Cancel: 2 of 3 — the Staff Plan member is excluded.
  assert.equal(out.losses.display["Pending Cancel"], 2);

  // ----- Membership -----
  // Seed = 100. losses (cancels+rfc+revocations) = 2+1+1 = 4. sales = 4.
  // current = 100 + 4 - 4 = 100. net_gain = 0. attrition = 4/100 = 4.00%.
  assert.equal(out.membership.internal.start_of_month_member_base, 100);
  assert.equal(out.membership.internal.current_member_base, 100);
  assert.equal(out.membership.internal.net_gain, 0);
  assert.equal(Math.round((out.membership.internal.attrition_ratio as number) * 10000) / 100, 4.0);

  // ----- Velocity -----
  // Channel labels are humanized: Online / Phone / Referral / Total.
  // Buckets are "Same week" / "Within 14 days" / "Within 15+ days".
  // Online sales: Alice (sale 4/3, lead 4/2 -> days=1, bucket=same_week)
  //               Bob   (sale 4/9, lead 4/5 -> days=4, bucket=same_week)
  //   So Online row: same_week=2 (cum), within_14=2, within_15+=2, total=2.
  // Phone sales: Dave  (sale 4/15, lead 4/12 -> days=3, bucket=same_week)
  //              Mystery (no lead -> bucket=same_week per config)
  //   So Phone row: same_week=2 (cum), within_14=2, within_15+=2, total=2.
  // Referral: 0/0/0/0.
  // Total: 4/4/4 with total=4.
  // Per-row totals use the same display_labels.sales.total_sales override
  // ("All Sales") that the sales tile uses — proves the velocity row total
  // is config-driven and cannot drift from the sales tile's totals row.
  const onlineRow = out.pipeline_velocity.channels["Online"];
  assert.equal((onlineRow["Same week"] as { count: number }).count, 2);
  assert.equal((onlineRow["Within 14 days"] as { count: number }).count, 2);
  assert.equal((onlineRow["Within 15+ days"] as { count: number }).count, 2);
  assert.equal(onlineRow["All Sales"], 2);
  assert.equal(
    onlineRow["Total Sales"],
    undefined,
    "default 'Total Sales' must be absent when display_labels.sales.total_sales is overridden",
  );

  const phoneRow = out.pipeline_velocity.channels["Phone"];
  assert.equal((phoneRow["Same week"] as { count: number }).count, 2);
  assert.equal((phoneRow["Within 14 days"] as { count: number }).count, 2);
  assert.equal((phoneRow["Within 15+ days"] as { count: number }).count, 2);
  assert.equal(phoneRow["All Sales"], 2);

  const totalRow = out.pipeline_velocity.channels["Total"];
  assert.equal((totalRow["Same week"] as { count: number }).count, 4);
  assert.equal((totalRow["Within 15+ days"] as { count: number }).count, 4);
  assert.equal(totalRow["All Sales"], 4);

  // ----- Validation -----
  // sales_reconcile: 2+2+0 == 4 — pass.
  const byName = Object.fromEntries(out.validation_results.map((v) => [v.name, v]));
  assert.equal(byName["sales_reconcile"]?.passed, true);
  assert.equal(byName["member_math_reconciles"]?.passed, true);
});

test("second-gym configurability — Powerhouse-only logic does NOT leak: 'guest' is not a magic value here", async () => {
  // If the engine secretly respected the string "guest" or "Pending Cancel"
  // outside of config, we'd see it here. We send a lead with source="guest"
  // — it should be classified as a regular channel called "guest" (because
  // this gym's default attribution echoes lead.source) and either land in
  // its own bucket or count as a non-reported channel. Either way, the
  // engine should NOT treat it specially.
  const config = await loadConfig("test_gym_b");
  const period = calendarMonthPeriod("2026-04", config.timezone.value);

  const leads: LeadRow[] = [
    lead({ source_id: "G1", first: "Stranger", last: "Walks", source: "guest", created_at: "2026-04-15T15:00:00.000Z" }),
    lead({ source_id: "L1", first: "A", last: "B", source: "online", created_at: "2026-04-15T15:00:00.000Z" }),
  ];

  const out = runAnalytics(
    {
      gym_id: GYM_ID,
      period,
      leads,
      sales: [],
      members_snapshot: [],
      rfc_entries: [],
      cancellations: [],
      prior_period_current_member_base: null,
    },
    config,
  );

  // The "guest" lead is not in this gym's reported channels (online,
  // phone, referral) and not in internal_only_excluded_from_counts —
  // it falls through (engine ignores it for total leads). What MATTERS
  // is total_leads = 1 (the online lead), and not, e.g., 2 (which would
  // happen if "guest" got upgraded to walk_in by the universal default
  // path, leaking Powerhouse-specific behavior). test_gym_b configures
  // the totals-row override to "All Leads".
  assert.equal(out.lead_generation.display["All Leads"], 1);
  assert.equal(out.lead_generation.display["Online Leads"], 1);
});
