/**
 * Add `months` calendar months to a date, clamping the day to the end of the
 * target month when needed (e.g. Jan 31 + 1 month → Feb 28/29, not Mar 3).
 * Used by the drip scheduler so monthly cadence stays on calendar boundaries.
 */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // If the day rolled over into the next month, snap back to the last day.
  if (d.getDate() < day) {
    d.setDate(0);
  }
  return d;
}

/** Subtract `days` days from a date (returns a new Date). */
export function subtractDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

/** Start of the UTC calendar day (00:00:00.000 UTC) for the given date. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Format a date as YYYY-MM-DD in UTC (used for Athena `dt=` partitions). */
export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
