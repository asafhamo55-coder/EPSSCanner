import { unstable_cache } from 'next/cache'
import { buildScorecard, type Scorecard } from './signals'
import { db } from './db'
import { YahooProvider } from '@/market-data'

// ── live Yahoo fields, cached in the Next Data Cache ──────────────────────────
//
// These three fields aren't persisted in the snapshot table, so they're fetched
// from Yahoo on read. They used to sit in module-level Maps, which only ever hit
// within a single warm instance — on serverless, most loads are cold, so a 57-
// ticker watchlist re-paid the full fan-out (~450ms SMA + ~285ms ATH, plus a
// ~1.3s cookie/crumb handshake for the first PEG call) on nearly every request.
//
// unstable_cache persists across instances and deploys-in-place, so a warm entry
// costs nothing. Errors are deliberately NOT caught inside the cached function:
// a throw is left uncached (so a transient Yahoo blip is retried next read),
// while a legitimate null — Yahoo genuinely has no value — is cached normally.
// Callers below turn the throw into null.

const PEG_TTL_S = 60 * 60
const SMA_TTL_S = 6 * 60 * 60
const ATH_TTL_S = 24 * 60 * 60

/** Live PEG fallback — used only when the stored peg_5yr is null (pre-migration). */
const cachedPeg = unstable_cache(
  (symbol: string) => new YahooProvider().getValuation(symbol).then((v) => v.peg5yr),
  ['yahoo-peg5yr-v1'],
  { revalidate: PEG_TTL_S, tags: ['yahoo-live'] },
)

/** Live 150-day SMA, from Yahoo's keyless chart endpoint. */
const cachedSma150 = unstable_cache(
  (symbol: string) => new YahooProvider().getSma(symbol, 150),
  ['yahoo-sma150-v1'],
  { revalidate: SMA_TTL_S, tags: ['yahoo-live'] },
)

/** Live all-time high. Moves rarely, so the TTL is a full day. */
const cachedAth = unstable_cache(
  (symbol: string) => new YahooProvider().getAllTimeHigh(symbol),
  ['yahoo-ath-v1'],
  { revalidate: ATH_TTL_S, tags: ['yahoo-live'] },
)

const livePeg = (symbol: string) => cachedPeg(symbol).catch(() => null)
const liveSma150 = (symbol: string) => cachedSma150(symbol).catch(() => null)
const liveAth = (symbol: string) => cachedAth(symbol).catch(() => null)

// Read helpers for the dashboard + ticker detail. Reads raw screener_* tables
// and runs the SAME signals engine the ingest path / tests use, so every
// surface agrees on the numbers. The watchlist is tiny, so the per-ticker
// fan-out here is intentionally simple.

export interface EpsPoint {
  fiscalPeriod: string
  periodEnd: string
  epsActual: number | null
  epsEstimate: number | null
  isForecast: boolean
}

export interface AnnualPoint {
  fiscalYear: number
  revenue: number | null
  netIncome: number | null
}

export interface Valuation {
  asOf: string | null
  price: number | null
  trailingPe: number | null
  forwardPe: number | null // Yahoo's forward P/E; column + NTM EPS Growth both use it
  peg5yr: number | null
  netMarginTtm: number | null
  grossMarginTtm: number | null
  operatingMarginTtm: number | null
  roiTtm: number | null
  marketCap: number | null
  sma150: number | null // 150-day simple moving average (live, not persisted)
  allTimeHigh: number | null // all-time high price (live, not persisted)
}

export interface TickerData {
  id: string
  symbol: string
  name: string | null
  currency: string | null
  eps: EpsPoint[]
  valuation: Valuation
  annual: AnnualPoint[]
  scorecard: Scorecard
}

interface TickerRow {
  id: string
  symbol: string
  name: string | null
  currency: string | null
}

const EMPTY_VALUATION: Valuation = {
  asOf: null,
  price: null,
  trailingPe: null,
  forwardPe: null,
  peg5yr: null,
  netMarginTtm: null,
  grossMarginTtm: null,
  operatingMarginTtm: null,
  roiTtm: null,
  marketCap: null,
  sma150: null,
  allTimeHigh: null,
}

function strictlyIncreasing(values: Array<number | null>): boolean | null {
  const clean = values.filter((v): v is number => v != null)
  if (clean.length < 2) return null
  for (let i = 1; i < clean.length; i++) if (clean[i] <= clean[i - 1]) return false
  return true
}

function assemble(row: TickerRow, eps: EpsPoint[], valuation: Valuation, annual: AnnualPoint[]): TickerData {
  const actualSeries = eps.filter((e) => !e.isForecast).map((e) => e.epsActual)
  const scorecard = buildScorecard({
    trailingPe: valuation.trailingPe,
    forwardPe: valuation.forwardPe,
    price: valuation.price,
    netMarginTtm: valuation.netMarginTtm,
    revenueGrowing: strictlyIncreasing(annual.map((a) => a.revenue)),
    netIncomeGrowing: strictlyIncreasing(annual.map((a) => a.netIncome)),
    yearsOnFile: annual.length,
    epsSeries: actualSeries,
  })
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    currency: row.currency,
    eps,
    valuation,
    annual,
    scorecard,
  }
}

async function loadFor(tickerId: string) {
  const supabase = db()
  const [epsRes, valRes, annualRes] = await Promise.all([
    supabase
      .from('screener_quarterly_eps')
      .select('fiscal_period, period_end, eps_actual, eps_estimate, is_forecast')
      .eq('ticker_id', tickerId)
      .order('period_end', { ascending: true }),
    // select('*') so the additive peg_5yr column loads when present without
    // erroring on installs where migration 0028 hasn't been applied yet.
    supabase
      .from('screener_valuation_snapshots')
      .select('*')
      .eq('ticker_id', tickerId)
      .order('as_of', { ascending: false })
      .limit(1),
    supabase
      .from('screener_annual_financials')
      .select('fiscal_year, revenue, net_income')
      .eq('ticker_id', tickerId)
      .order('fiscal_year', { ascending: true }),
  ])

  const eps: EpsPoint[] = (epsRes.data ?? []).map((r: Record<string, unknown>) => ({
    fiscalPeriod: r.fiscal_period as string,
    periodEnd: r.period_end as string,
    epsActual: (r.eps_actual as number | null) ?? null,
    epsEstimate: (r.eps_estimate as number | null) ?? null,
    isForecast: Boolean(r.is_forecast),
  }))

  const v = (valRes.data ?? [])[0] as Record<string, unknown> | undefined
  const valuation: Valuation = v
    ? {
        asOf: (v.as_of as string) ?? null,
        price: (v.price as number | null) ?? null,
        trailingPe: (v.trailing_pe as number | null) ?? null,
        forwardPe: (v.forward_pe as number | null) ?? null,
        peg5yr: (v.peg_5yr as number | null) ?? null,
        netMarginTtm: (v.net_margin_ttm as number | null) ?? null,
        grossMarginTtm: (v.gross_margin_ttm as number | null) ?? null,
        operatingMarginTtm: (v.operating_margin_ttm as number | null) ?? null,
        roiTtm: (v.roi_ttm as number | null) ?? null,
        marketCap: (v.market_cap as number | null) ?? null,
        sma150: null, // filled live in getWatchlist / getTicker
        allTimeHigh: null, // filled live in getWatchlist / getTicker
      }
    : EMPTY_VALUATION

  const annual: AnnualPoint[] = (annualRes.data ?? []).map((r: Record<string, unknown>) => ({
    fiscalYear: r.fiscal_year as number,
    revenue: (r.revenue as number | null) ?? null,
    netIncome: (r.net_income as number | null) ?? null,
  }))

  return { eps, valuation, annual }
}

export async function getWatchlist(): Promise<TickerData[]> {
  const supabase = db()
  const { data } = await supabase
    .from('screener_tickers')
    .select('id, symbol, name, currency')
    .eq('active', true)
    .is('deleted_at', null)
    .order('symbol', { ascending: true })

  const rows = (data ?? []) as TickerRow[]
  return Promise.all(
    rows.map(async (row) => {
      const { eps, valuation, annual } = await loadFor(row.id)
      let val = valuation
      const [peg, sma150, allTimeHigh] = await Promise.all([
        val.peg5yr == null ? livePeg(row.symbol) : Promise.resolve(val.peg5yr),
        liveSma150(row.symbol),
        liveAth(row.symbol),
      ])
      val = { ...val, peg5yr: peg ?? val.peg5yr, sma150, allTimeHigh }
      return assemble(row, eps, val, annual)
    }),
  )
}

export async function getTicker(symbol: string): Promise<TickerData | null> {
  const supabase = db()
  const { data } = await supabase
    .from('screener_tickers')
    .select('id, symbol, name, currency')
    .eq('symbol', symbol.toUpperCase())
    .is('deleted_at', null)
    .maybeSingle()

  if (!data) return null
  const row = data as TickerRow
  const { eps, valuation, annual } = await loadFor(row.id)
  let val = valuation
  const [peg, sma150, allTimeHigh] = await Promise.all([
    val.peg5yr == null ? livePeg(row.symbol) : Promise.resolve(val.peg5yr),
    liveSma150(row.symbol),
    liveAth(row.symbol),
  ])
  val = { ...val, peg5yr: peg ?? val.peg5yr, sma150, allTimeHigh }
  return assemble(row, eps, val, annual)
}
