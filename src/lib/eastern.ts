// Shared Eastern-time helpers. Both cron routes (/api/ingest, /api/digest)
// need to agree on what calendar day "today" is — the ingest route's
// preparation phase writes a row keyed on it, and the digest route reads that
// row back by the same key. A single source of truth means the two cannot
// drift into disagreeing about the date.

const TZ = 'America/New_York'

/** Today's Eastern calendar date as 'YYYY-MM-DD'. Must be Eastern, not UTC:
 *  at 06:00 ET the UTC date is the same day, but deriving it from UTC would
 *  drift the moment the schedule or the timezone rules change.
 *
 *  `en-CA` is deliberate — it yields YYYY-MM-DD directly; `en-US` does not. */
export function easternDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
