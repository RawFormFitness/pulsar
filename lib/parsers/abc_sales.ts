// lib/parsers/abc_sales.ts
//
// Adapter for ABC Ignite "Membership Sales by Sign Date".
// Grouped: club → salesperson. Ports `parse_abc_sales` from
// prototype/parsers.py.
//
// Note: ABC Ignite specifics (header markers, anchor column, group levels)
// live in the config object below. They are inputs to the engine, not
// engine internals — a different provider's sales report becomes a new
// adapter file with a different config.

import { runGroupedReport, type GroupedReportConfig } from "./engine";
import {
  blankToNull,
  collapseWhitespace,
  noteIfBadDate,
  parseAbcDate,
  parseInteger,
} from "./values";
import { readInput, type ParserInput } from "./io";
import type { Json } from "@/lib/db/types";
import type { ParseResult, ParseWarning, SaleRow } from "./types";

const ABC_SALES_CONFIG: GroupedReportConfig = {
  headerMarkers: ["agreement", "queue date", "membership type"],
  dataAnchorColumn: "agreement_number",
  groupLevels: [
    { columnIndex: 0, fieldName: "club_name" },
    { columnIndex: 3, fieldName: "salesperson" },
  ],
};

const MAPPED = new Set([
  "agreement_number",
  "member_name",
  "department",
  "term",
  "membership_type",
  "agreement_payment_plan",
  "queue",
  "queue_date",
  "agreement_type",
  "club_name",
  "salesperson",
]);

export async function parseAbcSales(
  input: ParserInput,
  gymId: string,
): Promise<ParseResult<SaleRow>> {
  const { text, sourceHash } = await readInput(input);
  const engine = runGroupedReport(text, ABC_SALES_CONFIG);
  const warnings: ParseWarning[] = [...engine.warnings];

  const rows: SaleRow[] = [];
  for (const er of engine.rows) {
    const f = er.fields;
    const agreement = parseInteger(f["agreement_number"]);
    if (agreement === null) {
      warnings.push({
        row: er.sourceRowNumber,
        column: "agreement_number",
        code: "MISSING_NATURAL_KEY",
        message: "Sale row had non-numeric agreement_number after passing the anchor filter; row dropped.",
      });
      continue;
    }

    const qd = parseAbcDate(f["queue_date"]);
    noteIfBadDate(warnings, qd.ok, {
      row: er.sourceRowNumber,
      column: "queue_date",
      raw: f["queue_date"],
    });

    // Stash unmapped columns. Strip engine's filler "col_*" placeholders.
    const raw: Record<string, Json> = {};
    for (const [k, v] of Object.entries(f)) {
      if (MAPPED.has(k)) continue;
      if (k.startsWith("col_")) continue;
      raw[k] = blankToNull(v);
    }

    rows.push({
      gym_id: gymId,
      agreement_number: agreement,
      member_name: blankToNull(f["member_name"]),
      department: blankToNull(f["department"]),
      term: blankToNull(f["term"]),
      // ABC inserts spurious double spaces in plan names — collapse here.
      plan_name: collapseWhitespace(f["membership_type"]) || null,
      payment_plan: collapseWhitespace(f["agreement_payment_plan"]) || null,
      queue: blankToNull(f["queue"]),
      queue_date: qd.iso,
      agreement_type: blankToNull(f["agreement_type"]),
      club_name: blankToNull(f["club_name"]),
      salesperson: blankToNull(f["salesperson"]),
      raw: raw as Json,
    });
  }

  return { rows, warnings, rowCount: rows.length, sourceHash };
}
