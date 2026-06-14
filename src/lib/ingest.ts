import { getProvider } from '@/market-data'
import { db } from './db'

// Idempotent ingest for one ticker: pull from the active provider and upsert
// into the screener_* tables. Upsert targets — (symbol), (ticker_id,
// fiscal_period), (ticker_id, as_of), (ticker_id, fiscal_year) — mean
// re-running never duplicates, and estimates get overwritten by actuals when
// earnings land. Called by /api/ingest, the server actions, and (via HTTP) the
// Inngest weekly cron.

// Mirrors getProvider(): mock only when explicitly requested, else live FMP.
function sourceName(): string {
  return process.env.MARKET_DATA_PROVIDER?.toLowerCase() === 'mock' ? 'mock' : 'fmp'
}

export interface IngestResult {
  symbol: string
  tickerId: string
  quarters: number
  annualYears: number
  asOf: string
}

export async function ingestTicker(symbol: string): Promise<IngestResult> {
  const sym = symbol.trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) {
    throw new Error(`Invalid ticker symbol: "${symbol}"`)
  }

  const provider = getProvider()
  const supabase = db()
  const source = sourceName()
  const now = new Date().toISOString()

  const profile = await provider
    .getProfile(sym)
    .catch(() => ({ name: null, currency: 'USD' as string | null }))

  // Upsert the ticker (un-deletes a previously removed symbol).
  const { data: ticker, error: tErr } = await supabase
    .from('screener_tickers')
    .upsert(
      {
        symbol: sym,
        name: profile.name,
        currency: profile.currency ?? 'USD',
        active: true,
        deleted_at: null,
      },
      { onConflict: 'symbol' },
    )
    .select('id')
    .single()
  if (tErr || !ticker) throw new Error(`Failed to upsert ticker ${sym}: ${tErr?.message}`)
  const tickerId = ticker.id as string

  const [eps, val, annual] = await Promise.all([
    provider.getQuarterlyEps(sym, 12),
    provider.getValuation(sym),
    provider.getAnnualFinancials(sym, 5),
  ])

  if (eps.length) {
    const { error } = await supabase.from('screener_quarterly_eps').upsert(
      eps.map((r) => ({
        ticker_id: tickerId,
        fiscal_period: r.fiscalPeriod,
        period_end: r.periodEnd,
        eps_actual: r.epsActual,
        eps_estimate: r.epsEstimate,
        revenue_actual: r.revenueActual,
        revenue_estimate: r.revenueEstimate,
        is_forecast: r.isForecast,
        source,
        fetched_at: now,
      })),
      { onConflict: 'ticker_id,fiscal_period' },
    )
    if (error) throw new Error(`Failed to upsert EPS for ${sym}: ${error.message}`)
  }

  {
    const { error } = await supabase.from('screener_valuation_snapshots').upsert(
      {
        ticker_id: tickerId,
        as_of: val.asOf,
        price: val.price,
        trailing_pe: val.trailingPe,
        forward_pe: val.forwardPe,
        net_margin_ttm: val.netMarginTtm,
        gross_margin_ttm: val.grossMarginTtm,
        operating_margin_ttm: val.operatingMarginTtm,
        roi_ttm: val.roiTtm,
        market_cap: val.marketCap,
        source,
        fetched_at: now,
      },
      { onConflict: 'ticker_id,as_of' },
    )
    if (error) throw new Error(`Failed to upsert valuation for ${sym}: ${error.message}`)
  }

  if (annual.length) {
    const { error } = await supabase.from('screener_annual_financials').upsert(
      annual.map((r) => ({
        ticker_id: tickerId,
        fiscal_year: r.fiscalYear,
        revenue: r.revenue,
        net_income: r.netIncome,
        source,
      })),
      { onConflict: 'ticker_id,fiscal_year' },
    )
    if (error) throw new Error(`Failed to upsert annuals for ${sym}: ${error.message}`)
  }

  // Purge any rows left behind by a previous provider. Mock and FMP derive
  // different fiscal_period / fiscal_year keys, so switching a ticker from the
  // demo provider to live FMP would otherwise orphan stale synthetic rows that
  // upsert never overwrites. Deleting everything not from the current source
  // guarantees a ticker's data is single-source (all real once on FMP).
  for (const table of [
    'screener_quarterly_eps',
    'screener_valuation_snapshots',
    'screener_annual_financials',
  ]) {
    const { error } = await supabase.from(table).delete().eq('ticker_id', tickerId).neq('source', source)
    if (error) throw new Error(`Failed to purge stale ${table} for ${sym}: ${error.message}`)
  }

  return { symbol: sym, tickerId, quarters: eps.length, annualYears: annual.length, asOf: val.asOf }
}

/** Refresh every active (non-deleted) ticker. Used by the Refresh-all button
 *  and the weekly cron. Sequential — the watchlist is tiny and this keeps us
 *  well inside provider rate limits. */
export async function ingestAllActive(): Promise<IngestResult[]> {
  const supabase = db()
  const { data, error } = await supabase
    .from('screener_tickers')
    .select('symbol')
    .eq('active', true)
    .is('deleted_at', null)
  if (error) throw new Error(`Failed to list active tickers: ${error.message}`)

  const results: IngestResult[] = []
  for (const row of (data ?? []) as { symbol: string }[]) {
    results.push(await ingestTicker(row.symbol))
  }
  return results
}
