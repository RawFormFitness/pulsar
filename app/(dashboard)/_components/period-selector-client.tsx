"use client";

// app/(dashboard)/_components/period-selector-client.tsx
//
// Thin client wrapper around <PeriodSelector />. The selector is rendered
// in the home page header but is intentionally NOT wired to any data
// fetching in Task 1 — Task 3 will replace this onChange with a real
// router.replace / search-param update once the analytics-engine consumer
// exists.
//
// Keeping the wrapper here (vs. inside the home page server component)
// means the home page stays a clean server component.

import * as React from "react";
import {
  PeriodSelector,
  monthToDate,
  type Period,
} from "@/components/period-selector";

export function PeriodSelectorClient() {
  const [period, setPeriod] = React.useState<Period>(() => monthToDate());
  return <PeriodSelector value={period} onChange={setPeriod} />;
}
