// lib/parsers/__tests__/abc_cancel.test.ts
//
// The task brief estimated ~150 cancellation rows. Inspection of the actual
// sample yields 148 numeric-Agreement rows. We assert 148 here and document
// the small discrepancy (probably "+/- a few" in the original brief).

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseAbcCancel } from "@/lib/parsers/abc_cancel";
import { loadSample, TEST_GYM_ID } from "./_helpers";

test("parseAbcCancel — Test_Cancel_Report.csv yields 148 rows", async () => {
  const buf = await loadSample("Test_Cancel_Report.csv");
  const result = await parseAbcCancel(buf, TEST_GYM_ID);
  assert.equal(result.rowCount, 148, "expected 148 cancellations in the sample");
});

test("parseAbcCancel — every row has gym_id and numeric agreement_number", async () => {
  const buf = await loadSample("Test_Cancel_Report.csv");
  const result = await parseAbcCancel(buf, TEST_GYM_ID);
  for (const r of result.rows) {
    assert.equal(r.gym_id, TEST_GYM_ID);
    assert.equal(typeof r.agreement_number, "number");
    assert.ok(Number.isFinite(r.agreement_number));
  }
});

test("parseAbcCancel — title row, header row, and footer rows produce no warnings", async () => {
  const buf = await loadSample("Test_Cancel_Report.csv");
  const result = await parseAbcCancel(buf, TEST_GYM_ID);
  assert.equal(
    result.warnings.length,
    0,
    `unexpected warnings: ${JSON.stringify(result.warnings)}`,
  );
});

test("parseAbcCancel — primary_member and member_status survive parsing", async () => {
  const buf = await loadSample("Test_Cancel_Report.csv");
  const result = await parseAbcCancel(buf, TEST_GYM_ID);
  const sample = result.rows[0];
  assert.ok(sample.member_name, "first row should have a member_name");
  // Sample uses "Yes"/"Cancelled" — we keep these as strings (the schema is
  // string|null on these fields). No revocation classification per
  // PROJECT.md deviation.
  assert.equal(typeof sample.primary_member, "string");
  assert.equal(typeof sample.member_status, "string");
});
