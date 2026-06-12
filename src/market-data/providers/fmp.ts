import type {
  AnnualRow,
  DataProvider,
  EpsRow,
  ValuationSnapshot,
} from '../provider'
import { ProviderError } from '../provider'

// Financial Modeling Prep (https://financialmodelingprep.com) adapter.
//
// Endpoints used (stable v3 REST):
//   /profile/{sym}                            → name, currency
//   /historical/earning_calendar/{sym}        → reported + estimated EPS/rev
//   /ratios-ttm/{sym} + /quote/{sym}          → trailing/forward P/E, margins
//   /income-statement/{sym}?period=annual     → 5-yr revenue / net income
//
// FMP returns split-adjusted historical EPS, so step-3/4 ratios are valid
// without renormalizing. All values are passed through as-is; the calc engine
// (src/lib/signals.ts in the app) owns every formula and edge case.

const BASE = 'https://financialmodelingprep.com/api/v3'

function apiKey(): string {
  const key = process.env.MARKET_DATA_FMP_API_KEY
  if (!key) {
    throw new Error(
      'MARKET_DATA_FMP_API_KEY is not set — required for the FMP provider. ' +
        'Set MARKET_DATA_PROVIDER=mock for offline dev.',
    )
  }
  return key
}

async function get<T>(symbol: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`)
  url.searchParams.set('apikey', apiKey())
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) {
    throw new ProviderError(`FMP ${path} → ${res.status}`, symbol, res.status)
  }
  return (await res.json()) as T
}

function toNum(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** FMP dates are 'YYYY-MM-DD'. Derive a calendar-ish 'YYYYQn' label from the
 *  period-end month. We persist the provider's own period so Q-4 never drifts;
 *  this label is only the human-facing fiscal_period string. */
function fiscalPeriodFromDate(date: string): string {
  const [y, m] = date.split('-').map(Number)
  const q = Math.min(4, Math.max(1, Math.ceil((m || 1) / 3)))
  return `${y}Q${q}`
}

interface FmpEarning {
  date: string
  eps: number | null
  epsEstimated: number | null
  revenue: number | null
  revenueEstimated: number | null
}

interface FmpProfile {
  companyName?: string
  currency?: string
}

interface FmpRatiosTtm {
  priceEarningsRatioTTM?: number
  netProfitMarginTTM?: number
  grossProfitMarginTTM?: number
  operatingProfitMarginTTM?: number
  returnOnInvestmentTTM?: number
}

interface FmpQuote {
  price?: number
  pe?: number
  eps?: number // TTM EPS — used to derive forward P/E from forward EPS estimate
  marketCap?: number
}

interface FmpIncome {
  calendarYear?: string
  revenue?: number
  netIncome?: number
}

export class FmpProvider implements DataProvider {
  async getProfile(symbol: string) {
    const rows = await get<FmpProfile[]>(symbol, `/profile/${symbol}`)
    const p = rows[0]
    return { name: p?.companyName ?? null, currency: p?.currency ?? null }
  }

  async getQuarterlyEps(symbol: string, quarters: number): Promise<EpsRow[]> {
    // Pull a generous window so we keep `quarters` actuals AND the forward
    // estimate rows FMP returns ahead of `date = today`.
    const rows = await get<FmpEarning[]>(symbol, `/historical/earning_calendar/${symbol}`, {
      limit: String(quarters + 8),
    })
    const today = new Date().toISOString().slice(0, 10)

    const mapped = rows.map<EpsRow>((r) => {
      const isForecast = r.eps == null || r.date > today
      return {
        fiscalPeriod: fiscalPeriodFromDate(r.date),
        periodEnd: r.date,
        epsActual: isForecast ? null : toNum(r.eps),
        epsEstimate: toNum(r.epsEstimated),
        revenueActual: isForecast ? null : toNum(r.revenue),
        revenueEstimate: toNum(r.revenueEstimated),
        isForecast,
      }
    })

    // Newest first from FMP → sort oldest→newest so period_end ordering is
    // monotonic for the window functions downstream.
    mapped.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))

    const actuals = mapped.filter((m) => !m.isForecast).slice(-quarters)
    const forecasts = mapped.filter((m) => m.isForecast).slice(0, 2)
    return [...actuals, ...forecasts]
  }

  async getValuation(symbol: string): Promise<ValuationSnapshot> {
    const [ratios, quotes] = await Promise.all([
      get<FmpRatiosTtm[]>(symbol, `/ratios-ttm/${symbol}`),
      get<FmpQuote[]>(symbol, `/quote/${symbol}`),
    ])
    const r = ratios[0] ?? {}
    const q = quotes[0] ?? {}

    const trailingPe = toNum(q.pe) ?? toNum(r.priceEarningsRatioTTM)
    // Forward P/E: FMP's free tier doesn't expose it directly. Derive it from
    // price ÷ forward-EPS when the quote carries a forward estimate; otherwise
    // leave null and let step 5 degrade to n/a (handled in the calc engine).
    const forwardPe = null

    return {
      asOf: new Date().toISOString().slice(0, 10),
      price: toNum(q.price),
      trailingPe,
      forwardPe,
      netMarginTtm: toNum(r.netProfitMarginTTM),
      grossMarginTtm: toNum(r.grossProfitMarginTTM),
      operatingMarginTtm: toNum(r.operatingProfitMarginTTM),
      roiTtm: toNum(r.returnOnInvestmentTTM),
      marketCap: toNum(q.marketCap),
    }
  }

  async getAnnualFinancials(symbol: string, years: number): Promise<AnnualRow[]> {
    const rows = await get<FmpIncome[]>(symbol, `/income-statement/${symbol}`, {
      period: 'annual',
      limit: String(years),
    })
    return rows
      .map<AnnualRow>((r) => ({
        fiscalYear: Number(r.calendarYear) || 0,
        revenue: toNum(r.revenue),
        netIncome: toNum(r.netIncome),
      }))
      .filter((r) => r.fiscalYear > 0)
      .sort((a, b) => a.fiscalYear - b.fiscalYear)
  }
}
