'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { after } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { renderConfirm } from '@/lib/email/confirm'
import { sendEmails } from '@/lib/email/send'
import { ingestAllActive, ingestTicker } from '@/lib/ingest'
import { getProvider } from '@/market-data'
import { liveTechnicals } from '@/lib/queries'
import { siteUrl } from '@/lib/site'
import { upsertSubscriber } from '@/lib/subscribers'
import type { Technicals } from '@/lib/technicals'

export interface ActionResult {
  ok: boolean
  message?: string
  error?: string
}

export interface EvalPrefill {
  symbol: string
  name: string | null
  baseYear: number
  baseRevenue: number // $bn
  revenueGrowth: number // fraction
  profitMargin: number // fraction
  currentMarketCap: number // $bn
  currentPrice: number // $
}

function round(n: number, dp: number): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/** Pull real FMP data for any ticker (need not be on the watchlist) and turn it
 *  into sensible starting assumptions for the evaluation model. Every field is
 *  user-editable afterwards — this is just a starting point from real data. */
export async function prefillEvaluation(
  symbol: string,
): Promise<{ ok: boolean; data?: EvalPrefill; error?: string }> {
  const sym = symbol.trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) return { ok: false, error: 'Invalid ticker symbol.' }
  try {
    const provider = getProvider()
    const [profile, val, annual] = await Promise.all([
      provider.getProfile(sym),
      provider.getValuation(sym),
      provider.getAnnualFinancials(sym, 5),
    ])

    const withRev = annual.filter((a) => a.revenue != null && a.revenue > 0)
    const latest = withRev.length ? withRev[withRev.length - 1] : null
    const baseRevenue = latest ? (latest.revenue as number) / 1e9 : 0

    // Default revenue growth = historical revenue CAGR over the years on file.
    let growth = 0.1
    if (withRev.length >= 2) {
      const first = withRev[0]
      const last = withRev[withRev.length - 1]
      const span = last.fiscalYear - first.fiscalYear
      if (span > 0 && (first.revenue as number) > 0) {
        growth = Math.pow((last.revenue as number) / (first.revenue as number), 1 / span) - 1
      }
    }

    return {
      ok: true,
      data: {
        symbol: sym,
        name: profile.name,
        baseYear: latest ? latest.fiscalYear : new Date().getFullYear(),
        baseRevenue: round(baseRevenue, 2),
        revenueGrowth: round(growth, 4),
        profitMargin: round(val.netMarginTtm ?? 0.2, 4),
        currentMarketCap: val.marketCap != null ? round(val.marketCap / 1e9, 2) : 0,
        currentPrice: val.price != null ? round(val.price, 2) : 0,
      },
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function addTickerAction(symbol: string): Promise<ActionResult> {
  const sym = symbol.trim().toUpperCase()
  if (!sym) return { ok: false, error: 'Enter a ticker symbol.' }
  try {
    const res = await ingestTicker(sym)
    revalidatePath('/')
    revalidatePath(`/ticker/${res.symbol}`)
    return { ok: true, message: `Added ${res.symbol}.` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function refreshTickerAction(symbol: string): Promise<ActionResult> {
  try {
    const res = await ingestTicker(symbol)
    // The live Yahoo fields (SMA / ATH / PEG) are held in the Data Cache for
    // 6-24h. An explicit "Refresh now" must mean it, so drop them too — not
    // just the re-ingested DB rows.
    revalidateTag('yahoo-live')
    revalidatePath('/')
    revalidatePath(`/ticker/${res.symbol}`)
    return { ok: true, message: `Refreshed ${res.symbol}.` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function refreshAllAction(): Promise<ActionResult> {
  try {
    const res = await ingestAllActive()
    revalidateTag('yahoo-live')
    revalidatePath('/')
    return { ok: true, message: `Refreshed ${res.length} ticker${res.length === 1 ? '' : 's'}.` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function removeTickerAction(symbol: string): Promise<ActionResult> {
  const sym = symbol.trim().toUpperCase()
  try {
    const supabase = db()
    const { error } = await supabase
      .from('screener_tickers')
      .update({ active: false, deleted_at: new Date().toISOString() })
      .eq('symbol', sym)
    if (error) throw new Error(error.message)
    revalidatePath('/')
    return { ok: true, message: `Removed ${sym}.` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Upper bound on the chart action. Must stay comfortably under the route's
 *  serverless limit (10s on Hobby) so WE decide the failure, not the platform:
 *  a timeout we control returns null and renders an error, a platform kill
 *  returns nothing at all and hangs the modal. */
const TECHNICALS_TIMEOUT_MS = 8_000

/** Chart data for the technical analysis modal. Fetched on demand — the modal
 *  calls this itself rather than the page preloading it for every watchlist row.
 *  Public POST endpoint with no auth in front of it, so the symbol must be
 *  validated the same way as `prefillEvaluation` above: an unvalidated string
 *  here is an unbounded `unstable_cache` key generator and an outbound Yahoo
 *  request per garbage value, which risks rate-limiting/IP-banning the
 *  deployment for `liveSma150`, `liveAth` and `livePeg` too. */
export async function getTechnicals(symbol: string): Promise<Technicals | null> {
  const sym = symbol.trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) return null

  // Resolve to null rather than run to the platform's function limit. Vercel
  // killed this action mid-flight in production (POST → responseStatusCode 0):
  // no response reaches the browser, the client promise never settles, and the
  // modal sits on its skeleton forever. Losing the race is a visible error
  // state; losing the function is an indefinite spinner.
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      liveTechnicals(sym),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[technicals] ${sym} timed out after ${TECHNICALS_TIMEOUT_MS}ms`)
          resolve(null)
        }, TECHNICALS_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const SubscribeInput = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name.').max(60),
  lastName: z.string().trim().min(1, 'Enter your last name.').max(60),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
})

/** Register for the daily digest. Double opt-in: this only ever creates a
 *  pending row and mails a confirmation link — nothing is added to the send
 *  list until that link is clicked.
 *
 *  The success message is identical whether the address was new or already
 *  confirmed. Differentiating them would turn this public form into an oracle
 *  that reports whether a given address is on the list. */
export async function subscribeAction(input: {
  firstName: string
  lastName: string
  email: string
}): Promise<ActionResult> {
  const parsed = SubscribeInput.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' }
  }
  try {
    const { outcome, subscriber } = await upsertSubscriber(parsed.data)
    if (outcome !== 'already-confirmed' && subscriber.confirmToken) {
      const confirmUrl = `${siteUrl()}/api/subscribe/confirm?token=${encodeURIComponent(subscriber.confirmToken)}`
      const mail = renderConfirm({ firstName: subscriber.firstName, confirmUrl })
      // Dispatched AFTER the response is sent, for two reasons. The response
      // time no longer depends on which branch ran, so it cannot be timed to
      // reveal whether an address is already subscribed — the identical
      // success copy above would otherwise be undone by a measurable delay.
      // And the form stops waiting on a third-party HTTP round-trip it does
      // not need to block on.
      after(async () => {
        await sendEmails([
          { to: subscriber.email, subject: mail.subject, html: mail.html, text: mail.text },
        ])
      })
    }
    return { ok: true, message: 'Check your inbox — confirm the link and your first digest arrives at 6 AM ET.' }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
