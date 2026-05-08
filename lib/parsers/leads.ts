// lib/parsers/leads.ts
//
// Adapter for Gym Sales' lead export. Flat snake_case CSV with a single
// header row. Ports `parse_leads` from prototype/parsers.py.
//
// This adapter is one of two flat-format adapters; it's an explicit example
// that "flat" CSVs are still adapters, not the engine itself. A second
// provider's lead export (e.g. Mindbody's) would get its own adapter.

import { runFlatReport } from "./engine";
import {
  blankToNull,
  noteIfBadDate,
  parseAbcDate,
  parseOffsetTimestamp,
  parseYesNo,
} from "./values";
import { readInput, type ParserInput } from "./io";
import type { Json } from "@/lib/db/types";
import type { LeadRow, ParseResult, ParseWarning } from "./types";

const REQUIRED = ["id", "created_at", "status", "source"] as const;

// Columns we map to dedicated fields on the leads table.
const MAPPED_COLUMNS = new Set<string>([
  "id",
  "first_name",
  "last_name",
  "email",
  "salesperson",
  "source",
  "status",
  "tags",
  "created_at",
  "updated_at",
  "sale_at",
  "trial_end_at",
  "leaving_at",
  "leaving_reason",
  "first_contact",
  "waiver_signed_date",
  "phone_mobile",
  "phone_home",
  "phone_work",
]);

/**
 * Parse Gym Sales' lead export.
 *
 * Multi-tenancy: stamps gymId on every row. Never reads gym_id from the CSV.
 */
export async function parseLeads(
  input: ParserInput,
  gymId: string,
): Promise<ParseResult<LeadRow>> {
  const { text, sourceHash } = await readInput(input);
  const flat = runFlatReport(text);
  const warnings: ParseWarning[] = [...flat.warnings];

  // Required-column check produces a single warning; we still parse what we can.
  for (const req of REQUIRED) {
    if (!flat.columnNames.includes(req)) {
      warnings.push({
        row: 1,
        column: req,
        code: "REQUIRED_COLUMN_MISSING",
        message: `Required column "${req}" was not found in the leads export.`,
      });
    }
  }

  const rows: LeadRow[] = [];
  for (let i = 0; i < flat.rows.length; i++) {
    const r = flat.rows[i];
    const srcRow = flat.sourceRowNumbers[i];
    const sourceId = blankToNull(r["id"]);
    if (sourceId === null) {
      warnings.push({
        row: srcRow,
        column: "id",
        code: "MISSING_NATURAL_KEY",
        message: "Lead row missing id; row dropped.",
      });
      continue;
    }

    const created = parseOffsetTimestamp(r["created_at"]);
    noteIfBadDate(warnings, created.ok, {
      row: srcRow,
      column: "created_at",
      raw: r["created_at"],
    });
    if (created.iso === null) {
      // created_at is required by the schema; skip without a stable timestamp.
      warnings.push({
        row: srcRow,
        column: "created_at",
        code: "MISSING_REQUIRED_FIELD",
        message: "Lead row missing created_at; row dropped.",
      });
      continue;
    }

    const updated = parseOffsetTimestamp(r["updated_at"]);
    noteIfBadDate(warnings, updated.ok, {
      row: srcRow,
      column: "updated_at",
      raw: r["updated_at"],
    });

    const sale = parseOffsetTimestamp(r["sale_at"]);
    noteIfBadDate(warnings, sale.ok, {
      row: srcRow,
      column: "sale_at",
      raw: r["sale_at"],
    });

    const trial = parseAbcDate(r["trial_end_at"]);
    noteIfBadDate(warnings, trial.ok, {
      row: srcRow,
      column: "trial_end_at",
      raw: r["trial_end_at"],
    });

    const leaving = parseAbcDate(r["leaving_at"]);
    noteIfBadDate(warnings, leaving.ok, {
      row: srcRow,
      column: "leaving_at",
      raw: r["leaving_at"],
    });

    const firstContact = parseOffsetTimestamp(r["first_contact"]);
    noteIfBadDate(warnings, firstContact.ok, {
      row: srcRow,
      column: "first_contact",
      raw: r["first_contact"],
    });

    const waiver = parseAbcDate(r["waiver_signed_date"]);
    noteIfBadDate(warnings, waiver.ok, {
      row: srcRow,
      column: "waiver_signed_date",
      raw: r["waiver_signed_date"],
    });

    const tagsRaw = blankToNull(r["tags"]);
    const tags = tagsRaw
      ? tagsRaw
          .split(/[,;]/)
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
      : [];

    // Phone: pick the first non-blank in priority order; the schema has a
    // single `phone` column. (Opt-out flags are kept in `raw`.)
    const phone =
      blankToNull(r["phone_mobile"]) ??
      blankToNull(r["phone_home"]) ??
      blankToNull(r["phone_work"]);

    // Stash unmapped columns in raw. opt-outs come along here as Yes/No
    // strings — we coerce to boolean for tidy storage.
    const raw: Record<string, Json> = {};
    for (const [k, v] of Object.entries(r)) {
      if (MAPPED_COLUMNS.has(k)) continue;
      if (k === "opted_out_of_sms" || k === "opted_out_of_email" || k === "guest_waiver_signed") {
        raw[k] = parseYesNo(v);
        continue;
      }
      const t = blankToNull(v);
      raw[k] = t;
    }

    rows.push({
      gym_id: gymId,
      source_id: sourceId,
      created_at: created.iso,
      updated_at: updated.iso,
      sale_at: sale.iso,
      trial_end_at: trial.iso,
      leaving_at: leaving.iso,
      leaving_reason: blankToNull(r["leaving_reason"]),
      first_contact: firstContact.iso,
      waiver_signed_date: waiver.iso,
      first_name: blankToNull(r["first_name"]),
      last_name: blankToNull(r["last_name"]),
      email: blankToNull(r["email"]),
      phone,
      salesperson: blankToNull(r["salesperson"]),
      source: blankToNull(r["source"]),
      status: blankToNull(r["status"]),
      tags,
      raw: raw as Json,
    });
  }

  return { rows, warnings, rowCount: rows.length, sourceHash };
}
