// lib/db/index.ts
//
// Barrel re-export for the db helpers. Import from "@/lib/db" in app code.
//
// Convention reminder: every helper here takes `(client, gymId, ...rest)`.
// gymId is non-optional. RLS provides a hard floor; the explicit gym_id arg
// is defense in depth and makes cross-gym leaks obvious in code review.

export type { DbClient } from "./client";
export {
  createServerDbClient,
  createServiceRoleDbClient,
} from "./client";

export type { Database, Json } from "./types";

// Tenancy
export * as gyms from "./gyms";
export * as gymConfigs from "./gym_configs";
export * as gymMembers from "./gym_members";

// Domain
export * as leads from "./leads";
export * as sales from "./sales";
export * as members from "./members";
export * as rfcEntries from "./rfc_entries";
export * as cancellations from "./cancellations";
export * as promoWindows from "./promo_windows";

// Operational
export * as importHistory from "./import_history";
export * as validationRuns from "./validation_runs";
