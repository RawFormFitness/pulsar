// lib/parsers/__tests__/abc_rfc.test.ts
//
// The spec PDF and task brief mention "~204 real entries" for RFC, but
// inspection of prototype/sample_data/Test_RFC_Report.csv shows 98 actual
// data rows (one POWERHOUSE GYM NYC line per agreement). The footer near
// the end of the file even contains a literal cell "98" which lines up
// with our count — strong evidence this sample's true RFC count is 98.
//
// We assert 98 as the truth for THIS sample and document the discrepancy
// in the final report. The spec-PDF figure of ~204 likely refers to a
// different month or a combined metric that includes pending-cancel rows.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseAbcRfc } from "@/lib/parsers/abc_rfc";
import { loadSample, TEST_GYM_ID } from "./_helpers";

test("parseAbcRfc — Test_RFC_Report.csv yields 98 rows", async () => {
  const buf = await loadSample("Test_RFC_Report.csv");
  const result = await parseAbcRfc(buf, TEST_GYM_ID);
  assert.equal(
    result.rowCount,
    98,
    "expected 98 RFC rows in the current sample (footer cell '98' corroborates).",
  );
});

test("parseAbcRfc — every row has gym_id, numeric agreement_number, and a status_date", async () => {
  const buf = await loadSample("Test_RFC_Report.csv");
  const result = await parseAbcRfc(buf, TEST_GYM_ID);
  for (const r of result.rows) {
    assert.equal(r.gym_id, TEST_GYM_ID);
    assert.equal(typeof r.agreement_number, "number");
    assert.match(r.status_date, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("parseAbcRfc — club_name is propagated as group context", async () => {
  const buf = await loadSample("Test_RFC_Report.csv");
  const result = await parseAbcRfc(buf, TEST_GYM_ID);
  const clubs = new Set(result.rows.map((r) => r.club_name).filter(Boolean));
  assert.ok(clubs.size > 0, "expected at least one club_name on RFC rows");
});

test("parseAbcRfc — numeric fields parse cleanly", async () => {
  const buf = await loadSample("Test_RFC_Report.csv");
  const result = await parseAbcRfc(buf, TEST_GYM_ID);
  for (const r of result.rows) {
    if (r.next_due_amount != null) {
      assert.ok(Number.isFinite(r.next_due_amount));
    }
    if (r.total_past_due != null) {
      assert.ok(Number.isFinite(r.total_past_due));
    }
    if (r.days_past_due != null) {
      assert.ok(Number.isInteger(r.days_past_due));
    }
  }
});

test("parseAbcRfc — produces no warnings on the sample", async () => {
  const buf = await loadSample("Test_RFC_Report.csv");
  const result = await parseAbcRfc(buf, TEST_GYM_ID);
  assert.equal(
    result.warnings.length,
    0,
    `unexpected RFC parse warnings: ${JSON.stringify(result.warnings)}`,
  );
});
