// lib/analytics/velocity.ts
//
// Cumulative pipeline-velocity buckets. Buckets and labels come from
// config (Level 2). The CUMULATIVE shape — each label = sum of itself
// plus all prior buckets in declared order — is universal Level-1.
//
// Sales without a matched prior lead get bucketed per the config's
// no_lead_match_bucket (Powerhouse: same_day). Sales with after-sale
// fallback matches (negative or zero days) likewise fall in the
// earliest bucket. The validation invariant is that the final cumulative
// bucket (within_31_plus for Powerhouse) equals the total sale count
// per channel.

import type { ClassifiedSale, GymConfig, VelocityChannelCounts } from "./types";

/**
 * Returns the bucket key for a (possibly null) days_to_close, using the
 * configured bucket definitions. min_days/max_days are inclusive; the
 * "no lead match" config key handles unmatched sales.
 */
function bucketForDays(
  days: number | null,
  config: GymConfig,
): string {
  const buckets = config.velocity_buckets.buckets;
  if (days === null) return config.velocity_buckets.no_lead_match_bucket;
  for (const b of buckets) {
    const minOk = b.min_days === null ? true : days >= b.min_days;
    const maxOk = b.max_days === null ? true : days <= b.max_days;
    if (minOk && maxOk) return b.key;
  }
  // If the buckets don't cover negatives (Powerhouse: same_day matches days<=0
  // since min_days=null and max_days=0 — handled above). If we somehow miss,
  // fall back to the first bucket key.
  return buckets[0]?.key ?? "unbucketed";
}

/**
 * Compute per-channel cumulative velocity counts for the configured
 * report channels. Returns one entry per channel plus a "total" entry.
 */
export function computeVelocity(
  classifiedSales: ClassifiedSale[],
  config: GymConfig,
): Record<string, VelocityChannelCounts> {
  const buckets = config.velocity_buckets.buckets;
  const channels = config.velocity_buckets.report_channels;

  // Initialize zeroed non-cumulative counters per channel.
  const raw: Record<string, Record<string, number>> = {};
  for (const ch of channels) {
    raw[ch] = {};
    for (const b of buckets) raw[ch][b.key] = 0;
  }

  for (const cs of classifiedSales) {
    const bk = bucketForDays(cs.days_to_close, config);
    if (raw[cs.channel]) raw[cs.channel][bk]++;
    if (raw["total"]) raw["total"][bk]++;
  }

  // Cumulative pass — each bucket key gets sum of itself + all earlier ones.
  const out: Record<string, VelocityChannelCounts> = {};
  for (const ch of channels) {
    const cumulative: Record<string, number> = {};
    let running = 0;
    for (const b of buckets) {
      running += raw[ch]?.[b.key] ?? 0;
      cumulative[b.key] = running;
    }
    out[ch] = { buckets: cumulative, total: running };
  }
  return out;
}
