"use server";

// app/(dashboard)/import/actions.ts
//
// Server actions powering the import wizard.
//
// Multi-tenancy invariant: every action resolves gymId from the
// authenticated session (auth.getUser() → gym_members lookup). gymId is
// never trusted from the request body. The user can only import into a
// gym they're a member of.
//
// Boundary discipline: these actions are the single seam where the
// dashboard UI calls into the parser/orchestrator layer. Components
// (server or client) never reach past this file into lib/parsers or
// lib/import directly.
//
// Service-role client: the orchestrator does cross-table writes
// (import_history, validation_runs, fact tables) that aren't covered by
// the authenticated user's RLS write policies in v1. We use the
// service-role client and pass gymId through every helper as defense in
// depth.

import {
  createServerDbClient,
  createServiceRoleDbClient,
  gymMembers as gymMembersDb,
} from "@/lib/db";
import { detectFormat } from "@/lib/parsers/detect";
import type { DetectedFormat } from "@/lib/parsers/types";
import { runImport } from "@/lib/import";

// Hard cap to prevent runaway uploads. Real CSVs from ABC for one gym
// month are well under this; if a gym needs more, the limit is per-file
// not per-batch.
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MiB

/**
 * Resolve the current user's gym from the session. Throws if the user
 * isn't signed in or isn't a member of any gym. v1 assumes one gym per
 * user; if a user belongs to multiple, we pick the first deterministically
 * (ordered by gym_id). The dashboard will surface a switcher in v1.5+.
 */
async function resolveGymIdFromSession(): Promise<string> {
  const client = await createServerDbClient();
  const memberships = await gymMembersDb.listMembershipsForCurrentUser(client);
  if (memberships.length === 0) {
    throw new Error(
      "You are not a member of any gym. Contact your administrator.",
    );
  }
  // Stable order so we always pick the same gym across requests.
  const sorted = [...memberships].sort((a, b) =>
    a.gym_id.localeCompare(b.gym_id),
  );
  return sorted[0].gym_id;
}

async function resolveSessionUserId(): Promise<string> {
  const client = await createServerDbClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error) throw error;
  if (!user) throw new Error("Not authenticated.");
  return user.id;
}

// -----------------------------------------------------------------------------
// detectFiles
// -----------------------------------------------------------------------------

export type DetectedFileResult = {
  filename: string;
  format: DetectedFormat;
  confidence: "high" | "medium" | "low";
  signals: string[];
  error?: string;
};

/**
 * Inspect each uploaded file's bytes and decide which of the five Pulsar
 * formats it is. Returns one entry per file in input order. Errors are
 * surfaced per-file (one bad CSV doesn't fail the batch).
 */
export async function detectFiles(
  formData: FormData,
): Promise<DetectedFileResult[]> {
  // Resolve session early — even though detection itself doesn't touch
  // the DB, we want to fail fast if the user isn't authenticated.
  await resolveGymIdFromSession();

  const files = formData.getAll("files");
  const results: DetectedFileResult[] = [];

  for (const f of files) {
    if (!(f instanceof File)) continue;
    if (f.size > MAX_FILE_BYTES) {
      results.push({
        filename: f.name,
        format: "unknown",
        confidence: "low",
        signals: [],
        error: `File is larger than ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MiB.`,
      });
      continue;
    }
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      const det = await detectFormat(buf);
      results.push({
        filename: f.name,
        format: det.format,
        confidence: det.confidence,
        signals: det.signals,
      });
    } catch (e) {
      results.push({
        filename: f.name,
        format: "unknown",
        confidence: "low",
        signals: [],
        error: e instanceof Error ? e.message : "Detection failed",
      });
    }
  }

  return results;
}

// -----------------------------------------------------------------------------
// previewImport (dry-run)
// -----------------------------------------------------------------------------

export type PreviewImportEntry = {
  filename: string;
  format: DetectedFormat;
  rowCount: number;
  warnings: { row: number; column?: string; code: string; message: string }[];
  wouldAdd: number;
  wouldUpdate: number;
  wouldNoop: number;
  duplicate: boolean;
  error?: string;
};

export async function previewImport(
  formData: FormData,
): Promise<PreviewImportEntry[]> {
  const gymId = await resolveGymIdFromSession();
  const client = createServiceRoleDbClient();

  const files = formData.getAll("files");
  const overridesRaw = formData.get("overrides");
  const overrides = parseOverrides(overridesRaw);

  const out: PreviewImportEntry[] = [];

  for (const f of files) {
    if (!(f instanceof File)) continue;
    const override = overrides[f.name];
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      const r = await runImport({
        client,
        gymId,
        file: buf,
        filename: f.name,
        importedBy: "preview", // dry-run never writes import_history; this is informational only
        format:
          override && override !== "unknown"
            ? (override as DetectedFormat)
            : undefined,
        dryRun: true,
      });
      out.push({
        filename: f.name,
        format: r.format,
        rowCount: r.rowCount,
        warnings: r.warnings,
        wouldAdd: r.wouldAdd,
        wouldUpdate: r.wouldUpdate,
        wouldNoop: r.wouldNoop,
        duplicate: r.duplicate,
      });
    } catch (e) {
      out.push({
        filename: f.name,
        format: (override as DetectedFormat | undefined) ?? "unknown",
        rowCount: 0,
        warnings: [],
        wouldAdd: 0,
        wouldUpdate: 0,
        wouldNoop: 0,
        duplicate: false,
        error: e instanceof Error ? e.message : "Preview failed",
      });
    }
  }

  return out;
}

// -----------------------------------------------------------------------------
// confirmImport (real write)
// -----------------------------------------------------------------------------

export type ConfirmImportEntry = {
  filename: string;
  success: boolean;
  importId?: string;
  format: DetectedFormat;
  rowCount: number;
  duplicate: boolean;
  warnings: { row: number; column?: string; code: string; message: string }[];
  error?: string;
};

export async function confirmImport(
  formData: FormData,
): Promise<ConfirmImportEntry[]> {
  const gymId = await resolveGymIdFromSession();
  const userId = await resolveSessionUserId();
  const client = createServiceRoleDbClient();

  const files = formData.getAll("files");
  const overridesRaw = formData.get("overrides");
  const overrides = parseOverrides(overridesRaw);

  const out: ConfirmImportEntry[] = [];

  for (const f of files) {
    if (!(f instanceof File)) continue;
    const override = overrides[f.name];
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      const r = await runImport({
        client,
        gymId,
        file: buf,
        filename: f.name,
        importedBy: userId,
        format:
          override && override !== "unknown"
            ? (override as DetectedFormat)
            : undefined,
        dryRun: false,
      });
      out.push({
        filename: f.name,
        success: true,
        importId: r.importId,
        format: r.format,
        rowCount: r.rowCount,
        duplicate: r.duplicate,
        warnings: r.warnings,
      });
    } catch (e) {
      out.push({
        filename: f.name,
        success: false,
        format: (override as DetectedFormat | undefined) ?? "unknown",
        rowCount: 0,
        duplicate: false,
        warnings: [],
        error: e instanceof Error ? e.message : "Import failed",
      });
    }
  }

  return out;
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function parseOverrides(raw: FormDataEntryValue | null): Record<string, string> {
  if (typeof raw !== "string" || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
