/**
 * Time duration constants (in milliseconds)
 *
 * Avoids magic numbers like `24 * 60 * 60 * 1000` scattered across the codebase.
 */

export const ONE_MINUTE_MS = 60 * 1000;
export const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
export const ONE_DAY_MS = 24 * ONE_HOUR_MS;
export const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;

/** How long a draft lab test order lives before MongoDB TTL auto-deletes it */
export const DRAFT_ORDER_TTL_MS = ONE_DAY_MS;
