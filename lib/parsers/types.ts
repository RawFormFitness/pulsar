// lib/parsers/types.ts
//
// Shared types for the parsing layer. The engine and every per-format
// adapter speak in these. Domain row types are intentionally additive over
// the Database Insert types — each adapter narrows to its own table's row.
//
// Multi-tenancy invariant: every row that leaves a parser MUST carry
// gym_id. The Database types make gym_id required on Insert; we mirror
// that here. Never accept gym_id from the CSV — it always comes from the
// authenticated import session and is stamped on by the parser.

import type { Database, Json } from "@/lib/db/types";

/** A structured parse warning — never console.log, never silently drop. */
export type ParseWarning = {
  /** 1-based row number in the source file. */
  row: number;
  /** Optional column reference (header name or column index as string). */
  column?: string;
  /** Stable machine code for grouping warnings. */
  code: string;
  /** Human-readable message for the UI. */
  message: string;
};

/** Result envelope returned by every parser. */
export type ParseResult<T> = {
  rows: T[];
  warnings: ParseWarning[];
  rowCount: number;
  /** SHA-256 hex digest of the file bytes; used by import_history for re-import detection. */
  sourceHash: string;
};

// ---------- Domain row types --------------------------------------------------
// Each parser returns rows that match the corresponding table Insert shape,
// minus generated/imported_at/id columns the DB fills in. We carry a `raw`
// JSON object on every row holding columns we couldn't map; the database
// stores it on the table's `raw` jsonb column.

export type LeadRow = Database["public"]["Tables"]["leads"]["Insert"] & {
  raw: Json;
};

export type SaleRow = Database["public"]["Tables"]["sales"]["Insert"] & {
  raw: Json;
};

export type MemberRow = Database["public"]["Tables"]["members"]["Insert"] & {
  raw: Json;
};

export type RfcRow = Database["public"]["Tables"]["rfc_entries"]["Insert"] & {
  raw: Json;
};

export type CancellationRow =
  Database["public"]["Tables"]["cancellations"]["Insert"] & {
    raw: Json;
  };

// ---------- Format identity ---------------------------------------------------

export const FORMATS = [
  "leads",
  "abc_sales",
  "abc_members",
  "abc_rfc",
  "cancel_ledger",
] as const;

export type DetectedFormat = (typeof FORMATS)[number] | "unknown";
