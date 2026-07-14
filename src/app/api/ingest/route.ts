import { revalidatePath, revalidateTag } from 'next/cache'
import { NextResponse, type NextRequest } from 'next/server'
import { ingestAllActive, ingestTicker } from '@/lib/ingest'

// Ingest endpoint — same idempotent path used by the UI server actions.
//
//   POST { symbol: "NVDA" } → ingest one ticker
//   POST {}                 → refresh every active ticker
//   GET                     → refresh every active ticker (Vercel Cron target)
//
// Optional shared-secret gate via CRON_SECRET. Vercel Cron automatically
// sends `Authorization: Bearer <CRON_SECRET>` when that env var is set, so the
// weekly GET passes the same check.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

// Cron runs can exceed the default serverless window on a big watchlist.
export const maxDuration = 60

// The dashboard is served from the CDN (ISR), so a fresh ingest is invisible
// until its cache is dropped. Publish the new numbers as soon as they land
// rather than waiting out the page's revalidate window.
function publish(symbol?: string) {
  revalidateTag('yahoo-live')
  revalidatePath('/')
  if (symbol) revalidatePath(`/ticker/${symbol}`)
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const results = await ingestAllActive()
    publish()
    return NextResponse.json({ ok: true, refreshed: results.length })
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
