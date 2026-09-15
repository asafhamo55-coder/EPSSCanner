import { NextResponse, type NextRequest } from 'next/server'
import { ingestAllActive } from '@/lib/ingest'
import { publish } from '@/lib/publish'
import { buildSelection } from '@/lib/digest'
import { renderDigest } from '@/lib/email/render'
import { sendEmails, type EmailMessage } from '@/lib/email/send'
import { claimDigestDay, listConfirmed, recordDigestSend } from '@/lib/subscribers'
import { siteUrl } from '@/lib/site'
import { db } from '@/lib/db'

// The TripleQ Daily Maily.
//
//   GET            → the Vercel Cron target. Sends once per Eastern day, at 6 AM ET.
//   GET ?force=1   → bypasses the clock and the once-a-day guard, and sends ONLY
//                    to DIGEST_TEST_EMAIL. For verifying a real send.
//
// Scheduled at "0 10,11 * * *" UTC because Eastern moves: 10:00 UTC is 06:00 ET
// in summer and 11:00 UTC is 06:00 ET in winter. Both fire every day and the
// hour guard below discards the wrong one, which is how this hits 6 AM ET
// year-round from a UTC-only scheduler.
export const maxDuration = 60

const TZ = 'America/New_York'

/** The current hour (0–23) in Eastern. */
function easternHour(now: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(now),
  )
}

/** Today's Eastern calendar date as 'YYYY-MM-DD' — the idempotency key. Must be
 *  Eastern, not UTC: at 06:00 ET the UTC date is the same day, but deriving it
 *  from UTC would drift the moment the schedule or the timezone rules change. */
function easternDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return parts
}

function easternLabel(now: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now)
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

/** Is the newest valuation snapshot from today (Eastern)? The email must never
 *  be built from yesterday's numbers because the ingest cron failed.
 *
 *  `as_of` is a Postgres `date` (see 0026), so supabase-js hands back a bare
 *  'YYYY-MM-DD' string — the same shape `easternDate()` produces. Compare the
 *  strings directly. Do NOT round-trip through `new Date()`: that parses a
 *  date-only string as UTC midnight, which formats back as the PREVIOUS day in
 *  Eastern and would make today's fresh snapshot look stale every morning. */
async function snapshotIsFresh(today: string): Promise<boolean> {
  const supabase = db()
  const { data } = await supabase
    .from('screener_valuation_snapshots')
    .select('as_of')
    .order('as_of', { ascending: false })
    .limit(1)
  const asOf = (data ?? [])[0]?.as_of as string | undefined
  return asOf === today
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const force = req.nextUrl.searchParams.get('force') === '1'
  const now = new Date()
  const today = easternDate(now)

  // 1. Hour guard. Hour 7 is the late-fire recovery path: on a summer day the
  //    10:00 UTC run already sent at 06:00 ET and the day-claim below stops
  //    this one; on a winter day 10:00 UTC landed at 05:00 ET and was skipped
  //    here, so 11:00 UTC at 06:00 ET is the one that sends.
  if (!force) {
    const hour = easternHour(now)
    if (hour !== 6 && hour !== 7) {
      return NextResponse.json({ ok: true, skipped: 'off-hour', easternHour: hour })
    }
  }

  try {
    // 2. Freshness. Refresh ourselves if the ingest cron did not run or failed.
    let refreshed = 0
    if (!(await snapshotIsFresh(today))) {
      const results = await ingestAllActive()
      refreshed = results.length
      publish()
    }

    // 3. Claim the day BEFORE sending anything, so a retry cannot double-mail.
    let claimId: string | null = null
    if (!force) {
      claimId = await claimDigestDay(today)
      if (!claimId) return NextResponse.json({ ok: true, skipped: 'already-sent', sentOn: today })
    }

    // 4. Build.
    const selection = await buildSelection()
    const origin = siteUrl()
    const asOfLabel = easternLabel(now)

    // 5. Send.
    const recipients = force
      ? (() => {
          const test = process.env.DIGEST_TEST_EMAIL
          return test
            ? [{ email: test, firstName: 'there', unsubscribeToken: 'force-preview' }]
            : []
        })()
      : (await listConfirmed()).map((s) => ({
          email: s.email,
          firstName: s.firstName,
          unsubscribeToken: s.unsubscribeToken,
        }))

    const messages: EmailMessage[] = recipients.map((r) => {
      const mail = renderDigest({
        recipient: { firstName: r.firstName, unsubscribeToken: r.unsubscribeToken },
        selection,
        asOfLabel,
        siteUrl: origin,
      })
      const unsub = `${origin}/api/subscribe/unsubscribe?token=${encodeURIComponent(r.unsubscribeToken)}`
      return {
        to: r.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        headers: {
          'List-Unsubscribe': `<${unsub}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }
    })

    const report = await sendEmails(messages)

    // 6. Record.
    if (claimId) {
      await recordDigestSend(claimId, report.sent, selection.picks.length, selection.picks)
    }

    return NextResponse.json({
      ok: true,
      force,
      sentOn: today,
      refreshed,
      considered: selection.considered,
      picks: selection.picks.length,
      recipients: recipients.length,
      sent: report.sent,
      failed: report.failed,
      errors: report.errors,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 })
  }
}
