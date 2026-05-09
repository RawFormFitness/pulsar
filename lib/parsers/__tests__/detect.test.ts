// lib/parsers/__tests__/detect.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { detectFormat } from "@/lib/parsers/detect";
import { loadSample } from "./_helpers";

test("detectFormat — Leads sample is identified as 'leads'", async () => {
  const buf = await loadSample("Test_Leads_Report.csv");
  const r = await detectFormat(buf);
  assert.equal(r.format, "leads");
  assert.ok(r.signals.length > 0);
});

test("detectFormat — Sales sample is identified as 'abc_sales'", async () => {
  const buf = await loadSample("Test_Sales_Report.csv");
  const r = await detectFormat(buf);
  assert.equal(r.format, "abc_sales");
  assert.equal(r.confidence, "high");
});

test("detectFormat — Member Snapshot sample is identified as 'abc_members'", async () => {
  const buf = await loadSample("Test_Member_Snapshot.csv");
  const r = await detectFormat(buf);
  assert.equal(r.format, "abc_members");
  assert.equal(r.confidence, "high");
});

test("detectFormat — RFC sample is identified as 'abc_rfc'", async () => {
  const buf = await loadSample("Test_RFC_Report.csv");
  const r = await detectFormat(buf);
  assert.equal(r.format, "abc_rfc");
  assert.equal(r.confidence, "high");
});

test("detectFormat — Cancel ledger sample is identified as 'cancel_ledger'", async () => {
  const buf = await loadSample("Test_Cancel_Report.csv");
  const r = await detectFormat(buf);
  assert.equal(r.format, "cancel_ledger");
  assert.equal(r.confidence, "high");
});

test("detectFormat — gibberish returns 'unknown' with low confidence", async () => {
  const r = await detectFormat("this is not a csv\nat all\n");
  assert.equal(r.format, "unknown");
  assert.equal(r.confidence, "low");
});
