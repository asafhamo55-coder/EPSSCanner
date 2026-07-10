import { buildScorecard, type Scorecard } from './signals'
import { db } from './db'
import { YahooProvider } from '@/market-data'

// Live PEG fallback — used only when the stored peg_5yr is null (pre-migration).
// Cached briefly per warm instance so repeated loads don't re-hammer Yahoo.
const pegCache = new Map<string, { peg: number | null; ts: number }>()
const PEG_TTL_MS = 60 * 60 * 1000

async function livePeg(symbol: string, yahoo: YahooProvider): Promise<number | null> {
  const cached = pegCache.get(symbol)
  if (cached && Date.now() - cached.ts < PEG_TTL_MS) return cached.peg
  const peg = await yahoo
    .getValuation(symbol)
    .then((v) => v.peg5yr)
    .catch(() => null)
  pegCache.set(symbol, { peg, ts: Date.now() })
  return peg
}

// Live 150-day SMA — not persisted in the snapshot table, so it's fetched from
// Yahoo's keyless chart endpoint and cached per warm instance.
const smaCache = new Map<string, { sma: number | null; ts: number }>()
const SMA_TTL_MS = 6 * 60 * 60 * 1000

async function liveSma150(symbol: string, yahoo: YahooProvider): Promise<number | null> {
  const cached = smaCache.get(symbol)
  if (cached && Date.now() - cached.ts < SMA_TTL_MS) return cached.sma
  const sma = await yahoo.getSma(symbol, 150).catch(() => null)
  smaCache.set(symbol, { sma, ts: Date.now() })
  return sma
}

// Live all-time high — like the SMA, not persisted in the snapshot table. Fetched
// from Yahoo's keyless chart endpoint (full history) and cached per warm instance.
// The ATH moves rarely, so the TTL is a full day.
const athCache = new Map<string, { ath: number | null; ts: number }>()
const ATH_TTL_MS = 24 * 60 * 60 * 1000

async function liveAth(symbol: string, yahoo: YahooProvider): Promise<number | null> {
  const cached = athCache.get(symbol)
  if (cached && Date.now() - cached.ts < ATH_TTL_MS) return cached.ath
  const ath = await yahoo.getAllTimeHigh(symbol).catch(() => null)
  athCache.set(symbol, { ath, ts: Date.now() })
  return ath
}

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
  const yahoo = new YahooProvider()
  return Promise.all(
    rows.map(async (row) => {
      const { eps, valuation, annual } = await loadFor(row.id)
      let val = valuation
      const [peg, sma150, allTimeHigh] = await Promise.all([
        val.peg5yr == null ? livePeg(row.symbol, yahoo) : Promise.resolve(val.peg5yr),
        liveSma150(row.symbol, yahoo),
        liveAth(row.symbol, yahoo),
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
  const yahoo = new YahooProvider()
  const [peg, sma150, allTimeHigh] = await Promise.all([
    val.peg5yr == null ? livePeg(row.symbol, yahoo) : Promise.resolve(val.peg5yr),
    liveSma150(row.symbol, yahoo),
    liveAth(row.symbol, yahoo),
  ])
  val = { ...val, peg5yr: peg ?? val.peg5yr, sma150, allTimeHigh }
  return assemble(row, eps, val, annual)
}
