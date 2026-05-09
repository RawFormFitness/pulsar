// lib/analytics/__tests__/_load_fixtures.ts
//
// Helpers for the analytics tests. Two responsibilities:
//
//   1. Load + parse Powerhouse's 5 source CSVs from prototype/sample_data/
//      into the row arrays the engine consumes. The cancel ledger gets
//      filtered to the period in the same way lib/db/cancellations.ts
//      would (cancel_date in [start, end)).
//   2. Load gym configs from config/gyms/<slug>.json and provide the
//      GymConfig type assertion in one place.
//
// Privacy reminder (carried over from parser tests): the sample data is
// real Powerhouse data. Tests must assert structure / aggregate counts —
// never embed row contents in committed fixtures.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseLeads } from "@/lib/parsers/leads";
import { parseAbcSales } from "@/lib/parsers/abc_sales";
import { parseAbcMembers } from "@/lib/parsers/abc_members";
import { parseAbcRfc } from "@/lib/parsers/abc_rfc";
import { parseCancelLedger } from "@/lib/parsers/cancel_ledger";
import type {
  CancellationRow,
  LeadRow,
  MemberRow,
  RfcRow,
  SaleRow,
} from "@/lib/parsers/types";
import { calendarMonthPeriod } from "@/lib/analytics/period";
import type { EngineInput, GymConfig, Period } from "@/lib/analytics/types";

const SAMPLE_DIR = resolve(process.cwd(), "prototype", "sample_data");
const CONFIG_DIR = resolve(process.cwd(), "config", "gyms");

export const POWERHOUSE_GYM_ID = "11111111-1111-1111-1111-100000000001";

async function loadFile(name: string): Promise<Buffer> {
  return readFile(resolve(SAMPLE_DIR, name));
}

export async function loadPowerhouseConfig(): Promise<GymConfig> {
  const text = await readFile(resolve(CONFIG_DIR, "powerhouse_nyc.json"), "utf8");
  return JSON.parse(text) as GymConfig;
}

export async function loadConfig(slug: string): Promise<GymConfig> {
  const text = await readFile(resolve(CONFIG_DIR, `${slug}.json`), "utf8");
  return JSON.parse(text) as GymConfig;
}

export type LoadedRows = {
  leads: LeadRow[];
  sales: SaleRow[];
  members: MemberRow[];
  rfc: RfcRow[];
  cancellations: CancellationRow[];
};

/**
 * Parse all five Powerhouse sample CSVs in memory. RFC rows are filtered
 * to the period by status_date (mirroring lib/db/rfc_entries.ts), and
 * the cancel ledger is filtered by cancel_date — matching the db helper.
 * Leads, sales, and the member snapshot return their full input set; the
 * engine handles in-period filtering itself.
 */
export async function loadPowerhouseRows(
  gymId: string,
  period: Period,
): Promise<LoadedRows> {
  const [leadsBuf, salesBuf, membersBuf, rfcBuf, cancelBuf] = await Promise.all([
    loadFile("Test_Leads_Report.csv"),
    loadFile("Test_Sales_Report.csv"),
    loadFile("Test_Member_Snapshot.csv"),
    loadFile("Test_RFC_Report.csv"),
    loadFile("Test_Cancel_Report.csv"),
  ]);

  const [leads, sales, members, rfc, cancellations] = await Promise.all([
    parseLeads(leadsBuf, gymId),
    parseAbcSales(salesBuf, gymId),
    parseAbcMembers(membersBuf, gymId),
    parseAbcRfc(rfcBuf, gymId),
    parseCancelLedger(cancelBuf, gymId),
  ]);

  // RFC: filter by status_date in [period.start, period.end). status_date
  // is a YYYY-MM-DD string in the gym's local calendar. Localize the
  // period bounds to the gym timezone and compare YYYY-MM-DD strings —
  // mirrors how the db helper's date-column compare works.
  const localStart = period.start.toLocaleDateString("en-CA", {
    timeZone: period.timezone,
  });
  const localEnd = period.end.toLocaleDateString("en-CA", {
    timeZone: period.timezone,
  });

  const rfcInPeriod = rfc.rows.filter((r) => {
    if (!r.status_date) return false;
    const ymd = r.status_date.slice(0, 10);
    return ymd >= localStart && ymd < localEnd;
  });

  const cancelInPeriod = cancellations.rows.filter((c) => {
    if (!c.cancel_date) return false;
    const ymd = c.cancel_date.slice(0, 10);
    return ymd >= localStart && ymd < localEnd;
  });

  return {
    leads: leads.rows,
    sales: sales.rows,
    members: members.rows,
    rfc: rfcInPeriod,
    cancellations: cancelInPeriod,
  };
}

/** Build an EngineInput against the Powerhouse fixture. */
export async function buildPowerhouseAprilInput(): Promise<{
  input: EngineInput;
  config: GymConfig;
}> {
  const config = await loadPowerhouseConfig();
  const period = calendarMonthPeriod("2026-04", config.timezone.value);
  const rows = await loadPowerhouseRows(POWERHOUSE_GYM_ID, period);
  return {
    input: {
      gym_id: POWERHOUSE_GYM_ID,
      period,
      leads: rows.leads,
      sales: rows.sales,
      members_snapshot: rows.members,
      rfc_entries: rows.rfc,
      cancellations: rows.cancellations,
      // Seed period — engine reads config.membership.seed_value (1237).
      prior_period_current_member_base: null,
    },
    config,
  };
}
