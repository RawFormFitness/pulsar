// lib/parsers/__tests__/orchestrator.test.ts
//
// End-to-end test of runImport against the local Supabase seed gym (Alpha).
// Verifies:
//   * import_history gets one row per successful import.
//   * The expected number of rows lands in the target table, scoped by gym_id.
//   * A second run of the same file is a no-op (idempotency on source_hash).
//   * Cross-gym leakage is blocked: rows imported under Alpha are not visible
//     under Beta.
//
// Setup: requires the local Supabase stack to be running (`supabase start`)
// and the seed.sql to have been applied.
//
// Environment hand-off: we read the local-stack URL and SECRET key out of
// `npx supabase status` if NEXT_PUBLIC_SUPABASE_URL doesn't already point at
// 127.0.0.1. This keeps the test self-contained.

import { before, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { runImport } from "@/lib/import/run";
import { loadSample } from "./_helpers";
import type { Database } from "@/lib/db/types";

const ALPHA_GYM = "11111111-1111-1111-1111-111111111111";
const BETA_GYM = "22222222-2222-2222-2222-222222222222";
const TEST_USER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

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
let sampleAvailable = true;

before(async () => {
  // Detect the local stack and override env if needed.
  const status = readSupabaseStatus();
  if (status) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = status.url;
    process.env.SUPABASE_SECRET_KEY = status.secret;
  }
  // Build a service-role client directly here. We don't import
  // createServiceRoleDbClient because that file uses `server-only` which
  // refuses to load outside a Next runtime context.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error("Local Supabase stack not detected; run `supabase start`.");
  }
  client = createSupabaseClient<Database>(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Wipe Alpha + Beta data so re-running tests is deterministic. We only
  // delete fact tables and import_history — never seed/gyms.
  for (const gym of [ALPHA_GYM, BETA_GYM]) {
    await client.from("validation_runs").delete().eq("gym_id", gym);
    await client.from("import_history").delete().eq("gym_id", gym);
    await client.from("leads").delete().eq("gym_id", gym);
    await client.from("sales").delete().eq("gym_id", gym);
    await client.from("members").delete().eq("gym_id", gym);
    await client.from("rfc_entries").delete().eq("gym_id", gym);
    await client.from("cancellations").delete().eq("gym_id", gym);
  }

  try {
    await loadSample("Test_Cancel_Report.csv");
  } catch {
    sampleAvailable = false;
  }
});

test("runImport — Cancel Report imports 148 rows under Alpha gym, scoped by gym_id", async (t) => {
  if (!sampleAvailable) return t.skip("sample data unavailable");

  const buf = await loadSample("Test_Cancel_Report.csv");
  const r = await runImport({
    client,
    gymId: ALPHA_GYM,
    file: buf,
    filename: "Test_Cancel_Report.csv",
    importedBy: TEST_USER,
  });

  assert.equal(r.duplicate, false);
  assert.equal(r.format, "abc_cancel");
  assert.equal(r.rowCount, 148);

  const { count: alphaCount, error: e1 } = await client
    .from("cancellations")
    .select("id", { count: "exact", head: true })
    .eq("gym_id", ALPHA_GYM);
  assert.equal(e1, null);
  assert.equal(alphaCount, 148);

  // Multi-tenancy: nothing under Beta.
  const { count: betaCount } = await client
    .from("cancellations")
    .select("id", { count: "exact", head: true })
    .eq("gym_id", BETA_GYM);
  assert.equal(betaCount, 0);

  // import_history has exactly one row for Alpha.
  const { data: history } = await client
    .from("import_history")
    .select("*")
    .eq("gym_id", ALPHA_GYM)
    .eq("format", "abc_cancel");
  assert.equal(history?.length, 1);
});

test("runImport — re-importing the same file is a no-op (idempotent on source_hash)", async (t) => {
  if (!sampleAvailable) return t.skip("sample data unavailable");

  const buf = await loadSample("Test_Cancel_Report.csv");
  const r2 = await runImport({
    client,
    gymId: ALPHA_GYM,
    file: buf,
    filename: "Test_Cancel_Report.csv",
    importedBy: TEST_USER,
  });
  assert.equal(r2.duplicate, true);

  // Still exactly one history row for Alpha (the duplicate didn't write a new one).
  const { data: history } = await client
    .from("import_history")
    .select("*")
    .eq("gym_id", ALPHA_GYM)
    .eq("format", "abc_cancel");
  assert.equal(history?.length, 1);

  // Still 148 rows.
  const { count } = await client
    .from("cancellations")
    .select("id", { count: "exact", head: true })
    .eq("gym_id", ALPHA_GYM);
  assert.equal(count, 148);
});

test("runImport — RFC sample imports 98 rows", async (t) => {
  if (!sampleAvailable) return t.skip("sample data unavailable");

  const buf = await loadSample("Test_RFC_Report.csv");
  const r = await runImport({
    client,
    gymId: ALPHA_GYM,
    file: buf,
    filename: "Test_RFC_Report.csv",
    importedBy: TEST_USER,
  });
  assert.equal(r.format, "abc_rfc");
  assert.equal(r.rowCount, 98);

  const { count } = await client
    .from("rfc_entries")
    .select("id", { count: "exact", head: true })
    .eq("gym_id", ALPHA_GYM);
  assert.equal(count, 98);
});
