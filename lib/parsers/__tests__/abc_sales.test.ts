// lib/parsers/__tests__/abc_sales.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseAbcSales } from "@/lib/parsers/abc_sales";
import { loadSample, TEST_GYM_ID } from "./_helpers";

test("parseAbcSales — Test_Sales_Report.csv yields 1679 rows", async () => {
  const buf = await loadSample("Test_Sales_Report.csv");
  const result = await parseAbcSales(buf, TEST_GYM_ID);
  assert.equal(result.rowCount, 1679, "expected 1679 real agreements");
});

test("parseAbcSales — group context propagates club_name and salesperson", async () => {
  const buf = await loadSample("Test_Sales_Report.csv");
  const result = await parseAbcSales(buf, TEST_GYM_ID);

  // Club name should be propagated on every data row in the sample (single
  // club: POWERHOUSE GYM NYC).
  const clubs = new Set(result.rows.map((r) => r.club_name));
  assert.ok(clubs.has("POWERHOUSE GYM NYC"), "expected POWERHOUSE GYM NYC propagated");

  // At least some rows should have a non-null salesperson (sub-grouped under "Lavell, Allen" etc.).
  const withSalesperson = result.rows.filter((r) => r.salesperson != null).length;
  assert.ok(withSalesperson > 0, "expected at least some rows with a salesperson");
});

test("parseAbcSales — every row stamped with gym_id and has a numeric agreement_number", async () => {
  const buf = await loadSample("Test_Sales_Report.csv");
  const result = await parseAbcSales(buf, TEST_GYM_ID);
  for (const r of result.rows) {
    assert.equal(r.gym_id, TEST_GYM_ID);
    assert.equal(typeof r.agreement_number, "number");
    assert.ok(Number.isFinite(r.agreement_number));
  }
});

test("parseAbcSales — plan_name has whitespace collapsed", async () => {
  const buf = await loadSample("Test_Sales_Report.csv");
  const result = await parseAbcSales(buf, TEST_GYM_ID);
  for (const r of result.rows) {
    if (r.plan_name == null) continue;
    assert.ok(
      !/\s{2,}/.test(r.plan_name),
      `plan_name should not contain runs of whitespace: ${JSON.stringify(r.plan_name)}`,
    );
  }
});

test("parseAbcSales — footer rows produce no warnings", async () => {
  const buf = await loadSample("Test_Sales_Report.csv");
  const result = await parseAbcSales(buf, TEST_GYM_ID);
  // Footer/junk rows are dropped silently by design — their presence
  // shouldn't pollute the warnings stream.
  const noisyCodes = result.warnings.filter(
    (w) => w.code !== "DATE_UNPARSEABLE",
  ).length;
  assert.equal(noisyCodes, 0, `unexpected non-date warnings: ${JSON.stringify(result.warnings)}`);
});
