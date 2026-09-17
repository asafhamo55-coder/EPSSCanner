import { NextResponse, type NextRequest } from 'next/server'
import { ingestAllActive, ingestTicker } from '@/lib/ingest'
import { publish } from '@/lib/publish'
import { liveTechnicals } from '@/lib/queries'
import { prepareDigest, PREP_MIN_MS } from '@/lib/digest'
import { easternDate } from '@/lib/eastern'

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
//
// Deliberately OPTIONAL here, unlike /api/digest's identically-named
// authorized(), which fails CLOSED (401) when CRON_SECRET is unset. An
// unauthenticated GET/POST here still does real work — it re-pulls public
// fundamentals and warms the technicals cache — but that work spends no
// money and sends no mail, so it's safe to leave open.
//
// What is NOT safe to leave open: prepareDigest (called below), which
// renders a PNG per pick and uploads each to Storage. That's why the call
// to it further down is gated separately on `process.env.CRON_SECRET`
// actually being set — this function returning `true` is not proof of
// who's calling when the secret is unset (it returns `true` for EVERY
// caller in that case), so it cannot be trusted to authorize billable
// work. See the comment at that gate.
//
// /api/digest can't take the same "stay open, gate the expensive part"
// approach: its entire job IS the expensive part (a real Resend send to the
// whole list), so it fails closed outright — and an open digest endpoint
// would also leak the subscriber count in its JSON response.
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
 *  budget rather than being cut off mid-flight.
 *
 *  Reduced from 20s to 12s to make room for the preparation phase that runs
 *  after this (prepareDigest, src/lib/digest.ts). That alone proved not to
 *  be enough — see ROUTE_BUDGET_MS below, which is what actually keeps the
 *  three stages inside this route's 60s `maxDuration`; this constant now
 *  only caps warming in the case where there is room for it at all. */
const WARM_BUDGET_MS = 12_000

/** Wall-clock this route allows itself, held below `maxDuration` so the
 *  response is written before the platform would kill the invocation.
 *
 *  This exists because the arithmetic that preceded it was wrong in a way
 *  only a real run could show. `ingestAllActive()` is the one stage with NO
 *  budget — it is the primary job and must complete — so the route's true
 *  shape is `unbounded + 12s + 25s < 60s`, i.e. it silently assumed ingest
 *  always finishes within 23s. The first production run of the two-phase
 *  pipeline took longer than that and Vercel killed the function at 60s,
 *  AFTER the data was ingested and published but BEFORE preparation could
 *  write its row. Everything below now measures what is actually left
 *  rather than assuming. */
const ROUTE_BUDGET_MS = 55_000

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
    const started = Date.now()
    const results = await ingestAllActive()
    publish()
    const remaining = () => ROUTE_BUDGET_MS - (Date.now() - started)

    const wantPrep = Boolean(process.env.CRON_SECRET)

    // Preparation outranks warming when both cannot fit.
    //
    // They overlap: `warmTechnicals` calls `liveTechnicals` across the
    // ingested symbols, and preparation's own `buildSelection` calls it
    // across the watchlist — so a preparation run warms substantially the
    // same cache as a side effect of work it has to do anyway. Warming
    // first is therefore not additive; it is largely the same Yahoo traffic
    // paid twice, and paying it first is what left preparation without
    // enough budget to reach its upsert.
    //
    // Warming still runs whenever preparation is not going to (no secret),
    // and whenever there is genuinely room for both, because it does cover
    // symbols outside the watchlist for the /ticker pages.
    //
    // After publish either way, so warmed entries survive the tag
    // invalidation.
    const roomForBoth = remaining() > PREP_MIN_MS + WARM_BUDGET_MS
    const warm =
      !wantPrep || roomForBoth
        ? await warmTechnicals(results.map((r) => r.symbol)).catch(() => ({
            warmed: 0,
            skipped: results.length,
          }))
        : (console.warn(
            `[warm] skipped — ${remaining()}ms left and preparation needs at least ${PREP_MIN_MS}ms; ` +
              `preparation warms the same technicals cache as a side effect`,
          ),
          { warmed: 0, skipped: results.length })
    // Preparation runs last and is the least important part of the cron: the
    // data is already ingested and published by this point. Bounded and
    // best-effort for the same reason warming is — a preparation failure must
    // never fail an ingest that already succeeded, and the digest route falls
    // back to scoring inline when the row is absent.
    //
    // Gated on CRON_SECRET being SET — deliberately NOT on `authorized(req)`
    // having returned true, because those are different questions here.
    // authorized() returns true for every caller when CRON_SECRET is unset
    // (this route's fail-OPEN default, see the comment above authorized()),
    // so "authorized() passed" proves nothing about who is calling.
    // prepareDigest is the one thing in this route that consumes billable
    // resources — it renders a chart PNG per pick and uploads each to
    // Storage, which costs both CPU inside a 60s function and standing
    // bytes in the bucket — so until an operator sets CRON_SECRET, nobody,
    // including whoever finds this URL, can trigger that by hitting it.
    // Once the secret is set,
    // authorized() is a real check again and this condition is redundant
    // with it, but harmless to keep.
    //
    // Given only what is actually left, never a fixed budget: passing a
    // constant here regardless of elapsed time is precisely what pushed this
    // function past `maxDuration`. Below PREP_MIN_MS preparation cannot
    // score and still write what it scored, so it is skipped outright and
    // the digest route falls back to scoring inline — which, since the
    // market read became free to compose, is a fallback that loses only the
    // charts.
    const prepBudget = remaining()
    const prep =
      wantPrep && prepBudget >= PREP_MIN_MS
        ? await prepareDigest(easternDate(new Date()), prepBudget).catch((e) => {
            console.error(`[prep] failed: ${(e as Error).message}`)
            return null
          })
        : (wantPrep &&
            console.warn(
              `[prep] skipped — ${prepBudget}ms left of the route budget, need at least ${PREP_MIN_MS}ms`,
            ),
          null)
    return NextResponse.json({
      ok: true,
      refreshed: results.length,
      warmed: warm.warmed,
      warmSkipped: warm.skipped,
      prepOk: prep?.ok ?? false,
      prepPicks: prep?.picks ?? 0,
      prepCharts: prep?.chartsRendered ?? 0,
      prepReadOk: prep?.readOk ?? false,
      prepSkipped: wantPrep && prep == null,
      elapsedMs: Date.now() - started,
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
