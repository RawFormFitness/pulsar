// lib/analytics/index.ts
//
// Public surface of the analytics engine. Importers should reach for
// `runAnalytics` and the `EngineInput`/`AnalyticsOutput` types; everything
// else is internal plumbing exposed here for tests.

export { runAnalytics } from "./run";
export type {
  AnalyticsOutput,
  ConversionEntry,
  EngineInput,
  GymConfig,
  Period,
  ValidationResult,
} from "./types";
export { calendarMonthPeriod, localDateString } from "./period";
export { getAttributionModule } from "./modules/registry";
