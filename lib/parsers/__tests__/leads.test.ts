// lib/parsers/__tests__/leads.test.ts
//
// Tests parseLeads against the real Test_Leads_Report.csv sample.
// Asserts row count, gym_id stamping, ISO datetime parsing, and that
// malformed dates produce structured warnings rather than throwing.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseLeads } from "@/lib/parsers/leads";
import { loadSample, TEST_GYM_ID } from "./_helpers";

test("parseLeads — Test_Leads_Report.csv yields 8408 rows", async () => {
  const buf = await loadSample("Test_Leads_Report.csv");
  const result = await parseLeads(buf, TEST_GYM_ID);

  assert.equal(result.rowCount, 8408, "expected 8408 leads in the sample");
  assert.equal(result.rows.length, 8408);
});

test("parseLeads — every row is stamped with gym_id and has a non-empty source_id and ISO created_at", async () => {
  const buf = await loadSample("Test_Leads_Report.csv");
  const result = await parseLeads(buf, TEST_GYM_ID);

  for (const r of result.rows) {
    assert.equal(r.gym_id, TEST_GYM_ID, "gym_id must be stamped on every row");
    assert.ok(typeof r.source_id === "string" && r.source_id.length > 0, "source_id present");
    assert.ok(
      typeof r.created_at === "string" && /T.*Z$/.test(r.created_at),
      `created_at must be a UTC ISO string, got ${JSON.stringify(r.created_at)}`,
    );
  }
});

test("parseLeads — sourceHash is a 64-char hex string", async () => {
  const buf = await loadSample("Test_Leads_Report.csv");
  const result = await parseLeads(buf, TEST_GYM_ID);
  assert.match(result.sourceHash, /^[0-9a-f]{64}$/);
});

test("parseLeads — same input produces same sourceHash (re-import detection)", async () => {
  const buf = await loadSample("Test_Leads_Report.csv");
  const a = await parseLeads(buf, TEST_GYM_ID);
  const b = await parseLeads(buf, TEST_GYM_ID);
  assert.equal(a.sourceHash, b.sourceHash);
});

test("parseLeads — DST-boundary timestamp parses as UTC", async () => {
  // Synthetic: a row with a timestamp on the US Spring-forward DST boundary.
  // The contract is "honor whatever offset the file carries; emit UTC."
  const csv = [
    "id,first_name,last_name,email,status,source,created_at,updated_at,sale_at,trial_end_at,leaving_at,first_contact,salesperson,tags,opted_out_of_sms,opted_out_of_email,phone_mobile,birthday,guest_waiver_signed,waiver_signed_date,phone_mobile_deactivated",
    'TEST_DST,Spring,Forward,sf@test.local,sale,Website,2026-03-08 02:30:00 -0500,2026-03-08 02:30:00 -0400,,,,,,Stephen,,No,No,,,,No,,false',
  ].join("\n");
  const result = await parseLeads(csv, TEST_GYM_ID);
  assert.equal(result.rows.length, 1);
  // -0500 with 02:30 → 07:30 UTC.
  assert.equal(result.rows[0].created_at, "2026-03-08T07:30:00.000Z");
  // -0400 with 02:30 → 06:30 UTC.
  assert.equal(result.rows[0].updated_at, "2026-03-08T06:30:00.000Z");
});

test("parseLeads — malformed date emits a DATE_UNPARSEABLE warning, does not throw", async () => {
  const csv = [
    "id,status,source,created_at,first_contact",
    "BAD_LEAD,sale,Website,2025-08-11 18:57:37 -0400,not-a-date",
  ].join("\n");
  const result = await parseLeads(csv, TEST_GYM_ID);
  assert.equal(result.rows.length, 1);
  const dateWarn = result.warnings.find((w) => w.code === "DATE_UNPARSEABLE");
  assert.ok(dateWarn, "expected a DATE_UNPARSEABLE warning");
  assert.equal(dateWarn?.column, "first_contact");
});
