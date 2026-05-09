// components/dashboard/section-reconciliation-banner.tsx
//
// Server component. Section-level reconciliation banner for compound
// metrics where multiple engine values disagree with PDF counterparts
// (e.g. per-channel lead splits: Web / Walk-in / Total).
//
// Sibling to `reconciliation-banner.tsx`, intentionally separate:
//   * The tile-level ReconciliationBanner is a compact `text-xs` Alert
//     mounted inside a tile's sideSlot, scoped to a single scalar gap.
//   * This component sits between a section title and its tile grid,
//     summarizing several values + a cascade-explanation line, and is
//     visually distinct so the user reads "this is about the section,
//     not one tile".
// Forcing both shapes into one component made the JSX hard to follow
// (conditional layouts, optional cascade copy, scalar-vs-record value
// branching). Two small components is cleaner than one branchy one.
//
// Permanent-until-resolved: NOT user-dismissable. Like its sibling.
//
// Reads pure data from props — engine and pdf values keyed by the same
// internal keys (e.g. "web_leads"), plus a parallel label map so the
// banner can render display labels without hardcoding "Web Leads" copy.
// Both maps come from MetricsPack metadata (e.g.
// `pack.lead_generation.internal` + `pack.lead_generation.pdf_values`)
// or the gym config's display_labels block.

import { InfoIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export type SectionReconciliationBannerProps = {
  /** Headline copy. Short — fits on one line. */
  title: string;
  /** Engine-derived values keyed by internal key (e.g. "web_leads"). */
  engineValues: Record<string, number>;
  /** Report/PDF-side counterpart values keyed by the same internal keys. */
  pdfValues: Record<string, number>;
  /** Display labels keyed by the same internal keys. Allows the banner
   * to print "Web Leads" instead of "web_leads" without hardcoding the
   * label here. Missing entries fall back to the key itself. */
  labels?: Record<string, string>;
  /** Order of keys to render. Defaults to Object.keys(engineValues). */
  order?: string[];
  /** Optional cascade-explanation line — e.g. "Downstream metrics —
   * sales by channel, conversion ratios, velocity — inherit this
   * variance." Rendered as a second body line when provided. */
  cascadeNote?: string;
  /** Optional absolute URL to a reconciliation note (e.g. a GitHub
   * blob). MUST be absolute — relative hrefs resolve against the
   * current route and 404 from /dashboard. */
  docHref?: string;
};

function formatEntry(
  key: string,
  value: number,
  labels: Record<string, string> | undefined,
): string {
  const label = labels?.[key] ?? key;
  return `${label} ${value}`;
}

export function SectionReconciliationBanner({
  title,
  engineValues,
  pdfValues,
  labels,
  order,
  cascadeNote,
  docHref,
}: SectionReconciliationBannerProps) {
  const keys = order ?? Object.keys(engineValues);
  const enginePart = keys.map((k) => formatEntry(k, engineValues[k], labels)).join(", ");
  const pdfPart = keys.map((k) => formatEntry(k, pdfValues[k], labels)).join(", ");

  return (
    <Alert>
      <InfoIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="space-y-1">
        <div>
          <span className="font-medium text-foreground">Engine:</span>{" "}
          {enginePart}.{" "}
          <span className="font-medium text-foreground">Report:</span>{" "}
          {pdfPart}.
        </div>
        {cascadeNote ? <div>{cascadeNote}</div> : null}
        {docHref ? (
          <div>
            <a
              href={docHref}
              className="underline"
              target="_blank"
              rel="noreferrer"
            >
              see reconciliation notes
            </a>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
