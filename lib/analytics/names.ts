// lib/analytics/names.ts
//
// Universal name normalization for sale-to-lead matching. Powerhouse's
// rules — the ones in name_normalization in config — happen to be the
// same shape every gym uses (lower-case, drop apostrophes, hyphen->space,
// keep first-name's first token only). Per-gym variation will be folded
// in via config flags when a future gym's normalization actually differs.

/** Lower-case, strip apostrophes, hyphen->space, collapse whitespace. */
function applyCommonRules(s: string): string {
  return s
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize a lead's first/last into a single matchable string.
 * Produces "first last", keeping only the first token of first-name (e.g.
 * "John David Smith" -> "john smith") to align with sale-side parsing of
 * ABC's "Last, First Middle" format.
 */
export function normalizeLeadName(
  first: string | null | undefined,
  last: string | null | undefined,
): string {
  const f = applyCommonRules(first ?? "");
  const l = applyCommonRules(last ?? "");
  const firstTok = f.split(" ")[0] ?? "";
  return `${firstTok} ${l}`.trim();
}

/**
 * Normalize an ABC sale's "Last, First Middle" name string for matching
 * against normalized lead names.
 */
export function normalizeSaleName(memberName: string | null | undefined): string {
  if (!memberName) return "";
  const cleaned = applyCommonRules(memberName);
  // ABC writes "last, first middle". Split on the comma; if no comma,
  // assume "first last" already.
  const idx = cleaned.indexOf(",");
  if (idx === -1) {
    const parts = cleaned.split(" ");
    if (parts.length === 0) return "";
    return `${parts[0]} ${parts.slice(1).join(" ")}`.trim();
  }
  const last = cleaned.slice(0, idx).trim();
  const rest = cleaned.slice(idx + 1).trim();
  const firstTok = rest.split(" ")[0] ?? "";
  return `${firstTok} ${last}`.trim();
}

/**
 * Free-form member-name normalization (used by the cancel ledger, which
 * has both "Last, First M" and "First Last" rows). Mirrors the lead/sale
 * shape so output strings line up.
 */
export function normalizeFreeFormName(s: string | null | undefined): string {
  if (!s) return "";
  const cleaned = applyCommonRules(s);
  if (cleaned.includes(",")) return normalizeSaleName(s);
  const parts = cleaned.split(" ");
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  // Keep first + last token as the comparable name.
  return `${parts[0]} ${parts[parts.length - 1]}`.trim();
}
