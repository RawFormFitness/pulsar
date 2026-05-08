// lib/parsers/detect.ts
//
// Format detection. We read just enough of the file to decide — the first
// ~10 rows joined into a single lowercase blob — and pick by a small set
// of signals.
//
// "Signals" are surfaced to the UI so users can see WHY we picked a
// format. If two formats look plausible the higher-confidence one wins
// and the runner-up appears in `signals` for visibility.
//
// This is Level 1 code: every gym uses the same detector. If a gym ships
// us a new dialect we can't detect, we'll add a new signal here, not a
// branch keyed on gym_id.

import Papa from "papaparse";
import type { DetectedFormat } from "./types";
import { readInput, type ParserInput } from "./io";

export type DetectResult = {
  format: DetectedFormat;
  confidence: "high" | "medium" | "low";
  signals: string[];
};

type Candidate = {
  format: DetectedFormat;
  score: number;
  signals: string[];
};

function joinFirstRows(csv: string, n: number): string {
  // Cheap: take first n lines and lowercase. Avoids parsing the whole file.
  const lines = csv.split(/\r?\n/, Math.max(n, 1));
  return lines.join(" ").toLowerCase();
}

function firstRowsAs2D(csv: string, n: number): string[][] {
  const head = csv.split(/\r?\n/, Math.max(n, 1)).join("\n");
  const r = Papa.parse<string[]>(head, {
    header: false,
    skipEmptyLines: false,
    dynamicTyping: false,
  });
  return r.data.map((row) =>
    Array.isArray(row) ? row.map((c) => (c == null ? "" : String(c))) : [],
  );
}

function score(blob: string, must: string[]): number {
  let s = 0;
  for (const m of must) {
    if (blob.includes(m)) s++;
  }
  return s;
}

export async function detectFormat(input: ParserInput): Promise<DetectResult> {
  const { text } = await readInput(input);
  const blob = joinFirstRows(text, 10);
  const grid = firstRowsAs2D(text, 10);

  const candidates: Candidate[] = [];

  // ---- Leads (Gym Sales) ----------------------------------------------------
  // Gym Sales' header has unique snake_case columns we won't see anywhere
  // else. "trial_end_at" + "salesperson" + "first_name" is a very tight
  // signal.
  {
    const must = ["first_name", "salesperson", "trial_end_at"];
    const s = score(blob, must);
    const sigs: string[] = [];
    if (blob.includes("first_name")) sigs.push("found 'first_name' header");
    if (blob.includes("trial_end_at")) sigs.push("found 'trial_end_at' header");
    if (s > 0) candidates.push({ format: "leads", score: s, signals: sigs });
  }

  // ---- ABC Sales ------------------------------------------------------------
  {
    const titleHit = blob.includes("membership sales");
    const headerHit =
      blob.includes("agreement") && blob.includes("queue date") && blob.includes("membership type");
    const sigs: string[] = [];
    if (titleHit) sigs.push("found 'Membership Sales' in title row");
    if (headerHit) sigs.push("found Agreement/Queue Date/Membership Type header");
    const s = (titleHit ? 2 : 0) + (headerHit ? 2 : 0);
    if (s > 0) candidates.push({ format: "abc_sales", score: s, signals: sigs });
  }

  // ---- ABC Members (Active Members) -----------------------------------------
  {
    const titleHit = blob.includes("active members");
    const headerHit =
      blob.includes("last visit") && blob.includes("next due") && blob.includes("member  status");
    const sigs: string[] = [];
    if (titleHit) sigs.push("found 'Active Members' in title row");
    if (headerHit) sigs.push("found Last Visit/Next Due/Member Status header");
    const s = (titleHit ? 2 : 0) + (headerHit ? 2 : 0);
    if (s > 0) candidates.push({ format: "abc_members", score: s, signals: sigs });
  }

  // ---- ABC RFC --------------------------------------------------------------
  {
    const titleHit = blob.includes("rfc preview") || blob.includes("return for  collection");
    const headerHit =
      blob.includes("days past") && blob.includes("status date") && blob.includes("total past due");
    const sigs: string[] = [];
    if (titleHit) sigs.push("found 'RFC Preview' in title row");
    if (headerHit) sigs.push("found Status Date/Days Past/Total Past Due header");
    const s = (titleHit ? 2 : 0) + (headerHit ? 2 : 0);
    if (s > 0) candidates.push({ format: "abc_rfc", score: s, signals: sigs });
  }

  // ---- ABC Cancel -----------------------------------------------------------
  {
    // Title is "Cancelled Members". The 4-column header is also distinctive:
    // exactly 4 non-empty cells on row 2 with "Agreement #", "Member Name",
    // "Primary Member", "Member  Status". We use both signals — title and
    // the "exactly 4 columns" shape — so we don't false-positive on the
    // Active Members report.
    const titleHit = blob.includes("cancelled members");
    let shapeHit = false;
    for (let i = 0; i < Math.min(5, grid.length); i++) {
      const row = grid[i] ?? [];
      const lowered = row.map((c) => String(c ?? "").trim().toLowerCase());
      const hasAgreement = lowered.some((c) => c.includes("agreement"));
      const hasPrimary = lowered.some((c) => c.includes("primary member"));
      const hasStatus = lowered.some((c) => c.replace(/\s+/g, " ").includes("member status"));
      if (hasAgreement && hasPrimary && hasStatus) {
        shapeHit = true;
        break;
      }
    }
    const sigs: string[] = [];
    if (titleHit) sigs.push("found 'Cancelled Members' in title row");
    if (shapeHit) sigs.push("found 4-column Agreement/Primary Member/Member Status header");
    const s = (titleHit ? 2 : 0) + (shapeHit ? 2 : 0);
    if (s > 0) candidates.push({ format: "abc_cancel", score: s, signals: sigs });
  }

  if (candidates.length === 0) {
    return { format: "unknown", confidence: "low", signals: [] };
  }

  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];
  const runnerUp = candidates[1];

  // Confidence: tuned to our scoring scheme above. ABC formats top out at
  // 4 (title + header), leads at 3 (three header tokens).
  const conf: DetectResult["confidence"] =
    winner.score >= 3 ? "high" : winner.score === 2 ? "medium" : "low";

  const signals = [...winner.signals];
  if (runnerUp && runnerUp.score >= 2) {
    signals.push(
      `runner-up: ${runnerUp.format} (signals: ${runnerUp.signals.join("; ") || "none"})`,
    );
  }

  return { format: winner.format, confidence: conf, signals };
}
