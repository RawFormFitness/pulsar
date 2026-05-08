// lib/parsers/abc_rfc.ts
//
// Adapter for ABC Ignite RFC ("Return For Collection") report.
//
// Layout (per inspection of prototype/sample_data/Test_RFC_Report.csv):
//   row 1: title "RFC Preview ..."
//   row 2: single cell "Club Nbr"  (sub-title)
//   row 3: real headers (Club Name, _, Agreement #, Barcode, Member Name,
//                        Member Status, ..., Status Date, Term, ...,
//                        Sales Person, Sales Person Barcode, Next Due Amount,
//                        Last Billing Date, Total Past Due, Days Past Due)
//   later rows: club_name acts as a per-row marker (POWERHOUSE GYM NYC) on
//               every data row, and a single-cell row with the club number
//               (e.g. "40410") appears as a footer-section divider.
//
// The grouped-report engine handles this naturally — markers find the right
// header, the anchor column ("agreement_number") drops single-cell numeric
// footer rows AND empty rows, and there's only one logical group level here
// (club_name appearing on every row). We still configure it as a group level
// for symmetry: even if a future RFC export drops the in-row club name, the
// engine would pick it up as a label row.

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
import type { ParseResult, ParseWarning, RfcRow } from "./types";

const ABC_RFC_CONFIG: GroupedReportConfig = {
  headerMarkers: ["agreement", "status date", "days past"],
  dataAnchorColumn: "agreement_number",
  groupLevels: [{ columnIndex: 0, fieldName: "club_name" }],
};

const MAPPED = new Set([
  "club_name",
  "agreement_number",
  "barcode",
  "member_name",
  "member_status",
  "address",
  "city",
  "sta",
  "zip",
  "primary_phone",
  "cell_phone",
  "email",
  "birth_date",
  "begin_date",
  "status_date",
  "term",
  "agreement_payment_method",
  "membership_type",
  "sales_person",
  "sales_person_barcode",
  "next_due_amount",
  "last_billing_date",
  "total_past_due",
  "days_past_due",
]);

export async function parseAbcRfc(
  input: ParserInput,
  gymId: string,
): Promise<ParseResult<RfcRow>> {
  const { text, sourceHash } = await readInput(input);
  const engine = runGroupedReport(text, ABC_RFC_CONFIG);
  const warnings: ParseWarning[] = [...engine.warnings];

  const rows: RfcRow[] = [];
  for (const er of engine.rows) {
    const f = er.fields;
    const agreement = parseInteger(f["agreement_number"]);
    if (agreement === null) {
      warnings.push({
        row: er.sourceRowNumber,
        column: "agreement_number",
        code: "MISSING_NATURAL_KEY",
        message: "RFC row had non-numeric agreement_number after the anchor filter; row dropped.",
      });
      continue;
    }

    const status = parseAbcDate(f["status_date"]);
    noteIfBadDate(warnings, status.ok, {
      row: er.sourceRowNumber,
      column: "status_date",
      raw: f["status_date"],
    });
    if (status.iso === null) {
      warnings.push({
        row: er.sourceRowNumber,
        column: "status_date",
        code: "MISSING_REQUIRED_FIELD",
        message: "RFC row missing status_date; row dropped (status_date is part of the natural key).",
      });
      continue;
    }

    const lastBilling = parseAbcDate(f["last_billing_date"]);
    noteIfBadDate(warnings, lastBilling.ok, {
      row: er.sourceRowNumber,
      column: "last_billing_date",
      raw: f["last_billing_date"],
    });

    const begin = parseAbcDate(f["begin_date"]);
    noteIfBadDate(warnings, begin.ok, {
      row: er.sourceRowNumber,
      column: "begin_date",
      raw: f["begin_date"],
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
      status_date: status.iso,
      club_name: blankToNull(f["club_name"]),
      member_name: blankToNull(f["member_name"]),
      member_status: blankToNull(f["member_status"]),
      begin_date: begin.iso,
      last_billing_date: lastBilling.iso,
      term: blankToNull(f["term"]),
      payment_method: blankToNull(f["agreement_payment_method"]),
      plan_name: collapseWhitespace(f["membership_type"]) || null,
      salesperson: collapseWhitespace(f["sales_person"]) || null,
      next_due_amount: parseNumber(f["next_due_amount"]),
      total_past_due: parseNumber(f["total_past_due"]),
      days_past_due: parseInteger(f["days_past_due"]),
      raw: raw as Json,
    });
  }

  return { rows, warnings, rowCount: rows.length, sourceHash };
}
