"use client";

// components/import-dialog.tsx
//
// The import wizard. Four steps: Drop -> Preview -> Confirm -> Results.
//
// Boundary: this client component talks to the server via the actions in
// app/(dashboard)/import/actions.ts. It never imports lib/parsers,
// lib/import, lib/db, or any Supabase client. It uploads File objects via
// FormData and renders whatever the server hands back.
//
// Multi-tenancy: gymId is resolved from session inside each server action.
// Nothing about the gym is sent in the request body.

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleHelpIcon,
  FileIcon,
  Loader2Icon,
  TrashIcon,
  UploadIcon,
  XCircleIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

import {
  detectFiles,
  previewImport,
  confirmImport,
  type DetectedFileResult,
  type PreviewImportEntry,
  type ConfirmImportEntry,
} from "@/app/(dashboard)/import/actions";

// Level 1 (universal) format catalogue. The five formats are baked into
// the engine; the labels here are the display names. If a future gym
// needs different framing, it comes from gym_configs, not by branching
// on the gym in this component.
const FORMAT_OPTIONS: { value: string; label: string }[] = [
  { value: "leads", label: "Leads (Gym Sales)" },
  { value: "abc_sales", label: "Sales (ABC Membership Sales)" },
  { value: "abc_members", label: "Member Snapshot (ABC Active Members)" },
  { value: "abc_rfc", label: "RFC (ABC Return for Collections)" },
  { value: "abc_cancel", label: "Cancellations (ABC Cancelled Members)" },
];

// "What metrics break if this format is missing?" — Level 1 universal
// copy because the engine's metric set is the same shape at every gym.
// Specific metric NAMES come from the analytics-engine's MetricsPack at
// render time; this map describes capability, not gym-specific tiles.
const MISSING_FORMAT_CONSEQUENCES: Record<string, string> = {
  leads: "Lead generation and lead-to-sale conversion can't compute.",
  abc_sales: "Sales counts and conversion rates can't compute.",
  abc_members: "Current member base, attrition, and net gain can't compute.",
  abc_rfc: "RFC losses and the past-due workflow can't render.",
  abc_cancel: "Cancellations losses can't compute and net gain will be off.",
};

const FORMAT_LABEL: Record<string, string> = Object.fromEntries(
  FORMAT_OPTIONS.map((f) => [f.value, f.label]),
);

type Step = "drop" | "preview" | "results";

type StagedFile = {
  file: File;
  detection?: DetectedFileResult;
  override?: string; // user-selected override format
  detecting: boolean;
};

export function ImportDialog({ children }: { children: React.ReactElement }) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          // Modal closed; if anything was imported the home page should
          // refresh to show the updated row counts.
          router.refresh();
        }
      }}
    >
      {/* Forward the trigger to the caller-provided <Button> so the rendered
          element is a native <button> (Base UI's DialogTrigger requires it). */}
      <DialogTrigger render={children} />
      <DialogContent
        className="sm:max-w-3xl max-h-[90vh] overflow-y-auto"
        // Prevent the modal from auto-closing on outside click; users have
        // staged files that they don't want to lose mid-flow.
      >
        <ImportWizard onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ImportWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = React.useState<Step>("drop");
  const [staged, setStaged] = React.useState<StagedFile[]>([]);
  const [previews, setPreviews] = React.useState<PreviewImportEntry[]>([]);
  const [results, setResults] = React.useState<ConfirmImportEntry[]>([]);
  const [previewing, setPreviewing] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // ---- Detection (Step 1) -------------------------------------------------
  const handleAddFiles = React.useCallback(async (files: File[]) => {
    setError(null);

    // Stage immediately with detecting=true so the UI shows a row.
    const newStaged: StagedFile[] = files.map((file) => ({
      file,
      detecting: true,
    }));
    setStaged((prev) => {
      // De-dupe by filename — replacing an earlier staged file with the same
      // name is the friendly default.
      const byName = new Map(prev.map((s) => [s.file.name, s]));
      for (const ns of newStaged) byName.set(ns.file.name, ns);
      return Array.from(byName.values());
    });

    // Run detection in one batch call.
    const fd = new FormData();
    for (const f of files) fd.append("files", f);

    try {
      const detections = await detectFiles(fd);
      const byFilename = new Map(detections.map((d) => [d.filename, d]));
      setStaged((prev) =>
        prev.map((s) => {
          const det = byFilename.get(s.file.name);
          if (!det) return s;
          return { ...s, detection: det, detecting: false };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Detection failed");
      setStaged((prev) =>
        prev.map((s) => ({ ...s, detecting: false })),
      );
    }
  }, []);

  const handleRemove = (filename: string) => {
    setStaged((prev) => prev.filter((s) => s.file.name !== filename));
    setPreviews((prev) => prev.filter((p) => p.filename !== filename));
  };

  const handleOverride = (filename: string, value: string) => {
    setStaged((prev) =>
      prev.map((s) =>
        s.file.name === filename
          ? { ...s, override: value || undefined }
          : s,
      ),
    );
  };

  // ---- Preview (Step 2) ---------------------------------------------------
  const handlePreview = async () => {
    if (staged.length === 0) return;
    setError(null);
    setPreviewing(true);
    try {
      const fd = new FormData();
      for (const s of staged) fd.append("files", s.file);
      const overrides: Record<string, string> = {};
      for (const s of staged) {
        if (s.override) overrides[s.file.name] = s.override;
      }
      fd.append("overrides", JSON.stringify(overrides));
      const out = await previewImport(fd);
      setPreviews(out);
      setStep("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  };

  // ---- Confirm (Step 3) ---------------------------------------------------
  const handleConfirm = async () => {
    if (staged.length === 0) return;
    setError(null);
    setConfirming(true);
    try {
      const fd = new FormData();
      for (const s of staged) fd.append("files", s.file);
      const overrides: Record<string, string> = {};
      for (const s of staged) {
        if (s.override) overrides[s.file.name] = s.override;
      }
      fd.append("overrides", JSON.stringify(overrides));
      const out = await confirmImport(fd);
      setResults(out);
      setStep("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setConfirming(false);
    }
  };

  // ---- Render -------------------------------------------------------------
  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>Import data</DialogTitle>
        <DialogDescription>
          {step === "drop" &&
            "Drop your CSV exports. Each file will be auto-detected — you can override if we get it wrong."}
          {step === "preview" &&
            "Review what will change before committing. Re-imports are safe; matching rows update in place."}
          {step === "results" && "Done. Here's what was imported."}
        </DialogDescription>
      </DialogHeader>

      {error && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {step === "drop" && (
        <DropStep
          staged={staged}
          onAddFiles={handleAddFiles}
          onRemove={handleRemove}
          onOverride={handleOverride}
        />
      )}

      {step === "preview" && (
        <PreviewStep previews={previews} staged={staged} />
      )}

      {step === "results" && <ResultsStep results={results} />}

      {/* Footer — different action set per step. */}
      <Separator />
      <div className="flex items-center justify-end gap-2">
        {step === "drop" && (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handlePreview}
              disabled={
                previewing ||
                staged.length === 0 ||
                staged.some((s) => s.detecting) ||
                staged.some(
                  (s) =>
                    !s.override &&
                    (!s.detection || s.detection.format === "unknown"),
                )
              }
            >
              {previewing && <Loader2Icon className="animate-spin" />}
              Preview ({staged.length})
            </Button>
          </>
        )}

        {step === "preview" && (
          <>
            <Button variant="outline" onClick={() => setStep("drop")}>
              Back
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={
                confirming ||
                previews.length === 0 ||
                previews.some((p) => p.error)
              }
            >
              {confirming && <Loader2Icon className="animate-spin" />}
              Import all
            </Button>
          </>
        )}

        {step === "results" && (
          <Button onClick={onClose}>Done</Button>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Step 1: Drop
// -----------------------------------------------------------------------------

function DropStep({
  staged,
  onAddFiles,
  onRemove,
  onOverride,
}: {
  staged: StagedFile[];
  onAddFiles: (files: File[]) => void;
  onRemove: (filename: string) => void;
  onOverride: (filename: string, value: string) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.name.toLowerCase().endsWith(".csv"),
    );
    if (files.length > 0) onAddFiles(files);
  };

  return (
    <div className="space-y-4">
      <div
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
          dragOver
            ? "border-primary bg-muted/50"
            : "border-border hover:bg-muted/30",
        )}
      >
        <UploadIcon className="size-6 text-muted-foreground" />
        <div className="text-sm font-medium">Drop CSV files here</div>
        <div className="text-xs text-muted-foreground">
          or click to browse — .csv only
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) onAddFiles(files);
            // Reset so picking the same file twice retriggers onChange.
            e.target.value = "";
          }}
        />
      </div>

      {staged.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground uppercase">
            Staged files ({staged.length})
          </div>
          {staged.map((s) => (
            <StagedFileRow
              key={s.file.name}
              staged={s}
              onRemove={() => onRemove(s.file.name)}
              onOverride={(v) => onOverride(s.file.name, v)}
            />
          ))}
        </div>
      )}

      <MissingFormatsBanner staged={staged} />
    </div>
  );
}

function StagedFileRow({
  staged,
  onRemove,
  onOverride,
}: {
  staged: StagedFile;
  onRemove: () => void;
  onOverride: (v: string) => void;
}) {
  const det = staged.detection;
  const effectiveFormat = staged.override ?? det?.format ?? "unknown";
  const needsOverride =
    !staged.detecting &&
    (!det || det.format === "unknown" || det.confidence === "low");

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <FileIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{staged.file.name}</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{(staged.file.size / 1024).toFixed(1)} KB</span>
          {det?.signals && det.signals.length > 0 && (
            <span className="truncate">· {det.signals[0]}</span>
          )}
        </div>
      </div>

      {/* Detection status icon + badge */}
      {staged.detecting ? (
        <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
      ) : det?.error ? (
        <XCircleIcon className="size-4 shrink-0 text-destructive" />
      ) : effectiveFormat === "unknown" ? (
        <CircleHelpIcon className="size-4 shrink-0 text-amber-500" />
      ) : (
        <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600" />
      )}

      {!staged.detecting && (
        <Badge
          variant={
            effectiveFormat === "unknown"
              ? "outline"
              : staged.override
                ? "secondary"
                : "default"
          }
        >
          {staged.override
            ? `${FORMAT_LABEL[effectiveFormat] ?? effectiveFormat} (override)`
            : (FORMAT_LABEL[effectiveFormat] ?? effectiveFormat)}
        </Badge>
      )}

      {needsOverride && (
        <select
          value={staged.override ?? ""}
          onChange={(e) => onOverride(e.target.value)}
          className="h-7 rounded-md border bg-background px-2 text-xs"
        >
          <option value="">Pick format…</option>
          {FORMAT_OPTIONS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      )}

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onRemove}
        aria-label="Remove file"
      >
        <TrashIcon />
      </Button>
    </div>
  );
}

function MissingFormatsBanner({ staged }: { staged: StagedFile[] }) {
  if (staged.length === 0) return null;

  // What formats are present in the staged batch?
  const presentFormats = new Set<string>();
  for (const s of staged) {
    const fmt = s.override ?? s.detection?.format;
    if (fmt && fmt !== "unknown") presentFormats.add(fmt);
  }

  const missing = FORMAT_OPTIONS.filter(
    (f) => !presentFormats.has(f.value),
  );
  if (missing.length === 0) return null;

  return (
    <Alert>
      <CircleAlertIcon />
      <AlertTitle>Some metrics won't compute</AlertTitle>
      <AlertDescription>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {missing.map((f) => (
            <li key={f.value}>
              <span className="font-medium text-foreground">{f.label}:</span>{" "}
              {MISSING_FORMAT_CONSEQUENCES[f.value]}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

// -----------------------------------------------------------------------------
// Step 2: Preview
// -----------------------------------------------------------------------------

function PreviewStep({
  previews,
  staged,
}: {
  previews: PreviewImportEntry[];
  staged: StagedFile[];
}) {
  return (
    <div className="space-y-3">
      {previews.map((p) => (
        <PreviewRow key={p.filename} preview={p} />
      ))}
      <MissingFormatsBanner staged={staged} />
    </div>
  );
}

function PreviewRow({ preview }: { preview: PreviewImportEntry }) {
  const [expanded, setExpanded] = React.useState(false);

  if (preview.error) {
    return (
      <Alert variant="destructive">
        <XCircleIcon />
        <AlertTitle className="truncate">{preview.filename}</AlertTitle>
        <AlertDescription>{preview.error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <FileIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 truncate text-sm font-medium">
          {preview.filename}
        </div>
        <Badge variant="default">
          {FORMAT_LABEL[preview.format] ?? preview.format}
        </Badge>
        {preview.duplicate && (
          <Badge variant="secondary">Already imported</Badge>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat label="Rows" value={preview.rowCount.toLocaleString()} />
        <Stat
          label="Will add"
          value={preview.wouldAdd.toLocaleString()}
          tone="positive"
        />
        <Stat
          label="Will update"
          value={preview.wouldUpdate.toLocaleString()}
          tone="muted"
        />
        <Stat
          label="Warnings"
          value={preview.warnings.length.toLocaleString()}
          tone={preview.warnings.length > 0 ? "warn" : "muted"}
        />
      </div>

      {preview.warnings.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {expanded ? "Hide" : "Show"} {preview.warnings.length} warning
            {preview.warnings.length === 1 ? "" : "s"}
          </button>
          {expanded && (
            <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto rounded-md border bg-background/40 p-2 text-xs">
              {preview.warnings.slice(0, 200).map((w, i) => (
                <li key={i} className="text-muted-foreground">
                  Row {w.row}
                  {w.column ? ` · ${w.column}` : ""} ·{" "}
                  <span className="font-mono">{w.code}</span> · {w.message}
                </li>
              ))}
              {preview.warnings.length > 200 && (
                <li className="text-muted-foreground italic">
                  …and {preview.warnings.length - 200} more.
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "positive" | "warn" | "muted";
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-base font-semibold tabular-nums",
          tone === "positive" && "text-emerald-600",
          tone === "warn" && "text-amber-600",
          tone === "muted" && "text-foreground/80",
        )}
      >
        {value}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Step 4: Results
// -----------------------------------------------------------------------------

function ResultsStep({ results }: { results: ConfirmImportEntry[] }) {
  const totalAdded = results
    .filter((r) => r.success && !r.duplicate)
    .reduce((s, r) => s + r.rowCount, 0);
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const duplicates = results.filter((r) => r.duplicate).length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Files succeeded" value={String(succeeded)} tone="positive" />
        <Stat label="Files failed" value={String(failed)} tone={failed > 0 ? "warn" : "muted"} />
        <Stat label="Already imported" value={String(duplicates)} tone="muted" />
        <Stat label="Total rows" value={totalAdded.toLocaleString()} />
      </div>

      <div className="space-y-2">
        {results.map((r) => (
          <ResultRow key={r.filename} result={r} />
        ))}
      </div>
    </div>
  );
}

function ResultRow({ result }: { result: ConfirmImportEntry }) {
  const ok = result.success;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border p-3",
        ok ? "bg-emerald-50/50 dark:bg-emerald-950/20" : "bg-destructive/5",
      )}
    >
      {ok ? (
        <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600" />
      ) : (
        <XCircleIcon className="size-4 shrink-0 text-destructive" />
      )}
      <div className="min-w-0 flex-1 truncate text-sm font-medium">
        {result.filename}
      </div>
      {ok && (
        <>
          <Badge variant="default">
            {FORMAT_LABEL[result.format] ?? result.format}
          </Badge>
          {result.duplicate ? (
            <Badge variant="secondary">No change (duplicate)</Badge>
          ) : (
            <span className="text-sm tabular-nums">
              {result.rowCount.toLocaleString()} rows
            </span>
          )}
        </>
      )}
      {!ok && (
        <span className="text-sm text-destructive">{result.error}</span>
      )}
    </div>
  );
}
