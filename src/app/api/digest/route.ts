import { NextResponse, type NextRequest } from 'next/server'
import { ingestAllActive } from '@/lib/ingest'
import { publish } from '@/lib/publish'
import { buildSelection, readPrep } from '@/lib/digest'
import type { ScoredPick, Selection } from '@/lib/score'
import { toDigestPickRecord } from '@/lib/score'
import { renderDigest, type DigestData, type DigestSelection } from '@/lib/email/render'
import { buildMarketRead, type Commentary } from '@/lib/market-read'
import { getIndices, type IndexCardData } from '@/market-data/indices'
import { sendEmails, type EmailMessage } from '@/lib/email/send'
import {
  claimDigestDay,
  digestSentOn,
  listConfirmed,
  recordDigestSend,
  releaseDigestDay,
} from '@/lib/subscribers'
import { siteUrl } from '@/lib/site'
import { db } from '@/lib/db'
import { easternDate } from '@/lib/eastern'
import { resolveTemplateOverride } from './resolve-template'

// The TripleQ Daily Maily.
//
//   GET            → the Vercel Cron target. Sends once per Eastern day, at 6 AM ET.
//   GET ?force=1   → bypasses the clock and the once-a-day guard, and sends ONLY
//                    to DIGEST_TEST_EMAIL. For verifying a real send.
//
// Scheduled at "0 11 * * *" UTC — a SINGLE daily fire, because this project is
// on a Vercel Hobby plan, which rejects any cron expression that would run more
// than once a day. Eastern moves, so one fixed UTC hour cannot be 06:00 ET all
// year: 11:00 UTC is 07:00 ET in summer (EDT) and 06:00 ET in winter (EST).
//
// 11:00 was chosen over 10:00 deliberately. At 10:00 UTC the winter fire lands
// at 05:00 ET, which the hour guard below rejects — the digest would silently
// stop sending for the four months of EST and nobody would be paged. At 11:00
// both seasons land inside the guard's 6-or-7 window, so a send happens every
// day of the year. The cost is that summer delivery is 07:00 ET rather than
// 06:00 — still comfortably before the 09:30 open.
//
// On a Pro plan, restore "0 10,11 * * *": both hours fire, the correct one
// sends, and the day-claim below discards the other. That yields exactly 06:00
// ET year-round.
export const maxDuration = 60

const TZ = 'America/New_York'

/** The current hour (0–23) in Eastern. */
function easternHour(now: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(now),
  )
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

/** Fails CLOSED, unlike /api/ingest's identically-named helper: this route runs
 *  ingestAllActive() over the whole watchlist and a real Resend send, and its
 *  JSON response leaks the subscriber count. /api/ingest spends no money and
 *  sends no mail, so it can stay open when CRON_SECRET is unset — this one
 *  cannot, because CRON_SECRET is not currently set on the live Vercel
 *  project and an open digest endpoint is an open "mail everyone" button. */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

/** Is the newest valuation snapshot from today (Eastern)? The email must never
 *  be built from yesterday's numbers because the ingest cron failed.
 *
 *  `as_of` is a Postgres `date` (see 0026), so supabase-js hands back a bare
 *  'YYYY-MM-DD' string — the same shape `easternDate()` produces. Compare the
 *  strings directly. Do NOT round-trip through `new Date()`: that parses a
 *  date-only string as UTC midnight, which formats back as the PREVIOUS day in
 *  Eastern and would make today's fresh snapshot look stale every morning.
 *
 *  Known subtlety, left as-is: `as_of` is written as a UTC calendar date, not
 *  an Eastern one, so this string comparison against `today` (Eastern) is
 *  only correct while the cron runs inside the 10:00–11:59 UTC window (as it
 *  does today) — a schedule change that moved the run outside that window
 *  could make a same-day snapshot compare unequal. */
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

  // Never claim a day we cannot send: without RESEND_API_KEY, sendEmails() is a
  // no-op (see src/lib/email/send.ts), so claiming today's row here would burn
  // the UNIQUE sent_on slot on a send that provably never happened, making the
  // day permanently unsendable once the key is added.
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ ok: true, skipped: 'no-api-key' })
  }

  const force = req.nextUrl.searchParams.get('force') === '1'
  // `template=v2` previews the v2 renderer for THIS request only, without
  // touching DIGEST_TEMPLATE — see renderDigest's doc comment in
  // src/lib/email/render.ts for why that parameter exists at all. Honoured
  // ONLY when `force` is also set: without that gate, `?template=v2` alone
  // would let anyone redirect a REAL send (to the real subscriber list) to
  // the unreviewed template, which is exactly the accidental-exposure risk
  // this whole mechanism exists to avoid. `force` already redirects delivery
  // to DIGEST_TEST_EMAIL, so pairing the two is what makes "preview v2
  // safely" possible — see resolveTemplateOverride's own tests.
  const templateOverride = resolveTemplateOverride(force, req.nextUrl.searchParams.get('template'))
  // `now=1` waives ONLY the clock guard: the real subscriber list, the day
  // claim and the recorded send all behave exactly as on a cron run. It exists
  // because a missed or failed cron would otherwise have no recovery path —
  // the next eligible fire is 24 hours away, and by then the picks are stale.
  //
  // It is safe to expose because it does not waive the thing that actually
  // matters: `claimDigestDay` still runs, so a second call the same Eastern day
  // is refused whether it came from a human, a retry or the cron. The clock
  // guard decides WHEN the digest may go out; the claim decides HOW OFTEN. Only
  // the former is waived here.
  //
  // `force=1` is the opposite trade and must not be confused with it: force
  // waives the clock AND the claim, but redirects delivery to DIGEST_TEST_EMAIL
  // so the list is never touched. force is for testing; now is for sending.
  const sendNow = req.nextUrl.searchParams.get('now') === '1'
  const now = new Date()
  const today = easternDate(now)

  // `status=1` reports what a run WOULD do and returns before anything is
  // claimed, sent or recorded. It exists because every other path through this
  // route mails people: a bare GET inside the 6-7 window is indistinguishable
  // from a cron fire and will send, which is genuinely surprising to anyone
  // treating it as an inspection endpoint — it has now caused two accidental
  // sends. A read-only mode is the fix; remembering to append `?force=1` is
  // not. Placed FIRST so no guard, claim or ingest can run ahead of it.
  if (req.nextUrl.searchParams.get('status') === '1') {
    const [selection, confirmed, prep] = await Promise.all([
      buildSelection().catch((e) => ({ error: (e as Error).message })),
      listConfirmed().then((s) => s.length).catch(() => null),
      // Read-only, so it can answer "is tomorrow's email going to have
      // charts?" without sending anything. Never throws (see readPrep).
      readPrep(today),
    ])
    const already = await digestSentOn(today).catch(() => null)
    return NextResponse.json({
      ok: true,
      mode: 'status',
      easternDate: today,
      easternHour: easternHour(now),
      inSendWindow: [6, 7].includes(easternHour(now)),
      alreadySentToday: already,
      confirmedSubscribers: confirmed,
      picks: 'error' in (selection as object) ? null : (selection as Selection).picks.length,
      considered: 'error' in (selection as object) ? null : (selection as Selection).considered,
      wouldSendTo: confirmed,
      // What a real send would actually use: the prepared row if one exists
      // for today, or the inline `selection` above as a fallback. See the
      // "prep" vs "inline" path in the send branch below.
      prep: prep
        ? {
            present: true,
            picks: prep.picks.length,
            chartsRendered: prep.chartCount,
            commentaryPresent: prep.readOk && prep.marketRead != null,
          }
        : { present: false },
    })
  }

  // 1. Hour guard. Accepts Eastern hour 6 OR 7, which on the current single
  //    11:00 UTC schedule means summer (07:00 ET) and winter (06:00 ET) both
  //    pass. The window is deliberately two hours wide rather than pinned to 6:
  //    it absorbs DST without code changes, tolerates a late-firing cron, and
  //    keeps the Pro two-fire schedule working unchanged if this ever upgrades.
  //    Sending twice is prevented by the day-claim below, not by this guard.
  if (!force && !sendNow) {
    const hour = easternHour(now)
    if (hour !== 6 && hour !== 7) {
      return NextResponse.json({ ok: true, skipped: 'off-hour', easternHour: hour })
    }
  }

  try {
    // 2. Freshness. Refresh ourselves if the ingest cron did not run or failed.
    let refreshed = 0
    let didIngest = false
    if (!(await snapshotIsFresh(today))) {
      const run = await ingestAllActive()
      refreshed = run.results.length
      didIngest = true
      // publish() is deliberately NOT called here — see step 4.
    }

    // 3. Claim the day BEFORE sending anything, so a retry cannot double-mail.
    let claimId: string | null = null
    if (!force) {
      claimId = await claimDigestDay(today)
      if (!claimId) return NextResponse.json({ ok: true, skipped: 'already-sent', sentOn: today })
    }

    // 4–6. Build, send, record. Tracked with its own try/catch: a failure
    // here after the day was claimed above must release the claim so the
    // digest can be retried — UNLESS the send has already started, because
    // releasing after even a partial send would let a retry double-mail
    // whoever already received it.
    let sendStarted = false
    try {
      // 4. Build.
      //
      // Normal path: the 09:30 UTC ingest cron already scored the watchlist,
      // rendered a chart per pick and composed the market read, and left the
      // result in screener_digest_prep — read it instead of repeating any of
      // that work here. `readPrep` scopes its query to `today`, so a row
      // only comes back if it was prepared for THIS Eastern date; a row from
      // an earlier date (preparation never ran today, or the ingest cron
      // failed) simply isn't returned.
      //
      // Fallback path: no row for today — score inline exactly as v1 did.
      // No charts, but the market read is composed here too (see below) and
      // the digest still goes out. This is the
      // expected state on the first deploy, after a failed ingest, or any
      // day the screener_digest_prep migration hasn't been applied yet — NOT
      // an error.
      //
      // `readPrep`'s picks are `toDigestPickRecord` projections with
      // `chartUrl` attached (see src/lib/digest.ts) — as of Task 7's fix
      // round 1 that projection carries `reasons`/`positionPct`/
      // `retracement`/`yoyState`/`ntmState` too, so the prepared path
      // renders the real reason text and the real signal-state chip colour,
      // not a degraded fallback. What it still does NOT carry: `gates`,
      // `passedGates`, and `input` itself beyond the two states pulled out
      // above (in particular `input.technicals` — exactly the ~27KB-per-pick
      // payload this projection exists to keep out of a jsonb column).
      // `considered`/`belowCutoff` come from the prep row's own columns
      // (migration 0031) and are null for a row written before that
      // migration — `renderDigest`'s `DigestSelection` type and `card()`
      // both know how to degrade for a null denominator — see
      // src/lib/email/render.ts.
      const prep = await readPrep(today).catch((e) => {
        console.error(`[digest] prep read threw: ${(e as Error).message}`)
        return null
      })
      const usingPrep = prep != null
      let selection: DigestSelection
      let pickRecords: unknown
      let commentary: Commentary | null = null
      // Held for the fallback path only: buildMarketRead needs the full
      // ScoredPick objects, and the indices it also needs are not fetched
      // until after this block. On the prepared path the read was already
      // composed during preparation and read back off the row.
      let inlinePicks: ScoredPick[] | null = null
      if (usingPrep && prep) {
        selection = { picks: prep.picks, considered: prep.considered, belowCutoff: prep.belowCutoff }
        pickRecords = prep.picks
        commentary = prep.marketRead != null ? { marketRead: prep.marketRead, perStock: prep.perStock } : null
        console.log(
          `[digest] ${today}: sending from the prepared row — ${prep.picks.length} pick(s), ` +
            `${prep.chartCount} chart(s), commentary ${commentary ? 'present' : 'absent'}`,
        )
      } else {
        const built = await buildSelection()
        selection = built
        pickRecords = built.picks.map(toDigestPickRecord)
        inlinePicks = built.picks
        console.log(`[digest] ${today}: no prepared row — scoring inline (no charts)`)
      }
      // publish() invalidates the 'yahoo-live' cache tag (SMA/ATH/PEG/technicals)
      // that buildSelection() reads on the fallback path above. Calling it
      // BEFORE the build (as this route used to) would make this same
      // request pay to repopulate the cache it had just dropped. Those live
      // fields move slowly relative to the fundamentals ingestAllActive()
      // refreshes, so building from the still-warm cache is fine —
      // invalidating afterwards just makes sure the NEXT reader (the /daily
      // preview, the dashboard) sees fresh data without this request footing
      // that bill. On the prep path buildSelection() never runs, so this is
      // simply about keeping other readers fresh.
      if (didIngest) publish()
      const origin = siteUrl()
      const asOfLabel = easternLabel(now)

      // Header index strip data. Same source preparation used to compose the
      // market read (src/lib/digest.ts) — but COLD by construction here, not
      // warm: `getIndices` is cached behind `unstable_cache(['key-indices-v1'],
      // { revalidate: 900 })`, a 15-minute TTL, and this route runs 90+
      // minutes after preparation populated it. Every read at this point is
      // therefore a guaranteed miss — a live fan-out of up to 7 Yahoo
      // requests, none of which carries its own timeout — and it runs AFTER
      // claimDigestDay and BEFORE sendStarted = true. A hang here past
      // `maxDuration` is a platform kill, not a rejected promise a `.catch()`
      // can see: the process dies mid-flight, the `catch` below never runs,
      // `releaseDigestDay` never runs, and the day becomes permanently
      // unsendable.
      //
      // Raced against a 5s timer we control instead, exactly the pattern
      // prepareDigest already uses for its own index fetch
      // (src/lib/digest.ts):
      // losing the race resolves to an empty array — renderDigestV2's index
      // strip just renders nothing, the same degraded path a fetch failure
      // takes — losing the function loses the whole day.
      let indicesTimer: ReturnType<typeof setTimeout> | undefined
      const indices = await Promise.race([
        getIndices().catch((e) => {
          console.error(`[digest] indices failed: ${(e as Error).message}`)
          return [] as IndexCardData[]
        }),
        new Promise<IndexCardData[]>((resolve) => {
          indicesTimer = setTimeout(() => {
            console.warn('[digest] indices timed out after 5000ms — sending with an empty index strip')
            resolve([])
          }, 5000)
        }),
      ]).finally(() => {
        if (indicesTimer) clearTimeout(indicesTimer)
      })

      // The fallback path composes its own market read. It could not do this
      // when the read came from a paid API call — the point of the fallback
      // is that it runs when preparation did NOT, so spending money and a
      // multi-second round trip inside the send window was not an option.
      // buildMarketRead is pure, synchronous and free, so that objection is
      // gone: the only input it needs beyond the picks is `indices`, which
      // this route already fetched just above for the header strip. The
      // fallback now degrades in charts alone, not charts AND prose.
      if (!usingPrep && inlinePicks) {
        commentary = buildMarketRead(inlinePicks, indices)
      }

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
        // `indices` is a required field on `DigestData` itself (Task 9
        // hoisted it there from a render-v2.ts-local type — see render.ts's
        // DigestData doc comment), so this literal has to supply it whether
        // `renderDigest` ends up dispatching to v1 (which ignores it) or v2
        // (which reads it for the header index strip).
        const mailData: DigestData = {
          recipient: { firstName: r.firstName, unsubscribeToken: r.unsubscribeToken },
          selection,
          asOfLabel,
          siteUrl: origin,
          commentary,
          indices,
        }
        const mail = renderDigest(mailData, templateOverride)
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

      sendStarted = true
      const report = await sendEmails(messages)

      // Nothing reads the JSON response at 6 AM, so a failed or partial send
      // must show up somewhere an alert or a human can see it. errors.length
      // is checked too, not just failed > 0: a misconfiguration (e.g. no
      // RESEND_API_KEY) can produce errors without every failed message being
      // separately counted, and either signal alone means something to see.
      if (report.failed > 0 || report.errors.length > 0) {
        console.error(
          `[digest] ${report.failed}/${messages.length} message(s) failed to send: ${report.errors.join('; ')}`,
        )
      }

      // 6. Record. Persist the compact DTO, not the full ScoredPick — the
      // latter carries input.technicals (126 OHLC bars + four 126-point
      // series per pick), which does not belong in this jsonb audit column.
      // On the prep path `pickRecords` is already this same DTO shape (plus
      // chartUrl) straight from screener_digest_prep, so there's nothing to
      // re-derive; on the fallback path it's mapped from the ScoredPicks
      // buildSelection() just produced.
      if (claimId) {
        await recordDigestSend(claimId, report.sent, selection.picks.length, pickRecords)
      }

      return NextResponse.json({
        ok: true,
        force,
        sendNow,
        sentOn: today,
        refreshed,
        source: usingPrep ? 'prep' : 'inline',
        considered: selection.considered,
        picks: selection.picks.length,
        chartsFromPrep: usingPrep && prep ? prep.chartCount : 0,
        commentary: commentary != null,
        recipients: recipients.length,
        sent: report.sent,
        failed: report.failed,
        errors: report.errors,
      })
    } catch (e) {
      if (claimId && !sendStarted) await releaseDigestDay(claimId)
      throw e
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 })
  }
}
