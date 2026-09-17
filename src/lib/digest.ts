// Turns the watchlist into scored picks. The one place that knows how the
// screener's stored data maps onto ScoreInput, so the email and the preview
// page cannot rank different stocks.

import { unstable_cache } from 'next/cache'
import { epsCagr5yr, epsSurprisePct, priceChangePct } from './derive'
import { getWatchlist, liveTechnicals, type EpsPoint } from './queries'
import { selectPicks, type ScoreInput, type Selection } from './score'

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
