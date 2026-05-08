// lib/parsers/abc_cancel.ts
//
// Adapter for ABC Ignite Cancel Report.
//
// PROJECT.md deviation from the spec PDF:
//   v1 ingests a structured 4-column CSV (Agreement #, Member Name,
//   Primary Member, Member Status). Cancellations are one undifferentiated
//   stream — no reason-text revocation classification, no `is_revocation`
//   field. The spec PDF's older free-text approach is not implemented.
//
// Layout (per inspection of prototype/sample_data/Test_Cancel_Report.csv):
//   row 1: title "-7105 Cancelled Members   <date range>"
//   row 2: header "Agreement #, Member Name , Primary Member, Member  Status"
//   row 3: blank
//   row 4: data
//   row 5: blank
//   row 6: data
//   ... interleaved blank rows ...
//   final rows: filter description and "Page 1 of 1"
//
// We use the flat-report engine with headerOffset=1 and then drop rows
// without a numeric Agreement # — that filters out the trailing
// "Filters: ..." and "Page 1 of 1" rows naturally.

import { runFlatReport } from "./engine";
import { blankToNull, parseInteger } from "./values";
import { readInput, type ParserInput } from "./io";
import type { Json } from "@/lib/db/types";
import type { CancellationRow, ParseResult, ParseWarning } from "./types";

const MAPPED = new Set(["agreement_number", "member_name", "primary_member", "member_status"]);

/**
 * Locate the header row by scanning the first ~5 rows for the "agreement"
 * keyword. We don't hardcode "row 2" because future ABC report variants
 * could shift it. This still respects PROJECT.md's structural requirement;
 * we just don't depend on the title row's exact contents.
 */
function findCancelHeaderOffset(csvText: string): number {
  const lines = csvText.split(/\r?\n/, 6);
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes("agreement") && lower.includes("member")) return i;
  }
  return 1; // fall back to the documented "row 2" offset.
}

export async function parseAbcCancel(
  input: ParserInput,
  gymId: string,
): Promise<ParseResult<CancellationRow>> {
  const { text, sourceHash } = await readInput(input);
  const headerOffset = findCancelHeaderOffset(text);
  const flat = runFlatReport(text, { headerOffset });
  const warnings: ParseWarning[] = [...flat.warnings];

  const rows: CancellationRow[] = [];
  for (let i = 0; i < flat.rows.length; i++) {
    const r = flat.rows[i];
    const srcRow = flat.sourceRowNumbers[i];

    const agreement = parseInteger(r["agreement_number"]);
    if (agreement === null) {
      // Footer rows ("Filters: ...", "Page 1 of 1") and stray blanks land
      // here. Drop silently — these are structural, not parse failures.
      continue;
    }

    const raw: Record<string, Json> = {};
    for (const [k, v] of Object.entries(r)) {
      if (MAPPED.has(k)) continue;
      raw[k] = blankToNull(v);
    }

    rows.push({
      gym_id: gymId,
      agreement_number: agreement,
      member_name: blankToNull(r["member_name"]),
      primary_member: blankToNull(r["primary_member"]),
      member_status: blankToNull(r["member_status"]),
      raw: raw as Json,
    });
  }

  return { rows, warnings, rowCount: rows.length, sourceHash };
}
