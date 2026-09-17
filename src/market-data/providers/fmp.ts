import type {
  AnnualRow,
  DataProvider,
  EpsRow,
  ValuationSnapshot,
} from '../provider'
import { ProviderError } from '../provider'
import { YahooProvider } from './yahoo'

// Financial Modeling Prep (https://financialmodelingprep.com) adapter.
//
// Uses FMP's current "stable" API. The old `/api/v3/*` REST routes were
// deprecated on 2025-08-31 — keys issued after that date get a
// "Legacy Endpoint" error — so every call here targets `/stable/*`, which
// takes the symbol as a `?symbol=` query param (not a path segment) and
// returns renamed fields vs the legacy schema.
//
// Endpoints used:
//   /profile?symbol=            → name, currency
//   /earnings?symbol=           → reported + estimated EPS/rev per quarter
//   /quote?symbol=              → price, market cap
//   /ratios-ttm?symbol=         → trailing P/E, margins
//   /key-metrics-ttm?symbol=    → ROIC TTM
//   /analyst-estimates?symbol=&period=annual → forward EPS → forward P/E
//   /income-statement?symbol=&period=annual  → 5-yr revenue / net income
//
// FMP returns split-adjusted historical EPS, so step-3/4 ratios are valid
// without renormalizing. All values are passed through as-is; the calc engine
// (src/lib/signals.ts in the app) owns every formula and edge case.

const BASE = 'https://financialmodelingprep.com/stable'

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

/** Retry budget for rate limiting. 429 is the one status worth retrying here:
 *  it is explicitly "slow down", not "this request is wrong", and the caller
 *  (ingestAllActive) now issues several of these in parallel, which is what
 *  provokes it. Everything else — 401, 403, 404, 5xx — is passed straight
 *  through, because retrying those just spends the function's remaining
 *  wall-clock to arrive at the same error.
 *
 *  Kept small on purpose. These run inside a 60s serverless function, so the
 *  worst case has to stay bounded: 0.5s + 1s + 2s = 3.5s of sleeping across
 *  three retries, per request that is actually being throttled. */
const RATE_LIMIT_RETRIES = 3
const RATE_LIMIT_BASE_DELAY_MS = 500

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function get<T>(symbol: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`)
  url.searchParams.set('apikey', apiKey())
  url.searchParams.set('symbol', symbol)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  let res = await fetch(url, { headers: { accept: 'application/json' } })
  for (let attempt = 0; res.status === 429 && attempt < RATE_LIMIT_RETRIES; attempt++) {
    // Honour Retry-After when the server sends one — it knows its own window
    // better than exponential backoff guesses — but cap it, since a header
    // asking for 30s is longer than this function is allowed to live.
    const retryAfter = Number(res.headers.get('retry-after'))
    const backoff = RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 2_000)
      : backoff
    await sleep(waitMs)
    res = await fetch(url, { headers: { accept: 'application/json' } })
  }
  if (!res.ok) {
    throw new ProviderError(`FMP ${path} → ${res.status}`, symbol, res.status)
  }
  const json = await res.json()
  // FMP signals quota / plan / legacy errors as a 200 with an object carrying
  // an "Error Message" instead of the expected array — surface it as a
  // ProviderError so ingest labels the snapshot instead of crashing on shape.
  if (json && !Array.isArray(json) && typeof json === 'object' && 'Error Message' in json) {
    throw new ProviderError(`FMP ${path}: ${(json as { 'Error Message': string })['Error Message']}`, symbol)
  }
  return json as T
}

function toNum(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** A P/E is only meaningful with positive earnings; a negative value (loss)
 *  must read as N/A, never a misleading negative ratio (e.g. INTC -193.9). */
function posPe(v: number | null): number | null {
  return v != null && v > 0 ? v : null
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
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
  epsActual: number | null
  epsEstimated: number | null
  revenueActual: number | null
  revenueEstimated: number | null
}

interface FmpProfile {
  companyName?: string
  currency?: string
}

interface FmpRatiosTtm {
  priceToEarningsRatioTTM?: number
  netProfitMarginTTM?: number
  grossProfitMarginTTM?: number
  operatingProfitMarginTTM?: number
}

interface FmpKeyMetricsTtm {
  returnOnInvestedCapitalTTM?: number
}

interface FmpQuote {
  price?: number
  marketCap?: number
}

interface FmpAnnualEstimate {
  date: string // fiscal-year end 'YYYY-MM-DD'
  epsAvg?: number // consensus EPS estimate for that fiscal year
}

interface FmpIncome {
  fiscalYear?: string
  revenue?: number
  netIncome?: number
}

export class FmpProvider implements DataProvider {
  async getProfile(symbol: string) {
    const rows = await get<FmpProfile[]>(symbol, '/profile')
    const p = rows[0]
    return { name: p?.companyName ?? null, currency: p?.currency ?? null }
  }

  async getQuarterlyEps(symbol: string, quarters: number): Promise<EpsRow[]> {
    // Pull a generous window so we keep `quarters` actuals AND the forward
    // estimate rows FMP returns ahead of `date = today`.
    const rows = await get<FmpEarning[]>(symbol, '/earnings', {
      limit: String(quarters + 8),
    })
    const t = today()

    const mapped = rows.map<EpsRow>((r) => {
      const isForecast = r.epsActual == null || r.date > t
      return {
        fiscalPeriod: fiscalPeriodFromDate(r.date),
        periodEnd: r.date,
        epsActual: isForecast ? null : toNum(r.epsActual),
        epsEstimate: toNum(r.epsEstimated),
        revenueActual: isForecast ? null : toNum(r.revenueActual),
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
    const [ratios, metrics, quotes, estimates, yahoo] = await Promise.all([
      get<FmpRatiosTtm[]>(symbol, '/ratios-ttm'),
      get<FmpKeyMetricsTtm[]>(symbol, '/key-metrics-ttm'),
      get<FmpQuote[]>(symbol, '/quote'),
      get<FmpAnnualEstimate[]>(symbol, '/analyst-estimates', { period: 'annual', limit: '10' }),
      // FMP's priceToEarningsRatioTTM uses an adjusted-EPS basis that reads low
      // vs the headline GAAP-diluted trailing P/E quoted everywhere else, and it
      // has no 5-yr-expected PEG. Pull both from keyless Yahoo (parallel,
      // best-effort).
      new YahooProvider().getValuation(symbol).catch(() => null),
    ])
    const r = ratios[0] ?? {}
    const km = metrics[0] ?? {}
    const q = quotes[0] ?? {}

    const price = toNum(q.price)
    const trailingPe = posPe(yahoo?.trailingPe ?? toNum(r.priceToEarningsRatioTTM))
    const peg5yr = posPe(yahoo?.peg5yr ?? null)

    // Forward P/E: derive it from price ÷ next fiscal-year consensus EPS. The
    // stable quote no longer carries `pe`/`eps`, so we pull the nearest future
    // annual estimate (smallest period-end date past today). If there's no
    // usable estimate, leave null and step 5 degrades to n/a (calc engine).
    const t = today()
    const nextEstimate = estimates
      .filter((e) => e.date > t && (toNum(e.epsAvg) ?? 0) > 0)
      .sort((a, b) => a.date.localeCompare(b.date))[0]
    const forwardEps = nextEstimate ? toNum(nextEstimate.epsAvg) : null
    const fmpForwardPe =
      price !== null && price > 0 && forwardEps !== null && forwardEps > 0 ? price / forwardEps : null
    // Forward P/E = Yahoo's value (what Yahoo Finance shows); it drives BOTH the
    // Forward P/E column AND the NTM EPS Growth (= trailing ÷ forward × 100).
    // FMP's analyst-estimate derivation is only a fallback when Yahoo lacks it.
    const forwardPe = posPe(yahoo?.forwardPe ?? fmpForwardPe)

    return {
      asOf: t,
      price,
      trailingPe,
      forwardPe,
      peg5yr,
      netMarginTtm: toNum(r.netProfitMarginTTM),
      grossMarginTtm: toNum(r.grossProfitMarginTTM),
      operatingMarginTtm: toNum(r.operatingProfitMarginTTM),
      roiTtm: toNum(km.returnOnInvestedCapitalTTM),
      marketCap: toNum(q.marketCap),
    }
  }

  async getAnnualFinancials(symbol: string, years: number): Promise<AnnualRow[]> {
    const rows = await get<FmpIncome[]>(symbol, '/income-statement', {
      period: 'annual',
      limit: String(years),
    })
    return rows
      .map<AnnualRow>((r) => ({
        fiscalYear: Number(r.fiscalYear) || 0,
        revenue: toNum(r.revenue),
        netIncome: toNum(r.netIncome),
      }))
      .filter((r) => r.fiscalYear > 0)
      .sort((a, b) => a.fiscalYear - b.fiscalYear)
  }
}
