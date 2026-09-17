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
 *  for both ahead of it inside the same 60s function.
 *
 *  What this actually bounds: `renderCharts` stops STARTING new charts once
 *  this deadline passes (a chart already in flight can still run past it —
 *  see the note on `renderCharts`), and the remaining time after charts,
 *  minus `UPSERT_RESERVE_MS`, is what the AI stage below is raced against.
 *  It does not bound the upsert itself, which is why time is reserved for
 *  it rather than raced. */
const PREP_BUDGET_MS = 25_000

/** Reserved off the end of PREP_BUDGET_MS so the upsert always has time to
 *  run after everything above it. A persisted partial row — whatever charts
 *  and/or AI commentary finished before the clock ran out — is the entire
 *  point of this phase's degrade-don't-fail design; that design is broken if
 *  the AI stage is allowed to eat the deadline down to zero and leave
 *  nothing for the write that actually persists the day's work. */
const UPSERT_RESERVE_MS = 4_000

/** Below this much remaining budget, attempting AI commentary is not
 *  worthwhile — fetching indices and running the Claude call cannot usefully
 *  complete in less time than this, so preparation skips straight to the
 *  upsert with `ai_ok: false` rather than gambling the reserve away. A
 *  skipped commentary is a degraded email; racing a call that never had a
 *  real chance just delays reaching the write below. */
const AI_MIN_MS = 8_000

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
  /** How many watchlist names buildSelection() considered, and how many
   *  cleared every gate but fell below MIN_SCORE — see Selection. Both null
   *  for a row written before migration 0031 added the columns (the jsonb
   *  `picks` payload predates them too, but those degrade per-field instead;
   *  these two have no such fallback, so null is the honest value). The
   *  digest route's header degrades its copy rather than showing a
   *  fabricated denominator when either is null. */
  considered: number | null
  belowCutoff: number | null
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

  // Budget left for the AI stage, with UPSERT_RESERVE_MS carved out so the
  // write below always has time to run — see PREP_BUDGET_MS/UPSERT_RESERVE_MS.
  // Can be small or negative if chart rendering ran long (a chart already in
  // flight when renderCharts' own deadline passed is not aborted — see the
  // note there); either way this check is what keeps that from eating the
  // reserve.
  const aiBudgetMs = deadline - Date.now() - UPSERT_RESERVE_MS
  let commentary: Awaited<ReturnType<typeof generateCommentary>> = null
  if (aiBudgetMs < AI_MIN_MS) {
    console.warn(
      `[prep] skipping AI commentary — ${Math.max(aiBudgetMs, 0)}ms left of budget, need at least ${AI_MIN_MS}ms`,
    )
  } else {
    // A platform kill at maxDuration is NOT a rejected promise a .catch() can
    // see — the process dies mid-flight, the upsert below never runs, and a
    // day whose charts already rendered successfully would persist nothing
    // at all. Racing against a timer we control means WE decide the failure
    // instead of the platform: losing the race resolves to null and the row
    // still gets written, degraded; losing the function loses the whole day.
    // Same pattern, same reasoning, as TECHNICALS_TIMEOUT_MS in
    // src/app/actions.ts.
    //
    // This does NOT abort the underlying Yahoo/Anthropic HTTP requests — it
    // only stops THIS function from waiting on them. That's sufficient:
    // once prepareDigest returns, the runtime tears the request down
    // regardless. Do not "improve" this into an AbortController — that
    // changes what is being raced (the request) rather than how long this
    // function waits for it, which is not the failure mode being guarded
    // against here.
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      commentary = await Promise.race([
        (async () => {
          const indices = await getIndices().catch((e) => {
            console.error(`[prep] indices failed: ${(e as Error).message}`)
            return []
          })
          return generateCommentary(selection.picks, indices)
        })().catch((e) => {
          console.error(`[prep] commentary threw: ${(e as Error).message}`)
          return null
        }),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            console.warn(`[prep] AI commentary timed out after ${aiBudgetMs}ms`)
            resolve(null)
          }, aiBudgetMs)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

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
        considered: selection.considered,
        below_cutoff: selection.belowCutoff,
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
      .select('prep_on, picks, market_read, per_stock, chart_count, ai_ok, considered, below_cutoff')
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
      considered: (r.considered as number | null) ?? null,
      belowCutoff: (r.below_cutoff as number | null) ?? null,
    }
  } catch (e) {
    console.error(`[prep] read threw: ${(e as Error).message}`)
    return null
  }
}
