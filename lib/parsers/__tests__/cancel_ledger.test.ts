// lib/parsers/__tests__/cancel_ledger.test.ts
//
// Tests for parseCancelLedger against the real Powerhouse cancel ledger
// fixture at prototype/sample_data/Test_Cancel_Report.csv.
//
// The previous "ABC Cancel Report" adapter is gone — that report was a
// status snapshot with no row-level cancel date and could not partition
// the loss tiles. This file replaces abc_cancel.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseCancelLedger } from "@/lib/parsers/cancel_ledger";
import { loadSample, TEST_GYM_ID } from "./_helpers";

test("parseCancelLedger — drops trailing stub rows and yields the data rows", async () => {
  const buf = await loadSample("Test_Cancel_Report.csv");
  const result = await parseCancelLedger(buf, TEST_GYM_ID);
  // 132 real data rows in the fixture (lines 2..133). Trailing autofill
  // stub rows (BasicNYC,N only) and the bare "/" line are filtered out
  // by the (cancel_date present AND member_name present) guard. The user
  // brief estimated 133; the parser produces what the file actually
  // contains and we assert against that observed count.
  assert.equal(result.rowCount, 132, "expected 132 data rows in the ledger sample");
});

test("parseCancelLedger — every row has gym_id, parsed cancel_date, and member_name", async () => {
  const buf = await loadSample("Test_Cancel_Report.csv");
  const result = await parseCancelLedger(buf, TEST_GYM_ID);
  for (const r of result.rows) {
    assert.equal(r.gym_id, TEST_GYM_ID);
    assert.equal(typeof r.cancel_date, "string");
    assert.match(r.cancel_date as string, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof r.member_name, "string");
    assert.ok((r.member_name as string).length > 0);
  }
});

test("parseCancelLedger — April 2026 cancel_date partition has 36 rows", async () => {
  const buf = await loadSample("Test_Cancel_Report.csv");
  const result = await parseCancelLedger(buf, TEST_GYM_ID);
  const aprilRows = result.rows.filter(
    (r) =>
      typeof r.cancel_date === "string" &&
      r.cancel_date >= "2026-04-01" &&
      r.cancel_date < "2026-05-01",
  );
  assert.equal(aprilRows.length, 36, "expected exactly 36 April 2026 cancel rows");
});

test("parseCancelLedger — exactly 2 April rows match the revocation rule (\"trainer no longer here\")", async () => {
  const buf = await loadSample("Test_Cancel_Report.csv");
  const result = await parseCancelLedger(buf, TEST_GYM_ID);
  const aprilRows = result.rows.filter(
    (r) =>
      typeof r.cancel_date === "string" &&
      r.cancel_date >= "2026-04-01" &&
      r.cancel_date < "2026-05-01",
  );
  const revocations = aprilRows.filter(
    (r) =>
      typeof r.reason === "string" &&
      r.reason.toLowerCase().includes("no longer here"),
  );
  assert.equal(revocations.length, 2, "expected exactly 2 revocations in April");
  // Sanity-check the two we expect — names and dates as recorded in the fixture.
  const names = revocations.map((r) => r.member_name).sort();
  assert.deepEqual(names, ["Clayton C Erwin", "Rebecca Vanyo"]);
});

test("parseCancelLedger — typed columns survive parsing (effective_date, amount cents, out_of_contract)", async () => {
  const buf = await loadSample("Test_Cancel_Report.csv");
  const result = await parseCancelLedger(buf, TEST_GYM_ID);
  // First row in the fixture: Broder Zach, cancel 10/14/25, eff 10/14/25,
  // $99.99, Presale, OOC=N, reason "Unknown".
  const sample = result.rows[0];
  assert.equal(sample.member_name, "Broder, Zach");
  assert.equal(sample.cancel_date, "2025-10-14");
  assert.equal(sample.effective_date, "2025-10-14");
  assert.equal(sample.membership_amount_cents, 9999);
  assert.equal(sample.membership_type, "Presale");
  assert.equal(sample.out_of_contract, false);
  assert.equal(sample.reason, "Unknown");
});

test("parseCancelLedger — known effective_date anomalies surface as warnings, nothing else", async () => {
  const buf = await loadSample("Test_Cancel_Report.csv");
  const result = await parseCancelLedger(buf, TEST_GYM_ID);
  // The Powerhouse ledger has three legitimate human-error effective_date
  // values that the parser correctly refuses to guess at:
  //   row 70: "6/1126"  (typo, missing slash; presumably 6/11/26)
  //   row 73: "3/20"    (missing year)
  //   row 74: "4/30"    (missing year)
  // The parser keeps the row (cancel_date is what drives the loss tiles)
  // but stores effective_date as null and surfaces a DATE_UNPARSEABLE
  // warning so the operator can fix the source data. Asserting the exact
  // shape protects against silent regressions in either direction.
  assert.equal(result.warnings.length, 3, JSON.stringify(result.warnings));
  for (const w of result.warnings) {
    assert.equal(w.code, "DATE_UNPARSEABLE");
    assert.equal(w.column, "effective_date");
  }
  const offendingRows = result.warnings.map((w) => w.row).sort((a, b) => a - b);
  assert.deepEqual(offendingRows, [70, 73, 74]);
});
