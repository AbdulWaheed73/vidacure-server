/**
 * Calendly configuration
 *
 * CALENDLY_LAUNCH_DATE: Default lower bound for fetching meetings.
 * Meetings before this date (test/dev data) will never be fetched.
 * If a user provides their own start date filter that is later than this, it takes priority.
 * If a user clears their filter, this default is applied automatically.
 */
export const CALENDLY_LAUNCH_DATE = '2026-03-28T00:00:00Z';