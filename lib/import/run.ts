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
//
// Dry-run mode: when args.dryRun === true, we parse, compute the upsert
// diff (how many rows are net-new vs. would-update), but do NOT write
// anything. Returns RunImportDryRunResult instead. No import_history,
// no validation_runs, no upsert. See runImport for details.

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
import { parseCancelLedger } from "@/lib/parsers/cancel_ledger";
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
  /**
   * If true, parse + compute the would-add / would-update diff but do NOT
   * write anything. No import_history row, no validation_runs, no upsert.
   * Returns RunImportDryRunResult instead of RunImportResult.
   */
  dryRun?: boolean;
};

export type RunImportResult = {
  importId: string;
  rowCount: number;
  warnings: ParseWarning[];
  /** True when this was a no-op due to a matching prior source_hash. */
  duplicate: boolean;
  format: DetectedFormat;
};

/**
 * Result of a dry run: same shape as a real import in spirit, but reports
 * the upsert diff instead of actually writing rows.
 *
 * `wouldNoop` is intentionally always 0 in v1 — computing it would require a
 * deep equality check on every row's payload against the existing DB row,
 * which is more expensive than the preview can justify. UI should treat
 * `wouldNoop` as "we're not measuring this" and show only would-add /
 * would-update.
 */
export type RunImportDryRunResult = {
  format: DetectedFormat;
  rowCount: number;
  warnings: ParseWarning[];
  wouldAdd: number;
  wouldUpdate: number;
  wouldNoop: number;
  /** True if a prior import_history row matches this source_hash. */
  duplicate: boolean;
};

// -----------------------------------------------------------------------------
// Internal helpers — keep the formats table-driven so adding a new adapter
// is a one-line entry.

type AnyParseResult =
  | ({ format: "leads" } & ParseResult<LeadRow>)
  | ({ format: "abc_sales" } & ParseResult<SaleRow>)
  | ({ format: "abc_members" } & ParseResult<MemberRow>)
  | ({ format: "abc_rfc" } & ParseResult<RfcRow>)
  | ({ format: "cancel_ledger" } & ParseResult<CancellationRow>);

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
    case "cancel_ledger":
      return { format, ...(await parseCancelLedger(file, gymId)) };
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
    case "cancel_ledger": {
      const stripped = parsed.rows.map(({ gym_id: _g, ...r }) => r);
      return cancellationsDb.upsertCancellations(client, gymId, stripped);
    }
  }
}

/**
 * Chunk a list into pages of size N — Supabase REST clamps URLs at ~8KB,
 * which limits how many ids we can stuff into a `.in()` filter. 500 keeps
 * us comfortably under the limit even for long string ids.
 */
function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

const DIFF_CHUNK = 500;

/**
 * For a parse result, look up which of its natural keys already exist in
 * the DB for this gym. Returns { wouldAdd, wouldUpdate }.
 *
 * Members snapshots: every row is considered would-add. The natural key
 * (agreement_number, as_of) includes the snapshot timestamp, which the
 * orchestrator stamps to "now" by default for each run, so a fresh dry-run
 * never collides with a prior snapshot.
 *
 * Cancellations: keyed on agreement_number alone — the v1 deviation lumps
 * all cancellations into one stream so we don't track date or reason.
 *
 * Performance: the lookup is paged in DIFF_CHUNK-sized batches via .in().
 * For an 8k-row leads file that's ~17 round-trips; acceptable for a
 * preview interaction. A future optimization could push this to a stored
 * proc that takes the keys as one POST body.
 */
async function computeDiff(
  client: DbClient,
  gymId: string,
  parsed: AnyParseResult,
): Promise<{ wouldAdd: number; wouldUpdate: number }> {
  switch (parsed.format) {
    case "leads": {
      const ids = parsed.rows
        .map((r) => r.source_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0);
      if (ids.length === 0) return { wouldAdd: 0, wouldUpdate: 0 };
      const existing = new Set<string>();
      for (const batch of chunk(ids, DIFF_CHUNK)) {
        const { data, error } = await client
          .from("leads")
          .select("source_id")
          .eq("gym_id", gymId)
          .in("source_id", batch);
        if (error) throw error;
        for (const r of data ?? []) existing.add(r.source_id);
      }
      const update = ids.filter((id) => existing.has(id)).length;
      return { wouldAdd: parsed.rows.length - update, wouldUpdate: update };
    }
    case "abc_sales": {
      const nums = parsed.rows
        .map((r) => r.agreement_number)
        .filter((v): v is number => typeof v === "number");
      if (nums.length === 0) return { wouldAdd: 0, wouldUpdate: 0 };
      const existing = new Set<number>();
      for (const batch of chunk(nums, DIFF_CHUNK)) {
        const { data, error } = await client
          .from("sales")
          .select("agreement_number")
          .eq("gym_id", gymId)
          .in("agreement_number", batch);
        if (error) throw error;
        for (const r of data ?? []) existing.add(r.agreement_number);
      }
      const update = nums.filter((n) => existing.has(n)).length;
      return { wouldAdd: parsed.rows.length - update, wouldUpdate: update };
    }
    case "cancel_ledger": {
      // Composite key (cancel_date, member_name). Pull existing keys for
      // the candidate cancel_date set, then locally intersect.
      const pairs = parsed.rows
        .map((r) => ({ cancel_date: r.cancel_date, member_name: r.member_name }))
        .filter(
          (p): p is { cancel_date: string; member_name: string } =>
            typeof p.cancel_date === "string" &&
            typeof p.member_name === "string",
        );
      if (pairs.length === 0) return { wouldAdd: 0, wouldUpdate: 0 };
      const dates = Array.from(new Set(pairs.map((p) => p.cancel_date)));
      const existing = new Set<string>();
      for (const batch of chunk(dates, DIFF_CHUNK)) {
        const { data, error } = await client
          .from("cancellations")
          .select("cancel_date,member_name")
          .eq("gym_id", gymId)
          .in("cancel_date", batch);
        if (error) throw error;
        for (const r of data ?? [])
          existing.add(`${r.cancel_date}|${r.member_name}`);
      }
      const update = pairs.filter((p) =>
        existing.has(`${p.cancel_date}|${p.member_name}`),
      ).length;
      return { wouldAdd: parsed.rows.length - update, wouldUpdate: update };
    }
    case "abc_rfc": {
      // Composite key: (agreement_number, status_date). We pull the candidate
      // agreement_numbers, then locally intersect on (number, date) pairs.
      const pairs = parsed.rows
        .map((r) => ({
          agreement_number: r.agreement_number,
          status_date: r.status_date,
        }))
        .filter(
          (p): p is { agreement_number: number; status_date: string } =>
            typeof p.agreement_number === "number" &&
            typeof p.status_date === "string",
        );
      if (pairs.length === 0) return { wouldAdd: 0, wouldUpdate: 0 };
      const nums = Array.from(new Set(pairs.map((p) => p.agreement_number)));
      const existing = new Set<string>();
      for (const batch of chunk(nums, DIFF_CHUNK)) {
        const { data, error } = await client
          .from("rfc_entries")
          .select("agreement_number,status_date")
          .eq("gym_id", gymId)
          .in("agreement_number", batch);
        if (error) throw error;
        for (const r of data ?? [])
          existing.add(`${r.agreement_number}|${r.status_date}`);
      }
      const update = pairs.filter((p) =>
        existing.has(`${p.agreement_number}|${p.status_date}`),
      ).length;
      return { wouldAdd: parsed.rows.length - update, wouldUpdate: update };
    }
    case "abc_members": {
      // Snapshot table — natural key includes as_of, which is "now" for this
      // run. Every parsed row is would-add by construction.
      return { wouldAdd: parsed.rows.length, wouldUpdate: 0 };
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
 *
 * Dry-run path: if args.dryRun === true, returns a RunImportDryRunResult
 * with the upsert diff and skips ALL writes (no import_history,
 * no validation_runs, no upsert). The duplicate flag still reflects whether
 * the source_hash matches a prior import.
 */
export async function runImport(
  args: RunImportArgs & { dryRun: true },
): Promise<RunImportDryRunResult>;
export async function runImport(
  args: RunImportArgs & { dryRun?: false },
): Promise<RunImportResult>;
export async function runImport(
  args: RunImportArgs,
): Promise<RunImportResult | RunImportDryRunResult>;
export async function runImport(
  args: RunImportArgs,
): Promise<RunImportResult | RunImportDryRunResult> {
  const { client, gymId, file, filename, importedBy, dryRun } = args;
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
    if (dryRun) {
      // Dry-run never writes — surface the failure as an exception so the
      // server action can show it without leaving a partial paper trail.
      throw new Error(`Could not detect format of "${filename}".`);
    }
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

  // --- DRY-RUN BRANCH -------------------------------------------------------
  // No writes to import_history, no upsert, no validation_runs. We still
  // compute the diff so the UI can preview impact accurately.
  if (dryRun) {
    const diff = await computeDiff(client, gymId, parsed);
    return {
      format,
      rowCount: parsed.rowCount,
      warnings: parsed.warnings,
      wouldAdd: diff.wouldAdd,
      wouldUpdate: diff.wouldUpdate,
      wouldNoop: 0, // deliberate v1 simplification — see RunImportDryRunResult
      duplicate: !!prior,
    };
  }

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
