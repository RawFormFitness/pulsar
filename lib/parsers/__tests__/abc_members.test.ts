// lib/parsers/__tests__/abc_members.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseAbcMembers } from "@/lib/parsers/abc_members";
import { loadSample, TEST_GYM_ID } from "./_helpers";

test("parseAbcMembers — Test_Member_Snapshot.csv yields 1370 rows", async () => {
  const buf = await loadSample("Test_Member_Snapshot.csv");
  const result = await parseAbcMembers(buf, TEST_GYM_ID);
  assert.equal(result.rowCount, 1370, "expected 1370 active members");
});

test("parseAbcMembers — every row stamped with gym_id, agreement_number, as_of", async () => {
  const buf = await loadSample("Test_Member_Snapshot.csv");
  const asOf = new Date("2026-05-01T00:00:00.000Z");
  const result = await parseAbcMembers(buf, TEST_GYM_ID, asOf);
  for (const r of result.rows) {
    assert.equal(r.gym_id, TEST_GYM_ID);
    assert.equal(typeof r.agreement_number, "number");
    assert.equal(r.as_of, asOf.toISOString());
  }
});

test("parseAbcMembers — group context attaches management_group", async () => {
  const buf = await loadSample("Test_Member_Snapshot.csv");
  const result = await parseAbcMembers(buf, TEST_GYM_ID);
  const groups = new Set(result.rows.map((r) => r.management_group).filter(Boolean));
  assert.ok(groups.size > 0, "expected at least one management_group propagated from group rows");
});

test("parseAbcMembers — numeric columns parse cleanly when present", async () => {
  const buf = await loadSample("Test_Member_Snapshot.csv");
  const result = await parseAbcMembers(buf, TEST_GYM_ID);
  for (const r of result.rows.slice(0, 200)) {
    if (r.next_due_amount != null) {
      assert.equal(typeof r.next_due_amount, "number");
      assert.ok(Number.isFinite(r.next_due_amount));
    }
    if (r.age != null) {
      assert.equal(typeof r.age, "number");
      assert.ok(Number.isInteger(r.age));
    }
  }
});

test("parseAbcMembers — produces no MISSING_NATURAL_KEY warnings on the sample", async () => {
  const buf = await loadSample("Test_Member_Snapshot.csv");
  const result = await parseAbcMembers(buf, TEST_GYM_ID);
  const bad = result.warnings.filter((w) => w.code === "MISSING_NATURAL_KEY");
  assert.equal(bad.length, 0, `unexpected natural-key warnings: ${JSON.stringify(bad)}`);
});
