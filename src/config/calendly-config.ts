/**
 * Calendly configuration
 *
 * CALENDLY_LAUNCH_DATE: Default lower bound for fetching meetings.
 * Meetings before this date (test/dev data) will never be fetched.
 * If a user provides their own start date filter that is later than this, it takes priority.
 * If a user clears their filter, this default is applied automatically.
 *
 * NOTE: The `.000000Z` microsecond precision is intentional and required.
 * Calendly's List Events endpoint accepts timestamps without fractional
 * seconds on the FIRST page, but rejects subsequent paginated calls (page_token)
 * with a 400 "The supplied parameters are invalid" unless timestamps include
 * microsecond precision. Documented Calendly quirk — don't strip the zeros.
 */
export const CALENDLY_LAUNCH_DATE = '2026-03-28T00:00:00.000000Z';