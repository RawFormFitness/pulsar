// components/dashboard/reconciliation-banner.tsx
//
// Server component. Surfaces a documented engine-vs-PDF reconciliation
// variance alongside the affected metric tile.
//
// Reads pure data from props — engineValue, pdfValue, label, docHref —
// all of which come from MetricsPack metadata (e.g.
// `pack.losses.pending_cancel_pdf_value`) or the gym config. We never
// hardcode a specific gym's variance copy here. If a future variance
// ships, the page wires another instance of this component pointing at
// whatever pack field carries the gap.
//
// Permanent-until-resolved: this banner is NOT user-dismissable. The
// dismissable variant is `validation-banner.tsx`.

import { InfoIcon } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";

export type ReconciliationBannerProps = {
  /** Short label for the metric this banner belongs to (e.g. "Pending Cancel"). */
  label: string;
  /** Engine-derived value for this period. */
  engineValue: number | string;
  /** Report/PDF-side counterpart value the engine disagrees with. */
  pdfValue: number | string;
  /** Optional absolute URL to a reconciliation note (e.g. a GitHub blob).
   * MUST be absolute — relative hrefs resolve against the current route
   * and 404 from /dashboard. */
  docHref?: string;
};

export function ReconciliationBanner({
  label,
  engineValue,
  pdfValue,
  docHref,
}: ReconciliationBannerProps) {
  return (
    <Alert className="text-xs">
      <InfoIcon />
      <AlertDescription>
        <span className="font-medium text-foreground">{label}:</span>{" "}
        engine {engineValue} / report {pdfValue}
        {docHref ? (
          <>
            {" "}
            —{" "}
            <a href={docHref} className="underline" target="_blank" rel="noreferrer">
              see reconciliation notes
            </a>
          </>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
