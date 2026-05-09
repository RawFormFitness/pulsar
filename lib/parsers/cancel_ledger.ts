// lib/parsers/cancel_ledger.ts
//
// Adapter for Powerhouse NYC's internal cancel ledger CSV (the gym-managed
// spreadsheet that backs every cancel/revocation/pending-cancel decision).
// Replaces the previous "ABC Cancel Report" snapshot adapter — that file
// was a single-period status snapshot with no row-level cancel date and
// could not partition the four loss tiles.
//
// File shape:
//   row 1: header — first column has NO label (literal " "), then
//          "Member Name (last, first)", "Primary Phone", "Email",
//          "Effective Date", "membership $", "Membership Type",
//          "Out Of Contract?", "Payment Plan", "Paid Last Draft",
//          "Reason For Cancel  " (trailing whitespace), and a long tail
//          of empty trailing columns.
//   rows 2..N: data; cancel_date in col-0 drives loss-tile partitioning.
//   trailing rows: stub rows with only "BasicNYC,N" populated (workbook
//          autofill artifacts) and fully-blank rows. Both are dropped by
//          the (cancel_date present AND member_name present) filter.
//
// Per-row classification happens in the analytics engine (config-driven
// substring match against `reason`); this parser produces the row.
//
// Natural key: (gym_id, cancel_date, member_name). The ledger has no
// stable row identifier; cancel_date + name is unique enough at this
// scale and re-imports overwrite by design.

import { runFlatReport } from "./engine";
import { blankToNull, parseNumber, parseYesNo } from "./values";
import { readInput, type ParserInput } from "./io";
import type { Json } from "@/lib/db/types";
import type { CancellationRow, ParseResult, ParseWarning } from "./types";

// Keys we map to typed columns; everything else lands in `raw`.
const MAPPED = new Set([
  "col_0",
  "member_name_last_first",
  "primary_phone",
  "email",
  "effective_date",
  "membership",
  "membership_type",
  "out_of_contract",
  "reason_for_cancel",
]);

/**
 * Parse a US-style "M/D/YY" or "M/D/YYYY" or "MM/DD/YYYY" cancel-ledger
 * date into ISO "YYYY-MM-DD". Two-digit years are interpreted in the
 * 2000s (the ledger has no pre-2000 cancellations).
 *
 * Returns { iso, ok }. ok=false signals an unparseable non-blank input.
 */
function parseLedgerDate(raw: unknown): { iso: string | null; ok: boolean } {
  const s = blankToNull(raw);
  if (s === null) return { iso: null, ok: true };
  const m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/.exec(s.trim());
  if (!m) return { iso: null, ok: false };
  const mo = Number(m[1]);
  const d = Number(m[2]);
  let y = Number(m[3]);
  if (m[3].length === 2) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return { iso: null, ok: false };
  // Build a UTC date and round-trip to validate the day-in-month.
  const built = new Date(Date.UTC(y, mo - 1, d));
  if (
    built.getUTCFullYear() !== y ||
    built.getUTCMonth() !== mo - 1 ||
    built.getUTCDate() !== d
  ) {
    return { iso: null, ok: false };
  }
  const iso = `${y.toString().padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { iso, ok: true };
}

/**
 * "$104.49" -> 10449. Returns null for blanks. Warns on parse failure.
 */
function parseDollarsToCents(raw: unknown): number | null {
  const n = parseNumber(raw);
  if (n === null) return null;
  return Math.round(n * 100);
}

export async function parseCancelLedger(
  input: ParserInput,
  gymId: string,
): Promise<ParseResult<CancellationRow>> {
  const { text, sourceHash } = await readInput(input);
  const flat = runFlatReport(text, { headerOffset: 0 });
  const warnings: ParseWarning[] = [...flat.warnings];

  const rows: CancellationRow[] = [];
  for (let i = 0; i < flat.rows.length; i++) {
    const r = flat.rows[i];
    const srcRow = flat.sourceRowNumbers[i];

    // Hard requirement for a real row: cancel_date AND member_name. The
    // trailing "BasicNYC,N" stub rows fail this; bare "/" lines fail this.
    const cancelDateRaw = r["col_0"];
    const memberName = blankToNull(r["member_name_last_first"]);
    if (blankToNull(cancelDateRaw) === null || memberName === null) continue;

    const cancelDate = parseLedgerDate(cancelDateRaw);
    if (!cancelDate.ok || cancelDate.iso === null) {
      warnings.push({
        row: srcRow,
        column: "cancel_date",
        code: "DATE_UNPARSEABLE",
        message: `Could not parse cancel_date: ${JSON.stringify(cancelDateRaw)}`,
      });
      continue;
    }

    const effective = parseLedgerDate(r["effective_date"]);
    if (!effective.ok) {
      warnings.push({
        row: srcRow,
        column: "effective_date",
        code: "DATE_UNPARSEABLE",
        message: `Could not parse effective_date: ${JSON.stringify(r["effective_date"])}`,
      });
    }

    const raw: Record<string, Json> = {};
    for (const [k, v] of Object.entries(r)) {
      if (MAPPED.has(k)) continue;
      raw[k] = blankToNull(v);
    }

    rows.push({
      gym_id: gymId,
      cancel_date: cancelDate.iso,
      member_name: memberName,
      primary_phone: blankToNull(r["primary_phone"]),
      email: blankToNull(r["email"]),
      effective_date: effective.iso,
      membership_amount_cents: parseDollarsToCents(r["membership"]),
      membership_type: blankToNull(r["membership_type"]),
      out_of_contract: parseYesNo(r["out_of_contract"]),
      reason: blankToNull(r["reason_for_cancel"]),
      raw: raw as Json,
    });
  }

  return { rows, warnings, rowCount: rows.length, sourceHash };
}
