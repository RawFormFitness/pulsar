// lib/analytics/period.ts
//
// Period boundary arithmetic. We treat months as half-open [start, end) in
// the gym's IANA timezone. The DB stores timestamps as `timestamptz`
// (always UTC); the engine's job is to translate "April 2026 in
// America/New_York" into the matching UTC instants.
//
// Why this looks heavier than `new Date(2026, 3, 1)`: that constructor
// honors the host machine's offset, which is unsafe — we'd compute the
// wrong UTC instant for any gym not in the host TZ. Instead we ask
// Intl.DateTimeFormat what offset the target zone applies on the period
// boundary, then back into the UTC instant.

import type { Period } from "./types";

/** "2026-04" -> { year:2026, month:3 }. Month is 0-indexed (Date convention). */
function parseMonthKey(key: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) throw new Error(`Invalid period key: ${key}`);
  return { year: Number(m[1]), month: Number(m[2]) - 1 };
}

/** Returns the offset, in minutes east of UTC, of `t` as observed in `tz`.
 * Positive for zones east of UTC (e.g. +330 for IST), negative for west
 * (e.g. -240 for EDT). */
function tzOffsetMinutes(t: Date, tz: string): number {
  // Format the timestamp as a wall-clock string in the target zone, then
  // re-interpret that wall clock as UTC and diff against the original.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(t)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  // Intl returns hour=24 at midnight on some engines — normalize.
  const hour = parts.hour === 24 ? 0 : parts.hour;
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    hour,
    parts.minute,
    parts.second,
  );
  return Math.round((asUtc - t.getTime()) / 60_000);
}

/** Convert a wall-clock instant in `tz` to its UTC Date. */
function wallClockInZoneToUtc(
  year: number,
  month: number, // 0-indexed
  day: number,
  hour: number,
  minute: number,
  second: number,
  tz: string,
): Date {
  // First approximation: treat the wall clock as if it were UTC, then
  // correct by the offset that zone applies at that instant. One pass is
  // enough except across DST transitions, where the corrected timestamp
  // can fall in a different offset; we re-correct using the offset
  // observed at the corrected instant.
  const guess = new Date(Date.UTC(year, month, day, hour, minute, second));
  const off1 = tzOffsetMinutes(guess, tz);
  const corrected = new Date(guess.getTime() - off1 * 60_000);
  const off2 = tzOffsetMinutes(corrected, tz);
  if (off1 === off2) return corrected;
  return new Date(guess.getTime() - off2 * 60_000);
}

/**
 * Build a calendar-month period in `timezone`. April 2026 in
 * America/New_York becomes 2026-04-01 00:00:00 ET .. 2026-05-01 00:00:00 ET
 * (exclusive end), expressed as UTC instants.
 */
export function calendarMonthPeriod(monthKey: string, timezone: string): Period {
  const { year, month } = parseMonthKey(monthKey);
  const start = wallClockInZoneToUtc(year, month, 1, 0, 0, 0, timezone);
  // Adding one month — handle Dec -> Jan rollover.
  const nextYear = month === 11 ? year + 1 : year;
  const nextMonth = month === 11 ? 0 : month + 1;
  const end = wallClockInZoneToUtc(nextYear, nextMonth, 1, 0, 0, 0, timezone);
  return { key: monthKey, start, end, timezone };
}

/**
 * Returns the calendar date (YYYY-MM-DD) of `t` as observed in `tz`. Used
 * when comparing `waiver_signed_date` (a date string in source data) to
 * the period bounds: we lift the period bounds into the same calendar.
 */
export function localDateString(t: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA produces YYYY-MM-DD natively.
  return fmt.format(t);
}

/** True if `iso` is a UTC ISO timestamp inside [period.start, period.end). */
export function isInPeriod(iso: string | null | undefined, period: Period): boolean {
  if (!iso) return false;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return false;
  return ms >= period.start.getTime() && ms < period.end.getTime();
}

/** True if a YYYY-MM-DD calendar date falls inside the period (using the
 * gym timezone's local-date interpretation of the period bounds). */
export function isLocalDateInPeriod(
  ymd: string | null | undefined,
  period: Period,
): boolean {
  if (!ymd) return false;
  const startYmd = localDateString(period.start, period.timezone);
  // period.end is exclusive — derive its local date and compare strictly.
  const endYmd = localDateString(period.end, period.timezone);
  return ymd >= startYmd && ymd < endYmd;
}
