import { getProvider } from '@/market-data'
import { db } from './db'

// Idempotent ingest for one ticker: pull from the active provider and upsert
// into the screener_* tables. Upsert targets — (symbol), (ticker_id,
// fiscal_period), (ticker_id, as_of), (ticker_id, fiscal_year) — mean
// re-running never duplicates, and estimates get overwritten by actuals when
// earnings land. Called by /api/ingest, the server actions, and (via HTTP) the
// Inngest weekly cron.

// Mirrors getProvider(): mock/yahoo/fmp when explicit, else FMP if a key is
// configured otherwise keyless Yahoo. Kept in sync so the stale-source purge
// labels rows with the provider that actually produced them.
function sourceName(): string {
  const choice = process.env.MARKET_DATA_PROVIDER?.toLowerCase()
  if (choice === 'mock') return 'mock'
  if (choice === 'yahoo') return 'yahoo'
  if (choice === 'fmp') return 'fmp'
  return process.env.MARKET_DATA_FMP_API_KEY ? 'fmp' : 'yahoo'
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

  const [epsRaw, val, annualRaw] = await Promise.all([
    provider.getQuarterlyEps(sym, 12),
    provider.getValuation(sym),
    provider.getAnnualFinancials(sym, 5),
  ])

  // Collapse rows that map to the same fiscal_period — report-date-derived
  // labels can collide (e.g. two filings in one calendar quarter), and a batch
  // upsert with a duplicate conflict key errors with "ON CONFLICT ... cannot
  // affect row a second time". Prefer an actual over a forecast; otherwise keep
  // the later row (the provider returns them oldest→newest).
  const epsByPeriod = new Map<string, (typeof epsRaw)[number]>()
  for (const r of epsRaw) {
    const prev = epsByPeriod.get(r.fiscalPeriod)
    if (!prev || (prev.isForecast && !r.isForecast) || prev.isForecast === r.isForecast) {
      epsByPeriod.set(r.fiscalPeriod, r)
    }
  }
  const eps = [...epsByPeriod.values()]

  // Same guard for annual rows keyed by fiscal_year.
  const annualByYear = new Map<number, (typeof annualRaw)[number]>()
  for (const r of annualRaw) annualByYear.set(r.fiscalYear, r)
  const annual = [...annualByYear.values()]

  // Trailing P/E fallback: when the provider has none (negative GAAP earnings,
  // so Yahoo reports null / FMP a negative ratio that we clamp away), derive it
  // from price ÷ adjusted TTM EPS — the same epsActual the YoY/QoQ signals use.
  // Gives a sensible positive P/E for near-breakeven names instead of N/A.
  let trailingPe = val.trailingPe
  if (trailingPe == null && val.price != null) {
    const ttmEps = eps
      .filter((e) => !e.isForecast && e.epsActual != null)
      .slice(-4)
      .reduce((sum, e) => sum + (e.epsActual as number), 0)
    if (ttmEps > 0) trailingPe = Math.round((val.price / ttmEps) * 100) / 100
  }

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
        trailing_pe: trailingPe,
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

    // peg_5yr is an additive column (migration 0028). Set it best-effort and
    // ignore the error if the migration hasn't been applied yet, so ingest
    // keeps working either way.
    if (val.peg5yr != null) {
      await supabase
        .from('screener_valuation_snapshots')
        .update({ peg_5yr: val.peg5yr })
        .eq('ticker_id', tickerId)
        .eq('as_of', val.asOf)
    }
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
