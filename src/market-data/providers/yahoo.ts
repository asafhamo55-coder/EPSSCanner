import type {
  AnnualRow,
  DataProvider,
  EpsRow,
  ValuationSnapshot,
} from '../provider'
import { ProviderError } from '../provider'

// Yahoo Finance adapter — keyless, real-time data. Implements the same
// DataProvider seam as the FMP/mock providers; the signals engine never changes.
//
// Yahoo's `quoteSummary` endpoint requires a cookie + crumb handshake (since
// 2023). We fetch both once and cache them per process. Modules used:
//   price                         → name, currency, price, market cap
//   summaryDetail/defaultKeyStats → trailing & forward P/E
//   financialData                 → TTM margins, return on assets
//   earnings                      → quarterly actual EPS + revenue
//   earningsTrend                 → forward EPS/revenue estimates (next quarters)
//   incomeStatementHistory        → annual revenue / net income
//
// NOTE: Yahoo only exposes ~4 quarters / ~4 years of history, so YoY EPS
// (needs Q-4) may degrade to n/a and the 5-yr trend uses ~4 years — the calc
// engine (src/lib/signals.ts) owns those edge cases.

const QS_BASE = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary'
const CRUMB_URL = 'https://query2.finance.yahoo.com/v1/test/getcrumb'
const COOKIE_URL = 'https://fc.yahoo.com'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const MODULES = [
  'price',
  'summaryDetail',
  'defaultKeyStatistics',
  'financialData',
  'earnings',
  'earningsTrend',
  'incomeStatementHistory',
].join(',')

/** Yahoo numeric fields are `{ raw, fmt }` objects (or a bare number, or {}). */
type YNum = { raw?: number } | number | null | undefined
function num(v: YNum): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const n = v.raw
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** Yahoo-site Forward P/E: price ÷ the current fiscal year's EPS estimate,
 *  rolling to next year when the current FY ends within ~4 months. */
function forwardPeFromTrend(
  trend: QuoteSummary['earningsTrend'],
  price: number | null,
): number | null {
  if (price == null || price <= 0) return null
  const periods = trend?.trend ?? []
  const cy = periods.find((t) => t.period === '0y')
  const ny = periods.find((t) => t.period === '+1y')
  let chosen = cy
  const end = cy?.endDate
  if (end) {
    const daysLeft = (Date.parse(end) - Date.now()) / 86_400_000
    if (daysLeft < 120 && num(ny?.earningsEstimate?.avg) != null) chosen = ny
  } else if (ny) {
    chosen = ny
  }
  const eps = num(chosen?.earningsEstimate?.avg)
  return eps != null && eps > 0 ? price / eps : null
}

// ── credentials (cookie + crumb), cached for the process lifetime ──────────
let creds: { cookie: string; crumb: string } | null = null

async function getCreds(symbol: string): Promise<{ cookie: string; crumb: string }> {
  if (creds) return creds
  const cookieRes = await fetch(COOKIE_URL, {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  }).catch(() => null)

  const setCookie = cookieRes?.headers.getSetCookie?.() ?? []
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ')

  const crumbRes = await fetch(CRUMB_URL, {
    headers: { 'User-Agent': UA, ...(cookie ? { cookie } : {}) },
  })
  if (!crumbRes.ok) {
    throw new ProviderError(`Yahoo getcrumb → ${crumbRes.status}`, symbol, crumbRes.status)
  }
  const crumb = (await crumbRes.text()).trim()
  if (!crumb || crumb.includes('<')) {
    throw new ProviderError('Yahoo returned an empty/invalid crumb', symbol)
  }
  creds = { cookie, crumb }
  return creds
}

interface QuoteSummary {
  price?: {
    longName?: string
    shortName?: string
    currency?: string
    regularMarketPrice?: YNum
    marketCap?: YNum
  }
  summaryDetail?: { trailingPE?: YNum; forwardPE?: YNum }
  defaultKeyStatistics?: { forwardPE?: YNum; pegRatio?: YNum; trailingPegRatio?: YNum }
  financialData?: {
    profitMargins?: YNum
    grossMargins?: YNum
    operatingMargins?: YNum
    returnOnAssets?: YNum
  }
  earnings?: {
    earningsChart?: { quarterly?: { date?: string; actual?: YNum; estimate?: YNum }[] }
    financialsChart?: { quarterly?: { date?: string; revenue?: YNum; earnings?: YNum }[] }
  }
  earningsTrend?: {
    trend?: {
      period?: string
      endDate?: string
      earningsEstimate?: { avg?: YNum }
      revenueEstimate?: { avg?: YNum }
    }[]
  }
  incomeStatementHistory?: {
    incomeStatementHistory?: { endDate?: YNum; totalRevenue?: YNum; netIncome?: YNum }[]
  }
}

async function fetchSummary(symbol: string): Promise<QuoteSummary> {
  const { cookie, crumb } = await getCreds(symbol)
  const url = new URL(`${QS_BASE}/${encodeURIComponent(symbol)}`)
  url.searchParams.set('modules', MODULES)
  url.searchParams.set('crumb', crumb)

  const res = await fetch(url, {
    headers: { 'User-Agent': UA, accept: 'application/json', ...(cookie ? { cookie } : {}) },
  })
  if (res.status === 401 || res.status === 403) {
    // Stale crumb — drop the cache so the next call re-handshakes.
    creds = null
    throw new ProviderError(`Yahoo quoteSummary → ${res.status} (crumb rejected)`, symbol, res.status)
  }
  if (!res.ok) {
    throw new ProviderError(`Yahoo quoteSummary → ${res.status}`, symbol, res.status)
  }
  const json = (await res.json()) as {
    quoteSummary?: { result?: QuoteSummary[]; error?: { description?: string } }
  }
  const err = json.quoteSummary?.error?.description
  if (err) throw new ProviderError(`Yahoo: ${err}`, symbol)
  const result = json.quoteSummary?.result?.[0]
  if (!result) throw new ProviderError(`Yahoo returned no data for ${symbol}`, symbol)
  return result
}

/** Yahoo quarter labels look like '1Q2024' → '2024Q1'. */
function fiscalPeriodFromQuarter(label: string): string {
  const m = /^([1-4])Q(\d{4})$/.exec(label)
  if (!m) return label
  return `${m[2]}Q${m[1]}`
}

/** Synthesize a quarter-end ISO date from a 'YYYYQn' fiscal period — Yahoo's
 *  earnings chart omits exact period ends, and downstream only needs a
 *  monotonic ordering key. */
function periodEndFromFiscal(fiscal: string): string {
  const m = /^(\d{4})Q([1-4])$/.exec(fiscal)
  if (!m) return fiscal
  const ends = ['03-31', '06-30', '09-30', '12-31']
  return `${m[1]}-${ends[Number(m[2]) - 1]}`
}

/** Map an earningsTrend period offset ('0q', '+1q') against today onto a
 *  'YYYYQn' fiscal period using the trend's endDate when present. */
function fiscalFromIsoDate(date: string): { fiscal: string; periodEnd: string } {
  const [y, mo] = date.split('-').map(Number)
  const q = Math.min(4, Math.max(1, Math.ceil((mo || 1) / 3)))
  const fiscal = `${y}Q${q}`
  return { fiscal, periodEnd: periodEndFromFiscal(fiscal) }
}

export class YahooProvider implements DataProvider {
  async getProfile(symbol: string) {
    const s = await fetchSummary(symbol)
    const p = s.price ?? {}
    return { name: p.longName ?? p.shortName ?? null, currency: p.currency ?? null }
  }

  async getQuarterlyEps(symbol: string, quarters: number): Promise<EpsRow[]> {
    const s = await fetchSummary(symbol)

    const epsQ = s.earnings?.earningsChart?.quarterly ?? []
    const finQ = s.earnings?.financialsChart?.quarterly ?? []
    const revByDate = new Map<string, number | null>()
    for (const f of finQ) if (f.date) revByDate.set(f.date, num(f.revenue))

    const actuals = epsQ
      .filter((q) => q.date)
      .map<EpsRow>((q) => {
        const fiscalPeriod = fiscalPeriodFromQuarter(q.date as string)
        return {
          fiscalPeriod,
          periodEnd: periodEndFromFiscal(fiscalPeriod),
          epsActual: num(q.actual),
          epsEstimate: num(q.estimate),
          revenueActual: revByDate.get(q.date as string) ?? null,
          revenueEstimate: null,
          isForecast: false,
        }
      })
      .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
      .slice(-quarters)

    // Forward estimates: earningsTrend periods looking ahead ('0q' current,
    // '+1q' next). Skip the annual ('0y'/'+1y') and trailing entries.
    const forecasts: EpsRow[] = []
    for (const t of s.earningsTrend?.trend ?? []) {
      if (t.period !== '0q' && t.period !== '+1q') continue
      if (!t.endDate) continue
      const { fiscal, periodEnd } = fiscalFromIsoDate(t.endDate)
      forecasts.push({
        fiscalPeriod: fiscal,
        periodEnd,
        epsActual: null,
        epsEstimate: num(t.earningsEstimate?.avg),
        revenueActual: null,
        revenueEstimate: num(t.revenueEstimate?.avg),
        isForecast: true,
      })
    }

    // Drop any forecast that collides with a reported actual quarter.
    const actualPeriods = new Set(actuals.map((a) => a.fiscalPeriod))
    return [...actuals, ...forecasts.filter((f) => !actualPeriods.has(f.fiscalPeriod)).slice(0, 2)]
  }

  async getValuation(symbol: string): Promise<ValuationSnapshot> {
    const s = await fetchSummary(symbol)
    const p = s.price ?? {}
    const sd = s.summaryDetail ?? {}
    const ks = s.defaultKeyStatistics ?? {}
    const fd = s.financialData ?? {}

    const price = num(p.regularMarketPrice)
    return {
      asOf: new Date().toISOString().slice(0, 10),
      price,
      trailingPe: num(sd.trailingPE),
      // Yahoo Finance's *website* Forward P/E = price ÷ current-fiscal-year EPS
      // estimate, rolling to next year only when the current FY is within ~4
      // months of ending. (The API's summaryDetail.forwardPE uses next-FY and
      // disagrees with the site — e.g. PLTR site 90.91 vs API 64.) Fall back to
      // the API field when earningsTrend is unavailable.
      forwardPe: forwardPeFromTrend(s.earningsTrend, price) ?? num(sd.forwardPE) ?? num(ks.forwardPE),
      peg5yr: num(ks.pegRatio) ?? num(ks.trailingPegRatio),
      netMarginTtm: num(fd.profitMargins),
      grossMarginTtm: num(fd.grossMargins),
      operatingMarginTtm: num(fd.operatingMargins),
      roiTtm: num(fd.returnOnAssets),
      marketCap: num(p.marketCap),
    }
  }

  async getAnnualFinancials(symbol: string, years: number): Promise<AnnualRow[]> {
    const s = await fetchSummary(symbol)
    const rows = s.incomeStatementHistory?.incomeStatementHistory ?? []
    return rows
      .map<AnnualRow>((r) => {
        const end = num(r.endDate) // unix seconds
        const fiscalYear = end ? new Date(end * 1000).getUTCFullYear() : 0
        return { fiscalYear, revenue: num(r.totalRevenue), netIncome: num(r.netIncome) }
      })
      .filter((r) => r.fiscalYear > 0)
      .sort((a, b) => a.fiscalYear - b.fiscalYear)
      .slice(-years)
  }
}
