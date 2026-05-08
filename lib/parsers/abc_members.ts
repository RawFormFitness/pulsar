// lib/parsers/abc_members.ts
//
// Adapter for ABC Ignite "Active Members" snapshot. Grouped: club →
// management group. Ports `parse_abc_members` from prototype/parsers.py.
//
// This adapter produces a snapshot row per agreement. The orchestrator
// stamps `as_of` (snapshot timestamp) at upsert time — see lib/import/run.ts.

import { runGroupedReport, type GroupedReportConfig } from "./engine";
import {
  blankToNull,
  collapseWhitespace,
  noteIfBadDate,
  parseAbcDate,
  parseInteger,
  parseNumber,
} from "./values";
import { readInput, type ParserInput } from "./io";
import type { Json } from "@/lib/db/types";
import type { MemberRow, ParseResult, ParseWarning } from "./types";

const ABC_MEMBERS_CONFIG: GroupedReportConfig = {
  headerMarkers: ["member", "agreement", "last visit", "next due"],
  dataAnchorColumn: "agreement_number",
  groupLevels: [
    { columnIndex: 0, fieldName: "club_name" },
    { columnIndex: 4, fieldName: "management_group" },
  ],
};

const MAPPED = new Set([
  "member_status",
  "agreement_number",
  "primary_member",
  "member_name",
  "next_due_amount",
  "renewal_cash",
  "renewal_eft",
  "renewal_statement",
  "expiration_date",
  "primary_phone",
  "agreement_payment_plan",
  "email",
  "gender",
  "age",
  "last_visit_date",
  "begin_date",
  "visits_used",
  "check_in_count",
  "membership_type",
  "club_name",
  "management_group",
]);

export async function parseAbcMembers(
  input: ParserInput,
  gymId: string,
  asOf: Date = new Date(),
): Promise<ParseResult<MemberRow>> {
  const { text, sourceHash } = await readInput(input);
  const engine = runGroupedReport(text, ABC_MEMBERS_CONFIG);
  const warnings: ParseWarning[] = [...engine.warnings];

  const asOfIso = asOf.toISOString();

  const rows: MemberRow[] = [];
  for (const er of engine.rows) {
    const f = er.fields;
    const agreement = parseInteger(f["agreement_number"]);
    if (agreement === null) {
      warnings.push({
        row: er.sourceRowNumber,
        column: "agreement_number",
        code: "MISSING_NATURAL_KEY",
        message: "Member row had non-numeric agreement_number after the anchor filter; row dropped.",
      });
      continue;
    }

    const lastVisit = parseAbcDate(f["last_visit_date"]);
    noteIfBadDate(warnings, lastVisit.ok, {
      row: er.sourceRowNumber,
      column: "last_visit_date",
      raw: f["last_visit_date"],
    });

    const begin = parseAbcDate(f["begin_date"]);
    noteIfBadDate(warnings, begin.ok, {
      row: er.sourceRowNumber,
      column: "begin_date",
      raw: f["begin_date"],
    });

    const expiration = parseAbcDate(f["expiration_date"]);
    noteIfBadDate(warnings, expiration.ok, {
      row: er.sourceRowNumber,
      column: "expiration_date",
      raw: f["expiration_date"],
    });

    const raw: Record<string, Json> = {};
    for (const [k, v] of Object.entries(f)) {
      if (MAPPED.has(k)) continue;
      if (k.startsWith("col_")) continue;
      raw[k] = blankToNull(v);
    }

    rows.push({
      gym_id: gymId,
      agreement_number: agreement,
      as_of: asOfIso,
      member_status: blankToNull(f["member_status"]),
      primary_member: blankToNull(f["primary_member"]),
      member_name: blankToNull(f["member_name"]),
      next_due_amount: parseNumber(f["next_due_amount"]),
      renewal_cash: parseNumber(f["renewal_cash"]),
      renewal_eft: parseNumber(f["renewal_eft"]),
      renewal_statement: parseNumber(f["renewal_statement"]),
      expiration_date: expiration.iso,
      primary_phone: blankToNull(f["primary_phone"]),
      payment_plan: collapseWhitespace(f["agreement_payment_plan"]) || null,
      email: blankToNull(f["email"]),
      gender: blankToNull(f["gender"]),
      age: parseInteger(f["age"]),
      last_visit_date: lastVisit.iso,
      begin_date: begin.iso,
      visits_used: parseInteger(f["visits_used"]),
      check_in_count: parseInteger(f["check_in_count"]),
      plan_name: collapseWhitespace(f["membership_type"]) || null,
      club_name: blankToNull(f["club_name"]),
      management_group: blankToNull(f["management_group"]),
      // mrr is computed by the analytics engine, not the parser; leave null.
      mrr: null,
      raw: raw as Json,
    });
  }

  return { rows, warnings, rowCount: rows.length, sourceHash };
}
