// lib/parsers/engine.ts
//
// Universal grouped-report engine — Level 1 (hardcoded, gym-agnostic).
//
// This is the parsing primitive that every grouped-report adapter (ABC
// Ignite Sales, Members, RFC, Cancel) reuses. It knows NOTHING about
// ABC Ignite, Powerhouse NYC, or any specific gym. The format-specific
// details — header markers, anchor column, group levels, header offset
// hints — are inputs.
//
// Adding a second provider (Mindbody, GymMaster, etc.) is a matter of
// writing a new adapter that supplies a different GroupedReportConfig.
// The engine itself does not change.
//
// Design carries faithfully from prototype/parsers.py:
//   * Header detection by marker keywords (case-insensitive substring match
//     across the joined cells of a row, all markers required).
//   * "Group label" rows = exactly one populated cell at one of the
//     configured group-level column indices; that value attaches as group
//     context to subsequent data rows.
//   * Anchor column filter: a real data row must have a numeric anchor
//     column. Footers, totals, junk fail this filter and get dropped
//     without warnings (they are expected by design).
//   * snake_case column normalization; "#" → "number".

import Papa from "papaparse";
import type { ParseWarning } from "./types";

// ---------- Input config ------------------------------------------------------

export type GroupLevel = {
  /** Column index (0-based, in the source CSV) where this group label appears. */
  columnIndex: number;
  /** Snake_case field name on the output row that receives the value. */
  fieldName: string;
};

export type GroupedReportConfig = {
  /**
   * Lowercase substrings; the engine picks the first row whose joined
   * lowercase content contains all of them. Order doesn't matter — they
   * are AND-ed.
   */
  headerMarkers: string[];
  /**
   * Snake_case name of the column the engine uses to recognize a real
   * data row. The cell must parse as a finite number. Choose a column
   * that's reliably numeric (e.g., "agreement_number"). If the format
   * has no such column, set null and every non-empty multi-cell row
   * after the header will be treated as data.
   */
  dataAnchorColumn: string | null;
  /**
   * Group label rules. A row whose ONLY populated cell is at one of these
   * indices propagates that value as group context to subsequent data
   * rows under the named field.
   */
  groupLevels: GroupLevel[];
  /**
   * Optional cap on how many rows to scan for the header. Defaults to 15.
   * Increase for files with very long preamble.
   */
  headerSearchLimit?: number;
};

// ---------- Public engine output ---------------------------------------------

export type EngineRow = {
  /** Snake_cased columns from the header row, plus group-context fields. */
  fields: Record<string, string>;
  /** 1-based source row number (for warning attribution). */
  sourceRowNumber: number;
};

export type EngineResult = {
  rows: EngineRow[];
  warnings: ParseWarning[];
  /** The detected (1-based) row number of the header. */
  headerRow: number;
  /** Snake_cased column names in source-column order. */
  columnNames: string[];
};

// ---------- Implementation ---------------------------------------------------

/** lowercase, snake_case, "#" → "number". Used for header normalization. */
export function normalizeColumnName(raw: string): string {
  let c = String(raw ?? "").trim().toLowerCase();
  c = c.replace(/#/g, "number");
  c = c.replace(/[^a-z0-9]+/g, "_");
  c = c.replace(/_+/g, "_");
  c = c.replace(/^_|_$/g, "");
  return c;
}

/**
 * Tokenize a CSV string into a 2D array of strings using Papaparse. We use
 * Papaparse with header:false and skipEmptyLines:false so we can do header
 * detection ourselves (the engine looks at content, not file position).
 */
function tokenize(csv: string): string[][] {
  const result = Papa.parse<string[]>(csv, {
    header: false,
    skipEmptyLines: false,
    dynamicTyping: false,
  });
  // Papaparse may yield warnings for jagged rows; we accept jagged input
  // because grouped reports are jagged by construction.
  return result.data.map((r) =>
    Array.isArray(r) ? r.map((v) => (v == null ? "" : String(v))) : [],
  );
}

function findHeaderRow(rows: string[][], markers: string[], limit: number): number {
  const lowered = markers.map((m) => m.toLowerCase());
  const cap = Math.min(limit, rows.length);
  for (let i = 0; i < cap; i++) {
    const cells = rows[i] ?? [];
    const blob = cells.map((c) => String(c).toLowerCase()).join(" ");
    if (lowered.every((m) => blob.includes(m))) return i;
  }
  return -1;
}

function isNumeric(s: string): boolean {
  const t = String(s ?? "").trim();
  if (t === "") return false;
  // Strip common currency/comma decoration before testing.
  const cleaned = t.replace(/[$,]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return false;
  return Number.isFinite(Number(cleaned));
}

/**
 * Run the grouped-report engine. Sync because Papaparse is sync over a
 * string and we already have the CSV in memory.
 *
 * The engine is intentionally non-throwing on shape problems — it returns
 * structured warnings. The only thrown error is "couldn't find the header
 * row at all," which means the input is the wrong format entirely and the
 * caller should surface that as a fatal parse failure (see runImport).
 */
export function runGroupedReport(
  csvText: string,
  config: GroupedReportConfig,
): EngineResult {
  const rows = tokenize(csvText);
  const warnings: ParseWarning[] = [];
  const headerLimit = config.headerSearchLimit ?? 15;

  const headerIdx = findHeaderRow(rows, config.headerMarkers, headerLimit);
  if (headerIdx === -1) {
    throw new Error(
      `Grouped report header not found within first ${headerLimit} rows. ` +
        `Required markers: ${JSON.stringify(config.headerMarkers)}`,
    );
  }

  const headerCells = rows[headerIdx] ?? [];
  const columnNames: string[] = headerCells.map((h, i) => {
    const norm = normalizeColumnName(h);
    return norm || `col_${i}`;
  });

  const anchorIdx =
    config.dataAnchorColumn !== null
      ? columnNames.indexOf(config.dataAnchorColumn)
      : -1;
  if (config.dataAnchorColumn !== null && anchorIdx === -1) {
    warnings.push({
      row: headerIdx + 1,
      column: config.dataAnchorColumn,
      code: "ANCHOR_COLUMN_NOT_FOUND",
      message: `Configured anchor column "${config.dataAnchorColumn}" was not present in the detected header. ` +
        `Falling back to a permissive non-empty filter; review the format config.`,
    });
  }

  const groupColumns = new Map<number, string>();
  for (const lvl of config.groupLevels) {
    groupColumns.set(lvl.columnIndex, lvl.fieldName);
  }
  const currentGroups: Record<string, string | null> = Object.fromEntries(
    config.groupLevels.map((g) => [g.fieldName, null]),
  );

  const out: EngineRow[] = [];

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const sourceRowNumber = r + 1; // 1-based for warnings/UI.

    const populated: Array<{ idx: number; val: string }> = [];
    for (let i = 0; i < row.length; i++) {
      const v = String(row[i] ?? "").trim();
      if (v !== "") populated.push({ idx: i, val: v });
    }
    if (populated.length === 0) continue;

    // Group label row: exactly one populated cell. If that cell sits at a
    // configured group-level column, attach it. If it doesn't, ignore the
    // row (it's a section divider, club number footer, etc.) — these are
    // expected and not warnings.
    if (populated.length === 1) {
      const { idx, val } = populated[0];
      const field = groupColumns.get(idx);
      if (field) currentGroups[field] = val;
      continue;
    }

    // Real data row: anchor must be numeric (when configured).
    if (anchorIdx !== -1) {
      const anchorVal = anchorIdx < row.length ? row[anchorIdx] : "";
      if (!isNumeric(anchorVal)) continue;
    }

    const fields: Record<string, string> = {};
    const cols = Math.min(columnNames.length, row.length);
    for (let i = 0; i < cols; i++) {
      fields[columnNames[i]] = String(row[i] ?? "");
    }
    // Attach current group context. Group fields override any blank cell
    // that happens to share the same name in the header (rare).
    for (const [field, value] of Object.entries(currentGroups)) {
      if (value !== null && (fields[field] === undefined || fields[field] === "")) {
        fields[field] = value;
      }
    }

    out.push({ fields, sourceRowNumber });
  }

  return {
    rows: out,
    warnings,
    headerRow: headerIdx + 1,
    columnNames,
  };
}

// ---------- Flat-report parsing (Level 1, used by leads + cancel) -----------

export type FlatReportResult = {
  /** Row dictionaries keyed on snake_cased headers. */
  rows: Record<string, string>[];
  warnings: ParseWarning[];
  columnNames: string[];
  /** 1-based source row number of each output row, in result-array order. */
  sourceRowNumbers: number[];
};

/**
 * Parse a flat CSV with a single header on the first non-empty row. The
 * caller can provide an optional `headerOffset` (0-based) when the file
 * has a known title row to skip; if omitted, the first non-empty row is
 * the header.
 */
export function runFlatReport(
  csvText: string,
  options: {
    /** 0-based row index of the header. Default 0 (first row). */
    headerOffset?: number;
    /** Drop rows where every cell is empty. Default true. */
    skipEmpty?: boolean;
  } = {},
): FlatReportResult {
  const headerOffset = options.headerOffset ?? 0;
  const skipEmpty = options.skipEmpty ?? true;
  const rows = tokenize(csvText);

  if (rows.length <= headerOffset) {
    return { rows: [], warnings: [], columnNames: [], sourceRowNumbers: [] };
  }

  const headerCells = rows[headerOffset] ?? [];
  const columnNames = headerCells.map((h, i) => {
    const norm = normalizeColumnName(h);
    return norm || `col_${i}`;
  });

  const out: Record<string, string>[] = [];
  const srcNums: number[] = [];
  for (let r = headerOffset + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (skipEmpty && row.every((c) => String(c ?? "").trim() === "")) continue;
    const obj: Record<string, string> = {};
    const cols = Math.min(columnNames.length, row.length);
    for (let i = 0; i < cols; i++) obj[columnNames[i]] = String(row[i] ?? "");
    out.push(obj);
    srcNums.push(r + 1);
  }

  return { rows: out, warnings: [], columnNames, sourceRowNumbers: srcNums };
}
