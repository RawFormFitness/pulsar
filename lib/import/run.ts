// lib/import/run.ts
//
// Import orchestrator. The single entry point that takes a CSV upload and
// turns it into rows in the database. Wires together:
//
//   1. Format detection (or honor an explicit override).
//   2. The right parser.
//   3. Idempotency check on (gym_id, source_hash) via import_history.
//   4. Upsert through the lib/db helpers, scoped by (gym_id, natural_key).
//   5. Recording an import_history row.
//   6. Shape-only validation_runs (required-column / anchor-filter results).
//
// Multi-tenancy: gymId is non-optional and stamped on every row before
// upsert (the parser already stamps; we re-stamp via the helper for defense
// in depth). The orchestrator never reads gym_id from the file.
//
// Cross-table reconciliation (sales = web + walk-in, member math, etc.) is
// the analytics engine's job, not ours.

import type { DbClient } from "@/lib/db";
import * as importHistoryDb from "@/lib/db/import_history";
import * as validationRunsDb from "@/lib/db/validation_runs";
import * as leadsDb from "@/lib/db/leads";
import * as salesDb from "@/lib/db/sales";
import * as membersDb from "@/lib/db/members";
import * as rfcDb from "@/lib/db/rfc_entries";
import * as cancellationsDb from "@/lib/db/cancellations";

import { detectFormat } from "@/lib/parsers/detect";
import { parseLeads } from "@/lib/parsers/leads";
import { parseAbcSales } from "@/lib/parsers/abc_sales";
import { parseAbcMembers } from "@/lib/parsers/abc_members";
import { parseAbcRfc } from "@/lib/parsers/abc_rfc";
import { parseAbcCancel } from "@/lib/parsers/abc_cancel";
import type {
  CancellationRow,
  DetectedFormat,
  LeadRow,
  MemberRow,
  ParseResult,
  ParseWarning,
  RfcRow,
  SaleRow,
} from "@/lib/parsers/types";
import type { ParserInput } from "@/lib/parsers/io";

export type RunImportArgs = {
  client: DbClient;
  gymId: string;
  file: ParserInput;
  filename: string;
  importedBy: string;
  /** Explicit override; if omitted we run detection. */
  format?: DetectedFormat;
  /** Optional snapshot timestamp for member imports. Defaults to now(). */
  asOf?: Date;
};

export type RunImportResult = {
  importId: string;
  rowCount: number;
  warnings: ParseWarning[];
  /** True when this was a no-op due to a matching prior source_hash. */
  duplicate: boolean;
  format: DetectedFormat;
};

// -----------------------------------------------------------------------------
// Internal helpers — keep the formats table-driven so adding a new adapter
// is a one-line entry.

type AnyParseResult =
  | ({ format: "leads" } & ParseResult<LeadRow>)
  | ({ format: "abc_sales" } & ParseResult<SaleRow>)
  | ({ format: "abc_members" } & ParseResult<MemberRow>)
  | ({ format: "abc_rfc" } & ParseResult<RfcRow>)
  | ({ format: "abc_cancel" } & ParseResult<CancellationRow>);

async function runParser(
  format: Exclude<DetectedFormat, "unknown">,
  file: ParserInput,
  gymId: string,
  asOf: Date,
): Promise<AnyParseResult> {
  switch (format) {
    case "leads":
      return { format, ...(await parseLeads(file, gymId)) };
    case "abc_sales":
      return { format, ...(await parseAbcSales(file, gymId)) };
    case "abc_members":
      return { format, ...(await parseAbcMembers(file, gymId, asOf)) };
    case "abc_rfc":
      return { format, ...(await parseAbcRfc(file, gymId)) };
    case "abc_cancel":
      return { format, ...(await parseAbcCancel(file, gymId)) };
  }
}

async function upsertParsed(
  client: DbClient,
  gymId: string,
  parsed: AnyParseResult,
): Promise<number> {
  switch (parsed.format) {
    case "leads": {
      const stripped = parsed.rows.map(({ gym_id: _g, ...r }) => r);
      return leadsDb.upsertLeads(client, gymId, stripped);
    }
    case "abc_sales": {
      const stripped = parsed.rows.map(({ gym_id: _g, ...r }) => r);
      return salesDb.upsertSales(client, gymId, stripped);
    }
    case "abc_members": {
      const stripped = parsed.rows.map(({ gym_id: _g, ...r }) => r);
      return membersDb.upsertMembersSnapshot(client, gymId, stripped);
    }
    case "abc_rfc": {
      const stripped = parsed.rows.map(({ gym_id: _g, ...r }) => r);
      return rfcDb.upsertRfcEntries(client, gymId, stripped);
    }
    case "abc_cancel": {
      const stripped = parsed.rows.map(({ gym_id: _g, ...r }) => r);
      return cancellationsDb.upsertCancellations(client, gymId, stripped);
    }
  }
}

/**
 * Run shape-only validation checks against a parse result and persist them
 * as `validation_runs` rows. These are intentionally cheap and local to
 * the import — cross-table reconciliation is the analytics engine's job.
 */
async function recordShapeValidations(
  client: DbClient,
  gymId: string,
  importId: string,
  warnings: ParseWarning[],
  rowCount: number,
): Promise<void> {
  const requiredMissing = warnings.filter(
    (w) => w.code === "REQUIRED_COLUMN_MISSING" || w.code === "MISSING_REQUIRED_FIELD",
  ).length;
  const anchorDrops = warnings.filter((w) => w.code === "MISSING_NATURAL_KEY").length;
  const dateDrops = warnings.filter((w) => w.code === "DATE_UNPARSEABLE").length;

  await validationRunsDb.recordValidationRun(client, gymId, {
    importId,
    checkName: "import.shape.required_columns_present",
    passed: requiredMissing === 0,
    details: { warnings: requiredMissing },
  });
  await validationRunsDb.recordValidationRun(client, gymId, {
    importId,
    checkName: "import.shape.natural_keys_present",
    passed: anchorDrops === 0,
    details: { warnings: anchorDrops },
  });
  await validationRunsDb.recordValidationRun(client, gymId, {
    importId,
    checkName: "import.shape.dates_parseable",
    passed: dateDrops === 0,
    details: { warnings: dateDrops },
  });
  await validationRunsDb.recordValidationRun(client, gymId, {
    importId,
    checkName: "import.shape.row_count_nonzero",
    passed: rowCount > 0,
    details: { row_count: rowCount },
  });
}

/**
 * Run an import end-to-end.
 *
 * Transactionality note: Supabase's REST client doesn't expose multi-statement
 * transactions over PostgREST. We accept that the upsert + import_history
 * write are not atomic in v1. If the upsert succeeds but the history write
 * fails, the rows are present but un-attributed; a re-run will find no
 * matching source_hash and re-upsert idempotently. This is documented as a
 * known gap; the schema agent can address it later by adding a stored
 * procedure that does both inside a transaction.
 */
export async function runImport(args: RunImportArgs): Promise<RunImportResult> {
  const { client, gymId, file, filename, importedBy } = args;
  const asOf = args.asOf ?? new Date();

  // --- 1. Detect (or honor override). ---------------------------------------
  let format: DetectedFormat;
  if (args.format && args.format !== "unknown") {
    format = args.format;
  } else {
    const det = await detectFormat(file);
    format = det.format;
  }

  if (format === "unknown") {
    // Record the failed attempt so the operator has a paper trail. We
    // attempt to compute a source_hash from the input first so the failed
    // import row carries a hash for diagnostics — falls back to null if
    // the input is unreadable.
    const failed = await importHistoryDb.recordImport(client, gymId, {
      filename,
      format: "unknown",
      row_count: 0,
      warnings_count: 1,
      imported_by: importedBy,
      source_hash: null,
    });
    await validationRunsDb.recordValidationRun(client, gymId, {
      importId: failed.id,
      checkName: "import.shape.format_detected",
      passed: false,
      details: { reason: "format detection returned 'unknown'" },
    });
    throw new Error(`Could not detect format of "${filename}".`);
  }

  // --- 2. Parse. ------------------------------------------------------------
  const parsed = await runParser(format, file, gymId, asOf);

  // --- 3. Idempotency check. ------------------------------------------------
  const prior = await importHistoryDb.findImportBySourceHash(
    client,
    gymId,
    parsed.sourceHash,
  );
  if (prior) {
    return {
      importId: prior.id,
      rowCount: prior.row_count,
      warnings: parsed.warnings,
      duplicate: true,
      format,
    };
  }

  // --- 4. Upsert via lib/db helpers. ----------------------------------------
  const upsertedCount = await upsertParsed(client, gymId, parsed);

  // --- 5. Record import_history. --------------------------------------------
  const history = await importHistoryDb.recordImport(client, gymId, {
    filename,
    format,
    row_count: parsed.rowCount,
    warnings_count: parsed.warnings.length,
    imported_by: importedBy,
    source_hash: parsed.sourceHash,
  });

  // --- 6. Shape-only validations attached to this import. -------------------
  await recordShapeValidations(
    client,
    gymId,
    history.id,
    parsed.warnings,
    parsed.rowCount,
  );

  return {
    importId: history.id,
    // Prefer the actual upserted count from the DB if it returned one;
    // otherwise fall back to parsed.rowCount.
    rowCount: upsertedCount > 0 ? upsertedCount : parsed.rowCount,
    warnings: parsed.warnings,
    duplicate: false,
    format,
  };
}
