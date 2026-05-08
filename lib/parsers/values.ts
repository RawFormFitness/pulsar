// lib/parsers/values.ts
//
// Value coercion helpers shared by every adapter. Kept tiny and pure so
// they're easy to test and reason about.
//
// Rules carry from the spec PDF "Pre-Processing" section:
//   * Lead timestamps are timezone-aware (e.g. "2025-08-11 18:57:37 -0400").
//     Parse to a UTC ISO string.
//   * ABC report dates are plain "YYYY-MM-DD HH:MM:SS.S" or "YYYY-MM-DD"
//     with no offset; parse as date-only (the analytics engine localizes
//     for display).
//   * Plan-name whitespace must be collapsed (ABC inserts spurious double
//     spaces around the plan name; we collapse runs of whitespace to a
//     single space and trim).
//
// Anything that can fail produces a structured warning rather than throwing;
// that's the contract with the orchestrator.

import type { ParseWarning } from "./types";

/** Returns the input with consecutive whitespace collapsed to a single space. */
export function collapseWhitespace(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/\s+/g, " ").trim();
}

/** Empty-string-aware. Returns null for blanks; otherwise the trimmed value. */
export function blankToNull(s: unknown): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  return t === "" ? null : t;
}

/**
 * ABC reports use a literal "-" as a placeholder for "no value." For the
 * date parsers we treat it as a blank — it's an explicit absence of data,
 * not a malformed date. Returning null here keeps DATE_UNPARSEABLE
 * warnings reserved for actual parse failures.
 */
function isAbcSentinel(s: string): boolean {
  const t = s.trim();
  return t === "" || t === "-" || t === "—" || t === "n/a" || t === "N/A";
}

/**
 * Parse an offset-aware timestamp like "2025-08-11 18:57:37 -0400" or
 * "2025-08-11T18:57:37-04:00". Returns a UTC ISO string. Returns null if
 * the input is empty or unparseable.
 *
 * Note on DST drift: ABC and Gym Sales sometimes emit timestamps that drift
 * across DST boundaries in the source data itself. The spec PDF flags this
 * as a "Known Edge Case." Our job here is only to honor the offset that's
 * actually written in the file — the analytics layer is where any
 * gym-local-day reasoning happens.
 */
export function parseOffsetTimestamp(
  raw: unknown,
): { iso: string | null; ok: boolean } {
  const s = blankToNull(raw);
  if (s === null) return { iso: null, ok: true };
  if (isAbcSentinel(s)) return { iso: null, ok: true };

  // Native Date.parse handles ISO-8601 and many "YYYY-MM-DD HH:MM:SS ±ZZZZ"
  // shapes. We normalize the "YYYY-MM-DD HH:MM:SS -0400" shape to ISO so it
  // parses everywhere consistently.
  const norm = s.replace(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?\s*([+-]\d{2}):?(\d{2})$/,
    (_m, d, t, ms, h, mm) => `${d}T${t}${ms ?? ""}${h}:${mm}`,
  );
  const ms = Date.parse(norm);
  if (Number.isNaN(ms)) return { iso: null, ok: false };
  return { iso: new Date(ms).toISOString(), ok: true };
}

/**
 * Parse a plain (offset-less) ABC date like "2026-04-18" or
 * "2025-11-18 00:00:00.0". We treat these as calendar dates and return
 * "YYYY-MM-DD". Time components are ignored — ABC reports of this shape
 * never actually carry meaningful time-of-day (it's always 00:00:00.0).
 */
export function parseAbcDate(raw: unknown): { iso: string | null; ok: boolean } {
  const s = blankToNull(raw);
  if (s === null) return { iso: null, ok: true };
  if (isAbcSentinel(s)) return { iso: null, ok: true };

  // Already a plain date.
  const m1 = /^(\d{4})-(\d{2})-(\d{2})\b/.exec(s);
  if (m1) {
    const [, y, mo, d] = m1;
    // Range-validate: build a real Date and check round-trip.
    const built = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    if (
      built.getUTCFullYear() === Number(y) &&
      built.getUTCMonth() === Number(mo) - 1 &&
      built.getUTCDate() === Number(d)
    ) {
      return { iso: `${y}-${mo}-${d}`, ok: true };
    }
    return { iso: null, ok: false };
  }

  // Fallback: try Date.parse and emit YYYY-MM-DD in UTC.
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return { iso: null, ok: false };
  const dt = new Date(ms);
  return {
    iso: `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`,
    ok: true,
  };
}

/** Parse a number. Strips $, commas, whitespace. Returns null for blanks. */
export function parseNumber(raw: unknown): number | null {
  const s = blankToNull(raw);
  if (s === null) return null;
  const cleaned = s.replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Parse an integer (drops decimals). Returns null for blanks/non-numeric. */
export function parseInteger(raw: unknown): number | null {
  const n = parseNumber(raw);
  if (n === null) return null;
  return Math.trunc(n);
}

/** Yes/No → boolean | null. Handles blanks and unknown values gracefully. */
export function parseYesNo(raw: unknown): boolean | null {
  const s = blankToNull(raw);
  if (s === null) return null;
  const t = s.toLowerCase();
  if (t === "yes" || t === "true" || t === "y") return true;
  if (t === "no" || t === "false" || t === "n") return false;
  return null;
}

/** Append a date-parse warning to `warnings` only when ok=false. */
export function noteIfBadDate(
  warnings: ParseWarning[],
  ok: boolean,
  ctx: { row: number; column: string; raw: unknown },
): void {
  if (ok) return;
  warnings.push({
    row: ctx.row,
    column: ctx.column,
    code: "DATE_UNPARSEABLE",
    message: `Could not parse date in column "${ctx.column}": ${JSON.stringify(ctx.raw)}`,
  });
}
