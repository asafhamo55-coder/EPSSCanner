import { buildScorecard, type Scorecard } from './signals'
import { db } from './db'

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
  forwardPe: number | null
  netMarginTtm: number | null
  grossMarginTtm: number | null
  operatingMarginTtm: number | null
  roiTtm: number | null
  marketCap: number | null
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
  netMarginTtm: null,
  grossMarginTtm: null,
  operatingMarginTtm: null,
  roiTtm: null,
  marketCap: null,
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
    supabase
      .from('screener_valuation_snapshots')
      .select(
        'as_of, price, trailing_pe, forward_pe, net_margin_ttm, gross_margin_ttm, operating_margin_ttm, roi_ttm, market_cap',
      )
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
        netMarginTtm: (v.net_margin_ttm as number | null) ?? null,
        grossMarginTtm: (v.gross_margin_ttm as number | null) ?? null,
        operatingMarginTtm: (v.operating_margin_ttm as number | null) ?? null,
        roiTtm: (v.roi_ttm as number | null) ?? null,
        marketCap: (v.market_cap as number | null) ?? null,
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
      return assemble(row, eps, valuation, annual)
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
  return assemble(row, eps, valuation, annual)
}
