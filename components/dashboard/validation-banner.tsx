"use client";

// components/dashboard/validation-banner.tsx
//
// Session-dismissable surface for analytics-engine validation failures.
//
// Why this is the only client component on the dashboard: it needs
// useState + sessionStorage to remember a per-tab dismissal. Every other
// dashboard surface stays server-rendered.
//
// Dismiss key: a stable identifier built from each failure's
// `name + summary`, sorted. Sorting removes order sensitivity (engine
// ordering is incidental), and keying on the SUMMARY too means a check
// that's still failing but with NEW DETAILS — e.g. "member math
// reconcile" went from `delta=2` to `delta=14` — re-surfaces the banner.
// Dismissing "I see the failure" is fine; suppressing a worsening
// failure that the user hasn't actually re-acknowledged is not.
//
// Hashing instead of raw concatenation keeps the storage key bounded
// even when summaries are long.
//
// Reconciliation banners are permanent-until-resolved by design and
// MUST NOT use this component — see reconciliation-banner.tsx.

import * as React from "react";
import { CircleAlertIcon, XIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export type ValidationFailure = {
  name: string;
  /** One-line summary derived from the engine's validation `details`. */
  summary: string;
};

export type ValidationBannerProps = {
  failures: ValidationFailure[];
};

const STORAGE_PREFIX = "pulsar:validation_banner:dismissed:";

/** Tiny non-cryptographic 32-bit hash (FNV-1a). Only used to keep the
 * sessionStorage key short — collision risk is fine because the worst
 * case is "two distinct failure sets share a dismissal", which means
 * a user dismisses one and the other is also hidden. They'd see it on
 * the next page-load when the key recomputes. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Force unsigned, then base-36 for compactness.
  return (hash >>> 0).toString(36);
}

/** Stable session-storage key for a given set of failures.
 *
 * Includes BOTH the check name and a one-line summary so changed details
 * re-surface the banner even after the user previously dismissed the
 * "same" check. Sorted to remove order sensitivity. */
function dismissKey(failures: ValidationFailure[]): string {
  const fingerprint = failures
    .map((f) => `${f.name}:${f.summary}`)
    .sort()
    .join("|");
  return `${STORAGE_PREFIX}${fnv1a(fingerprint)}`;
}

export function ValidationBanner({ failures }: ValidationBannerProps) {
  // Hydration: start hidden until we know whether this exact set was
  // dismissed in this session. Avoids a flash of the banner that the
  // user already dismissed.
  const [hydrated, setHydrated] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);

  const key = React.useMemo(() => dismissKey(failures), [failures]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const flag = window.sessionStorage.getItem(key);
      setDismissed(flag === "1");
    } catch {
      // sessionStorage unavailable (private mode etc.) — show the
      // banner; non-dismissable in that environment is acceptable.
      setDismissed(false);
    }
    setHydrated(true);
  }, [key]);

  if (failures.length === 0) return null;
  if (!hydrated) return null;
  if (dismissed) return null;

  const handleDismiss = () => {
    try {
      window.sessionStorage.setItem(key, "1");
    } catch {
      // Ignore storage errors; still hide for the rest of this render.
    }
    setDismissed(true);
  };

  return (
    <Alert variant="destructive" className="relative pr-10">
      <CircleAlertIcon />
      <AlertTitle>
        {failures.length === 1
          ? "1 validation check failed"
          : `${failures.length} validation checks failed`}
      </AlertTitle>
      <AlertDescription>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {failures.map((f) => (
            <li key={f.name}>
              <span className="font-medium text-foreground">{f.name}:</span>{" "}
              {f.summary}
            </li>
          ))}
        </ul>
      </AlertDescription>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss for this session"
        onClick={handleDismiss}
        className="absolute right-2 top-2"
      >
        <XIcon />
      </Button>
    </Alert>
  );
}
