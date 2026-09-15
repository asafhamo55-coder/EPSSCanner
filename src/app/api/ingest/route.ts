import { NextResponse, type NextRequest } from 'next/server'
import { ingestAllActive, ingestTicker } from '@/lib/ingest'
import { publish } from '@/lib/publish'
import { liveTechnicals } from '@/lib/queries'

// Ingest endpoint — same idempotent path used by the UI server actions.
//
//   POST { symbol: "NVDA" } → ingest one ticker
//   POST {}                 → refresh every active ticker
//   GET                     → refresh every active ticker (Vercel Cron target),
//                             then warm the chart cache so nobody pays a cold fetch
//
// Optional shared-secret gate via CRON_SECRET. Vercel Cron automatically
// sends `Authorization: Bearer <CRON_SECRET>` when that env var is set, so the
// daily GET passes the same check.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

// Cron runs can exceed the default serverless window on a big watchlist.
export const maxDuration = 60

/** Chart data is cached lazily, so before this ran the first person to open a
 *  chart after the TTL lapsed paid the Yahoo round-trip — the same cold path
 *  that was timing the action out. Pre-fetching here moves that cost into the
 *  cron.
 *
 *  MUST run after publish(): `revalidateTag('yahoo-live')` drops the technicals
 *  entries, so warming first would populate a cache that is then thrown away.
 *
 *  Bounded and best-effort — a warm failure must never fail the ingest that
 *  already succeeded, and the concurrency ceiling matches getWatchlist's. */
const WARM_CONCURRENCY = 8
/** Warming runs last and is the least important part of the cron, so it gets a
 *  deadline well inside `maxDuration`. Ingest is sequential over ~100 tickers
 *  and its runtime is the variable one; without this ceiling a slow ingest plus
 *  warming could hit the platform limit and kill the whole invocation AFTER the
 *  data was already published. Workers stop starting new symbols past the
 *  budget rather than being cut off mid-flight. */
const WARM_BUDGET_MS = 20_000

async function warmTechnicals(symbols: string[]): Promise<{ warmed: number; skipped: number }> {
  const deadline = Date.now() + WARM_BUDGET_MS
  let warmed = 0
  let next = 0
  const worker = async () => {
    for (let i = next++; i < symbols.length; i = next++) {
      if (Date.now() > deadline) return
      const t = await liveTechnicals(symbols[i])
      if (t) warmed++
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(WARM_CONCURRENCY, symbols.length) }, worker),
  )
  const skipped = symbols.length - Math.min(next, symbols.length)
  if (skipped > 0) {
    console.warn(`[warm] budget hit — warmed ${warmed}, skipped ${skipped} of ${symbols.length}`)
  }
  return { warmed, skipped }
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const results = await ingestAllActive()
    publish()
    // After publish, so the warmed entries survive the tag invalidation.
    const warm = await warmTechnicals(results.map((r) => r.symbol)).catch(() => ({
      warmed: 0,
      skipped: results.length,
    }))
    return NextResponse.json({
      ok: true,
      refreshed: results.length,
      warmed: warm.warmed,
      warmSkipped: warm.skipped,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 })
  }
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { symbol?: string } = {}
  try {
    body = await req.json()
  } catch {
    /* empty body → refresh all */
  }

  try {
    if (body.symbol) {
      const result = await ingestTicker(body.symbol)
      publish(result.symbol)
      return NextResponse.json({ ok: true, result })
    }
    const results = await ingestAllActive()
    publish()
    return NextResponse.json({ ok: true, refreshed: results.length, results })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 })
  }
}
