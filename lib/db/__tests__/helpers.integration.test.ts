// lib/db/__tests__/helpers.integration.test.ts
//
// Integration tests for the row-returning helpers in lib/db. Two regression
// targets the unit tests can't reach:
//
//   1. PostgREST's silent 1,000-row cap. We insert > 1000 rows, then assert
//      every helper that returns Row[] returns the full set. Without the
//      paginate() utility, helpers truncate at 1,000 with no error, so the
//      test must use a row count strictly above 1,000.
//
//   2. The sales boundary bug — `queue_date` stored as midnight-UTC was
//      excluded by `gte(monthStart.toISOString())` because gym-local
//      midnight in ET is 04:00 UTC. We insert a row whose `queue_date` is
//      `2026-04-01T00:00:00+00` (April 1 calendar) and assert
//      `getSalesForMonth` includes it for an ET period.
//
// Setup mirrors `lib/parsers/__tests__/orchestrator.test.ts`: detect the
// local supabase stack via `npx supabase status`, build a service-role
// client directly (the lib/db client.ts uses `server-only` and won't load
// outside Next), wipe the test gym's fact tables, run.

import { before, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getMembersAsOf } from "../members";
import { getLeadsForMonth, getAllLeadsForGym } from "../leads";
import { getSalesForMonth } from "../sales";
import { getCancellationsInPeriod } from "../cancellations";
import { getRfcEntriesForMonth } from "../rfc_entries";
import type { Database } from "../types";

const ALPHA_GYM = "11111111-1111-1111-1111-111111111111";
const BETA_GYM = "22222222-2222-2222-2222-222222222222";

function readSupabaseStatus(): { url: string; secret: string } | null {
  try {
    const out = execSync("npx --yes supabase status 2>/dev/null", {
      encoding: "utf8",
      timeout: 10_000,
    });
    const urlMatch = out.match(/Project URL\s*│\s*(\S+)/);
    const secretMatch = out.match(/Secret\s+│\s*(\S+)/);
    if (!urlMatch || !secretMatch) return null;
    return { url: urlMatch[1], secret: secretMatch[1] };
  } catch {
    return null;
  }
}

let client: SupabaseClient<Database>;
let stackAvailable = true;

before(async () => {
  const status = readSupabaseStatus();
  if (status) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = status.url;
    process.env.SUPABASE_SECRET_KEY = status.secret;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    stackAvailable = false;
    return;
  }
  client = createSupabaseClient<Database>(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Wipe the test gyms' fact tables so the tests are deterministic.
  for (const gym of [ALPHA_GYM, BETA_GYM]) {
    await client.from("validation_runs").delete().eq("gym_id", gym);
    await client.from("import_history").delete().eq("gym_id", gym);
    await client.from("leads").delete().eq("gym_id", gym);
    await client.from("sales").delete().eq("gym_id", gym);
    await client.from("members").delete().eq("gym_id", gym);
    await client.from("rfc_entries").delete().eq("gym_id", gym);
    await client.from("cancellations").delete().eq("gym_id", gym);
  }
});

test("getMembersAsOf returns > 1000 rows (paginated past PostgREST default cap)", async (t) => {
  if (!stackAvailable) return t.skip("local Supabase stack not detected");

  // 1,370 mirrors the size of Powerhouse NYC's hosted snapshot — the value
  // that surfaced the cap in the first place.
  const TOTAL = 1370;
  const asOf = new Date("2026-04-30T04:00:00Z");

  const rows = Array.from({ length: TOTAL }, (_, i) => ({
    gym_id: ALPHA_GYM,
    agreement_number: 9_000_000 + i,
    as_of: asOf.toISOString(),
    member_status: i < 13 ? "Pending Cancel" : "Ok",
    plan_name: "Standard",
  }));

  // Bulk insert in batches that fit under PostgREST's request limits. We
  // use `upsert` so re-running the test (which wipes first) is robust.
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error } = await client
      .from("members")
      .upsert(slice, { onConflict: "gym_id,agreement_number,as_of" });
    if (error) throw error;
  }

  const out = await getMembersAsOf(client, ALPHA_GYM, asOf);
  assert.equal(out.length, TOTAL, "expected all rows back, not the 1,000 cap");

  // The Pending Cancel population specifically — the bug that broke the
  // dashboard's loss block. All 13 must be present.
  const pending = out.filter((r) => r.member_status === "Pending Cancel");
  assert.equal(pending.length, 13);

  // Cross-gym scope: Beta sees nothing.
  const betaOut = await getMembersAsOf(client, BETA_GYM, asOf);
  assert.equal(betaOut.length, 0);
});

test("getAllLeadsForGym returns > 1000 rows", async (t) => {
  if (!stackAvailable) return t.skip("local Supabase stack not detected");

  const TOTAL = 1100;
  const rows = Array.from({ length: TOTAL }, (_, i) => ({
    gym_id: ALPHA_GYM,
    source_id: `pag-test-${i}`,
    // Spread the created_at across a month so any future date filter
    // doesn't accidentally narrow to 1 day.
    created_at: new Date(2026, 0, 1 + (i % 28), 12).toISOString(),
  }));

  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error } = await client
      .from("leads")
      .upsert(slice, { onConflict: "gym_id,source_id" });
    if (error) throw error;
  }

  const out = await getAllLeadsForGym(client, ALPHA_GYM);
  assert.equal(out.length, TOTAL);

  // getLeadsForMonth also paginates — pull January, expect everything (all
  // rows fall in January per the fixture above).
  const jan = await getLeadsForMonth(
    client,
    ALPHA_GYM,
    new Date(Date.UTC(2026, 0, 1)),
    new Date(Date.UTC(2026, 1, 1)),
  );
  assert.equal(jan.length, TOTAL);
});

test("getSalesForMonth includes April 1 boundary rows for an ET period", async (t) => {
  if (!stackAvailable) return t.skip("local Supabase stack not detected");

  // queue_date stored as midnight UTC (the parser's convention — plain
  // YYYY-MM-DD lifted to timestamptz).
  const aprilFirst = "2026-04-01T00:00:00+00:00"; // April 1 calendar date
  const marchThirtyOne = "2026-03-31T20:00:00+00:00"; // March 31 16:00 ET — NOT in April
  const aprilThirty = "2026-04-30T00:00:00+00:00";
  const mayFirst = "2026-05-01T00:00:00+00:00"; // May 1 calendar date — NOT in April

  const fixtures = [
    { agreement_number: 1, queue_date: aprilFirst },
    { agreement_number: 2, queue_date: marchThirtyOne },
    { agreement_number: 3, queue_date: aprilThirty },
    { agreement_number: 4, queue_date: mayFirst },
  ].map((r) => ({ ...r, gym_id: ALPHA_GYM }));

  const { error } = await client
    .from("sales")
    .upsert(fixtures, { onConflict: "gym_id,agreement_number" });
  if (error) throw error;

  // ET-local April: 2026-04-01 00:00 ET = 2026-04-01T04:00:00Z;
  // 2026-05-01 00:00 ET = 2026-05-01T04:00:00Z.
  const monthStart = new Date("2026-04-01T04:00:00.000Z");
  const monthEnd = new Date("2026-05-01T04:00:00.000Z");

  const out = await getSalesForMonth(client, ALPHA_GYM, monthStart, monthEnd);
  const ids = out.map((r) => r.agreement_number).sort((a, b) => Number(a) - Number(b));

  // April 1 (#1) and April 30 (#3) must be present.
  // The March 31 row (#2) and May 1 row (#4) must be absent.
  assert.deepEqual(ids.map(Number), [1, 3]);
});

test("getCancellationsInPeriod and getRfcEntriesForMonth paginate", async (t) => {
  if (!stackAvailable) return t.skip("local Supabase stack not detected");

  const TOTAL = 1050;

  // Cancellations — natural key (gym_id, cancel_date, member_name) so each
  // row needs a distinct (cancel_date, member_name) pair within April.
  const cancelRows = Array.from({ length: TOTAL }, (_, i) => ({
    gym_id: ALPHA_GYM,
    // Spread cancel_dates across the 30 days of April; member_name varies.
    cancel_date: `2026-04-${String((i % 30) + 1).padStart(2, "0")}`,
    member_name: `pag-${i}`,
  }));
  for (let i = 0; i < cancelRows.length; i += 500) {
    const slice = cancelRows.slice(i, i + 500);
    const { error } = await client
      .from("cancellations")
      .upsert(slice, { onConflict: "gym_id,cancel_date,member_name" });
    if (error) throw error;
  }

  const cancels = await getCancellationsInPeriod(
    client,
    ALPHA_GYM,
    "2026-04-01",
    "2026-05-01",
  );
  assert.equal(cancels.length, TOTAL);

  // RFC — natural key (gym_id, agreement_number, status_date).
  const rfcRows = Array.from({ length: TOTAL }, (_, i) => ({
    gym_id: ALPHA_GYM,
    agreement_number: 8_000_000 + i,
    status_date: `2026-04-${String((i % 30) + 1).padStart(2, "0")}`,
  }));
  for (let i = 0; i < rfcRows.length; i += 500) {
    const slice = rfcRows.slice(i, i + 500);
    const { error } = await client
      .from("rfc_entries")
      .upsert(slice, { onConflict: "gym_id,agreement_number,status_date" });
    if (error) throw error;
  }

  const monthStart = new Date(Date.UTC(2026, 3, 1));
  const monthEnd = new Date(Date.UTC(2026, 4, 1));
  const rfc = await getRfcEntriesForMonth(client, ALPHA_GYM, monthStart, monthEnd);
  assert.equal(rfc.length, TOTAL);
});
