// lib/analytics/modules/registry.ts
//
// Resolver for Level-3 attribution modules. The gym's config names a
// module by string (e.g. "attribution_powerhouse_nyc"); the engine looks
// it up here. Adding a new gym's custom module = adding one entry below
// and writing the module file. No engine code changes.

import type { AttributionModule } from "../types";
import attribution_powerhouse_nyc from "./attribution_powerhouse_nyc";

const MODULES: Record<string, AttributionModule> = {
  attribution_powerhouse_nyc,
};

/** Returns the named module, or null if no name was registered (a
 * second-gym config can leave channel_attribution.*_module = null and
 * fall back to the default identity-style attribution in channels.ts). */
export function getAttributionModule(name: string | null): AttributionModule | null {
  if (!name) return null;
  const m = MODULES[name];
  if (!m) {
    throw new Error(
      `Attribution module "${name}" is not registered. Add it to lib/analytics/modules/registry.ts.`,
    );
  }
  return m;
}
