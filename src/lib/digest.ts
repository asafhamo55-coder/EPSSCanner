// Turns the watchlist into scored picks. The one place that knows how the
// screener's stored data maps onto ScoreInput, so the email and the preview
// page cannot rank different stocks.

import { unstable_cache } from 'next/cache'
import { epsCagr5yr, epsSurprisePct, priceChangePct } from './derive'
import { getWatchlist, liveTechnicals, type EpsPoint } from './queries'
import {
  selectPicks,
  toDigestPickRecord,
  type DigestPickRecord,
  type ScoreInput,
  type ScoredPick,
  type Selection,
} from './score'
import { renderChart } from './chart/render'
import { uploadChart } from './chart/store'
import { generateCommentary } from './ai/commentary'
import { getIndices } from '@/market-data/indices'
import { db } from './db'

/** Trading-day lookbacks for the carried momentum fields — 1 day, 1 trading
 *  week, ~1 trading month. Matches priceChangePct's contract: null (not a
 *  wrong window) when the visible series is shorter than the lookback. */
const CHANGE_1D_LOOKBACK = 1
const CHANGE_1W_LOOKBACK = 5
const CHANGE_1M_LOOKBACK = 21

/** Newest reported (non-forecast) quarter with both an actual and an
 *  estimate — `eps` is ordered oldest→newest, so this walks backward from the
 *  end rather than filtering the whole array. Null when no such quarter
 *  exists yet. */
function latestEpsSurprisePct(eps: EpsPoint[]): number | null {
  for (let i = eps.length - 1; i >= 0; i--) {
    const e = eps[i]
    if (!e.isForecast && e.epsActual != null && e.epsEstimate != null) {
      return epsSurprisePct(e.epsActual, e.epsEstimate)
    }
  }
  return null
}

/** Matches LIVE_FETCH_CONCURRENCY in queries.ts — same Yahoo endpoint, same
 *  ceiling, so the digest cannot be the thing that gets us rate-limited. */
const TECHNICALS_CONCURRENCY = 8

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export async function buildSelection(): Promise<Selection> {
  const watchlist = await getWatchlist()
  // getWatchlist() swallows its own Supabase error and returns [] on a read
  // failure — intentional for the dashboard, which should degrade rather than
  // 500. But an empty watchlist is never a legitimate state for THIS app (the
  // whole point of the feature is a non-empty watchlist to score), so treat
  // it as the read failure it actually is. The caller (the digest route) has
  // a releaseDigestDay() path built exactly for this: throwing here lets a
  // claimed day be retried instead of recording "None of 0 watchlist names
  // cleared this morning's entry gate" as a successfully sent digest.
  if (watchlist.length === 0) {
    throw new Error('buildSelection: watchlist came back empty — treating as a read failure')
  }
  const inputs: ScoreInput[] = await mapLimit(watchlist, TECHNICALS_CONCURRENCY, async (t) => {
    const sc = t.scorecard
    const tech = await liveTechnicals(t.symbol)
    return {
      symbol: t.symbol,
      name: t.name,
      price: t.valuation.price,
      marketCap: t.valuation.marketCap,
      trailingPe: sc.pe.trailingPe,
      sma150: t.valuation.sma150,
      allTimeHigh: t.valuation.allTimeHigh,
      yoyPct: sc.yoy.pct,
      yoyState: sc.yoy.state,
      ntmPct: sc.fwd.pct,
      ntmState: sc.fwd.state,
      epsCagr5yr: epsCagr5yr(sc.pe.trailingPe, t.valuation.peg5yr),
      technicals: tech,
      // ── Carried context — see ScoreInput; never read by runGates/runFactors ──
      forwardPe: sc.fwd.forwardPe,
      peg5yr: t.valuation.peg5yr,
      netMarginTtm: t.valuation.netMarginTtm,
      grossMarginTtm: t.valuation.grossMarginTtm,
      operatingMarginTtm: t.valuation.operatingMarginTtm,
      roiTtm: t.valuation.roiTtm,
      epsSurprisePct: latestEpsSurprisePct(t.eps),
      change1dPct: tech ? priceChangePct(tech.visible, CHANGE_1D_LOOKBACK) : null,
      change1wPct: tech ? priceChangePct(tech.visible, CHANGE_1W_LOOKBACK) : null,
      change1mPct: tech ? priceChangePct(tech.visible, CHANGE_1M_LOOKBACK) : null,
      fullRange: tech ? tech.fullRange : null,
    }
  })
  return selectPicks(inputs)
}

/** Cached wrapper for the public, unauthenticated /daily preview page.
 *  buildSelection() is roughly 172 Supabase round-trips plus up to 57 Yahoo
 *  calls on a cold cache — the page's own `export const revalidate = 300` is
 *  dead (searchParams forces it dynamic), so every view re-ran that whole
 *  fan-out. This follows the same unstable_cache + 'yahoo-live' tag pattern
 *  queries.ts uses for its own live fields: publish() (src/lib/publish.ts)
 *  drops the 'yahoo-live' tag after every ingest, which invalidates this too,
 *  so the /api/digest route's own uncached buildSelection() call is
 *  unaffected — this wrapper exists only for the page. */
export const getCachedSelection = unstable_cache(buildSelection, ['digest-selection-v1'], {
  revalidate: 300,
  tags: ['yahoo-live'],
})

// ─── Preparation phase (Task 6) ─────────────────────────────────────
//
// The expensive half of the digest — scoring, chart rendering, and the one
// Claude call — runs inside the 09:30 UTC ingest cron and lands in
// screener_digest_prep. The 11:00 UTC digest cron reads that row and only
// renders and sends, which is the only way both fit inside Vercel Hobby's
// 60s-per-function ceiling. See supabase/migrations/0030_digest_prep.sql.
//
// By the time this runs, market data is already ingested and published, so
// nothing here may fail the cron that produced it. Every stage below is
// best-effort and degrades the row rather than throwing; the caller
// (src/app/api/ingest/route.ts) wraps the call to prepareDigest in its own
// .catch() as the outermost net, but the upsert itself is caught here too so
// a missing table (not yet migrated) or bucket (not yet created) reports
// failure through the return value instead of an unhandled rejection.

/** Chart rendering is CPU-bound, unlike the I/O-bound Yahoo fan-out that
 *  TECHNICALS_CONCURRENCY governs above — oversubscribing CPU in a
 *  serverless function makes everything slower, not faster, hence the lower
 *  ceiling. */
const CHART_CONCURRENCY = 4

/** Preparation's own deadline, separate from (and smaller than) the ingest
 *  route's `maxDuration`. Ingest itself plus its post-publish warm phase
 *  (WARM_BUDGET_MS) both run before this, so this budget has to leave room
 *  for both ahead of it inside the same 60s function. */
const PREP_BUDGET_MS = 25_000

/** Renders and uploads a chart per pick, mutating `chartUrl` onto the
 *  ScoredPick in place. `renderChart`/`uploadChart` already never throw —
 *  every failure mode returns null — so the only thing this adds is the
 *  concurrency ceiling and an overall deadline: workers stop starting new
 *  charts once the budget is spent rather than running past it, the same
 *  shape warmTechnicals uses in the ingest route. Returns how many charts
 *  were actually rendered and stored. */
async function renderCharts(prepOn: string, picks: ScoredPick[], deadline: number): Promise<number> {
  let rendered = 0
  let next = 0
  const worker = async () => {
    for (let i = next++; i < picks.length; i = next++) {
      if (Date.now() > deadline) return
      const pick = picks[i]
      const technicals = pick.input.technicals
      if (!technicals) continue
      const png = await renderChart({ symbol: pick.symbol, technicals })
      if (!png) continue
      const url = await uploadChart(prepOn, pick.symbol, png)
      if (url) {
        pick.chartUrl = url
        rendered++
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CHART_CONCURRENCY, picks.length) }, worker))
  return rendered
}

/** Compact per-pick record persisted in screener_digest_prep.picks: the same
 *  audit projection the send ledger uses (toDigestPickRecord excludes
 *  input.technicals — ~27KB per pick — for exactly the same jsonb-column
 *  reason), plus the chartUrl attached during this phase. toDigestPickRecord
 *  itself deliberately omits chartUrl since it is not carried ScoreInput
 *  context but an artifact this phase produces, so it is added back here. */
export interface PrepPickRecord extends DigestPickRecord {
  chartUrl: string | null
}

export interface PrepResult {
  ok: boolean
  picks: number
  chartsRendered: number
  aiOk: boolean
}

export interface Prep {
  prepOn: string
  picks: PrepPickRecord[]
  marketRead: string | null
  perStock: Record<string, string>
  chartCount: number
  aiOk: boolean
}

/** Runs the full preparation phase for one Eastern calendar date and upserts
 *  the result to screener_digest_prep, keyed on `prepOn`. Order: score →
 *  render and upload a chart per pick → one Claude commentary call → upsert.
 *  Each stage after scoring is independently best-effort so a later failure
 *  still persists whatever the earlier stages produced — the digest cron
 *  should always have a row to read, even a degraded one.
 *
 *  `buildSelection()` is NOT guarded here: an empty watchlist means there is
 *  nothing to prepare, and that failure is meant to surface — the caller
 *  already wraps this whole call in `.catch()` for exactly that case. */
export async function prepareDigest(prepOn: string): Promise<PrepResult> {
  const deadline = Date.now() + PREP_BUDGET_MS

  const selection = await buildSelection()

  const chartsRendered = await renderCharts(prepOn, selection.picks, deadline).catch((e) => {
    console.error(`[prep] chart rendering threw: ${(e as Error).message}`)
    return 0
  })

  const indices = await getIndices().catch((e) => {
    console.error(`[prep] indices failed: ${(e as Error).message}`)
    return []
  })
  const commentary = await generateCommentary(selection.picks, indices).catch((e) => {
    console.error(`[prep] commentary threw: ${(e as Error).message}`)
    return null
  })

  const records: PrepPickRecord[] = selection.picks.map((p) => ({
    ...toDigestPickRecord(p),
    chartUrl: p.chartUrl ?? null,
  }))

  try {
    const supabase = db()
    const { error } = await supabase.from('screener_digest_prep').upsert(
      {
        prep_on: prepOn,
        picks: records,
        market_read: commentary?.marketRead ?? null,
        per_stock: commentary?.perStock ?? null,
        chart_count: chartsRendered,
        ai_ok: commentary != null,
      },
      { onConflict: 'prep_on' },
    )
    if (error) {
      console.error(`[prep] upsert failed: ${error.message}`)
      return { ok: false, picks: selection.picks.length, chartsRendered, aiOk: commentary != null }
    }
  } catch (e) {
    console.error(`[prep] upsert threw: ${(e as Error).message}`)
    return { ok: false, picks: selection.picks.length, chartsRendered, aiOk: commentary != null }
  }

  return { ok: true, picks: selection.picks.length, chartsRendered, aiOk: commentary != null }
}

/** Reads back the preparation row for one Eastern calendar date, mapped to
 *  camelCase, or null when nothing is there yet (not migrated, not yet run
 *  today, or the upsert above failed). Read-only — never throws; the digest
 *  route's fallback path is to score inline when this comes back null. */
export async function readPrep(prepOn: string): Promise<Prep | null> {
  try {
    const supabase = db()
    const { data, error } = await supabase
      .from('screener_digest_prep')
      .select('prep_on, picks, market_read, per_stock, chart_count, ai_ok')
      .eq('prep_on', prepOn)
      .maybeSingle()
    if (error) {
      console.error(`[prep] read failed: ${error.message}`)
      return null
    }
    if (!data) return null
    const r = data as Record<string, unknown>
    return {
      prepOn: r.prep_on as string,
      picks: (r.picks as PrepPickRecord[] | null) ?? [],
      marketRead: (r.market_read as string | null) ?? null,
      perStock: (r.per_stock as Record<string, string> | null) ?? {},
      chartCount: (r.chart_count as number | null) ?? 0,
      aiOk: (r.ai_ok as boolean | null) ?? false,
    }
  } catch (e) {
    console.error(`[prep] read threw: ${(e as Error).message}`)
    return null
  }
}
