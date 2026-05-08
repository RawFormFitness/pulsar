#!/usr/bin/env node
// RLS smoke test — confirms a user in gym A cannot see gym B's rows.
//
// Prereqs:
//   * Local Supabase stack running (`npx supabase start`)
//   * Migrations + seed applied (`npx supabase db reset`)
//
// What it does:
//   1. Sign in as alpha@dev.local (member of Alpha Gym)
//   2. SELECT * FROM leads — must return ONLY Alpha rows
//   3. Sign in as beta@dev.local (member of Beta Gym)
//   4. SELECT * FROM leads — must return ONLY Beta rows
//   5. As Alpha, attempt SELECT WHERE gym_id = beta — must return zero rows
//
// Exit code: 0 on pass, 1 on fail. The output is grep-friendly.

import { createClient } from "@supabase/supabase-js";

const URL = "http://127.0.0.1:54321";
const PUBLISHABLE_KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

const ALPHA_GYM = "11111111-1111-1111-1111-111111111111";
const BETA_GYM = "22222222-2222-2222-2222-222222222222";

const fail = (msg) => {
  console.error("FAIL:", msg);
  process.exit(1);
};
const pass = (msg) => console.log("PASS:", msg);

async function signIn(email) {
  const c = createClient(URL, PUBLISHABLE_KEY);
  const { data, error } = await c.auth.signInWithPassword({
    email,
    password: "password",
  });
  if (error) fail(`signIn(${email}): ${error.message}`);
  return c;
}

async function selectLeads(client) {
  const { data, error } = await client.from("leads").select("gym_id,source_id");
  if (error) fail(`select leads: ${error.message}`);
  return data ?? [];
}

(async () => {
  // 1+2: Alpha
  const alpha = await signIn("alpha@dev.local");
  const alphaLeads = await selectLeads(alpha);
  const alphaGyms = new Set(alphaLeads.map((r) => r.gym_id));
  if (alphaGyms.size !== 1 || !alphaGyms.has(ALPHA_GYM)) {
    fail(`alpha sees gyms: ${[...alphaGyms].join(", ")} (want only ${ALPHA_GYM})`);
  }
  pass(`alpha sees ${alphaLeads.length} leads, all from Alpha gym`);

  // 3+4: Beta
  const beta = await signIn("beta@dev.local");
  const betaLeads = await selectLeads(beta);
  const betaGyms = new Set(betaLeads.map((r) => r.gym_id));
  if (betaGyms.size !== 1 || !betaGyms.has(BETA_GYM)) {
    fail(`beta sees gyms: ${[...betaGyms].join(", ")} (want only ${BETA_GYM})`);
  }
  pass(`beta sees ${betaLeads.length} leads, all from Beta gym`);

  // 5: Alpha explicitly tries to read Beta's rows — must come back empty
  const { data: cross, error: crossErr } = await alpha
    .from("leads")
    .select("source_id")
    .eq("gym_id", BETA_GYM);
  if (crossErr) fail(`cross-gym query errored: ${crossErr.message}`);
  if ((cross ?? []).length !== 0) {
    fail(`alpha saw ${cross.length} Beta rows by filtering on Beta's gym_id`);
  }
  pass("alpha gets 0 rows when explicitly filtering for Beta gym_id");

  // 6: Anonymous client — no auth — must see nothing
  const anon = createClient(URL, PUBLISHABLE_KEY);
  const { data: anonLeads, error: anonErr } = await anon
    .from("leads")
    .select("source_id");
  if (anonErr) {
    pass(`anonymous read rejected: ${anonErr.message}`);
  } else if ((anonLeads ?? []).length !== 0) {
    fail(`anonymous client saw ${anonLeads.length} rows`);
  } else {
    pass("anonymous client sees 0 rows");
  }

  console.log("\nALL RLS SMOKE TESTS PASSED");
  process.exit(0);
})();
