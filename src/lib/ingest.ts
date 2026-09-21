import { getProvider } from '@/market-data'
import type { AnnualRow, EpsRow, ValuationSnapshot } from '@/market-data/provider'
import { MIN_MARKET_CAP } from './score'
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

/** A ticker that could not be refreshed this run. Surfaced rather than
 *  swallowed: the whole hazard of making per-ticker failure non-fatal is that
 *  a partial refresh looks exactly like a complete one, so every caller gets
 *  told which symbols are stale and why. */
export interface IngestFailure {
  symbol: string
  error: string
}

export interface IngestResult {
  symbol: string
  tickerId: string
  quarters: number
  annualYears: number
  asOf: string
}

/** `light` trades completeness for provider requests: two FMP calls plus the
 *  keyless Yahoo one, instead of seven FMP calls. Used for watchlist names
 *  whose last known market cap puts them nowhere near the entry gate — see
 *  ingestAllActive's tiering. */
export async function ingestTicker(symbol: string, light = false): Promise<IngestResult> {
  const sym = symbol.trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) {
    throw new Error(`Invalid ticker symbol: "${symbol}"`)
  }

  const provider = getProvider()
  const supabase = db()
  const source = sourceName()
  const now = new Date().toISOString()

  // A company's name and currency do not change, and the row on file already
  // carries them, so the light path skips this request entirely.
  const profile = light
    ? null
    : await provider
        .getProfile(sym)
        .catch(() => ({ name: null, currency: 'USD' as string | null }))

  // Upsert the ticker (un-deletes a previously removed symbol).
  //
  // `name`/`currency` are omitted entirely on the light path rather than sent
  // as null: this is an upsert, so writing null would BLANK the name of every
  // ticker the light path touches — most of the watchlist, every day.
  const { data: ticker, error: tErr } = await supabase
    .from('screener_tickers')
    .upsert(
      {
        symbol: sym,
        ...(profile ? { name: profile.name, currency: profile.currency ?? 'USD' } : {}),
        active: true,
        deleted_at: null,
      },
      { onConflict: 'symbol' },
    )
    .select('id')
    .single()
  if (tErr || !ticker) throw new Error(`Failed to upsert ticker ${sym}: ${tErr?.message}`)
  const tickerId = ticker.id as string

  // The light path fetches the valuation alone. EPS history and annual
  // financials are neither refetched nor overwritten — the rows already on
  // file simply stand, so nothing is blanked. They age until the name is
  // promoted back to the full path, which is the correct trade for a company
  // that cannot currently clear the market-cap gate.
  const [epsRaw, val, annualRaw]: [EpsRow[], ValuationSnapshot, AnnualRow[]] = light
    ? [[], await provider.getValuationLight(sym), []]
    : await Promise.all([
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

  // Trailing P/E stays N/A for loss-makers (negative GAAP earnings). Yahoo's
  // website P/E for such names (e.g. INTC 904.17) is built from a proprietary
  // normalized-earnings figure that no data feed exposes, so it can't be
  // reproduced; N/A matches the "--" Yahoo itself shows in most periods.
  const trailingPe = val.trailingPe

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

    // eps_cagr_5yr_est is an additive column (migration 0032). Set it
    // best-effort and ignore the error if the migration hasn't been applied
    // yet, so ingest keeps working either way.
    if (val.epsCagr5yrEst != null) {
      await supabase
        .from('screener_valuation_snapshots')
        .update({ eps_cagr_5yr_est: val.epsCagr5yrEst })
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

/** What one refresh produced: the tickers that succeeded, and the ones that
 *  did not. (The "sequential — the watchlist is tiny" note that used to sit
 *  here described a loop that was removed once it started timing the cron
 *  out; see the tiering and concurrency notes below.) */
export interface IngestRun {
  results: IngestResult[]
  failures: IngestFailure[]
  /** Tickers never attempted because the deadline passed first. Distinct
   *  from `failures`, which WERE attempted and errored — the difference
   *  matters when reading a cron's output: skipped means "ran out of time",
   *  failed means "the provider said no". */
  skipped: string[]
  /** How many of `results` took the cheap path — see FULL_REFRESH_FLOOR. */
  light: number
}

/** How many tickers ingest in parallel. Deliberately modest: every worker is
 *  a separate fundamentals-provider round trip, and the provider's rate limit
 *  — not this function — is the binding constraint on raising it. Five is
 *  enough to bring a ~100-ticker refresh from ~60s (the sequential cost that
 *  was timing the cron out) to roughly a fifth of that, while staying well
 *  under the concurrency the Yahoo-backed paths in this codebase already use
 *  (WARM_CONCURRENCY is 8). Raise only with evidence from provider responses,
 *  not by assumption: a 429 storm degrades the refresh far worse than a slow
 *  one. */
const INGEST_CONCURRENCY = 4

/** Last-known market cap at or above which a ticker earns the full seven-
 *  request refresh.
 *
 *  Set below MIN_MARKET_CAP on purpose. The gate itself is $400B; this floor
 *  is 10% under it, so a company climbing toward the threshold is already on
 *  the full path — with complete EPS history and estimates — by the time it
 *  actually crosses, rather than qualifying on the day and being rejected for
 *  data nobody fetched. Names below the floor still get their market cap
 *  refreshed every run, so nothing can hide under it for more than a day. */
const FULL_REFRESH_FLOOR = MIN_MARKET_CAP * 0.9

export async function ingestAllActive(deadline?: number): Promise<IngestRun> {
  const supabase = db()
  const { data, error } = await supabase
    .from('screener_tickers')
    .select('id, symbol')
    .eq('active', true)
    .is('deleted_at', null)
  if (error) throw new Error(`Failed to list active tickers: ${error.message}`)

  const tickers = (data ?? []) as { id: string; symbol: string }[]
  const all = tickers.map((r) => r.symbol)

  // Decide per ticker how much data to buy for it, from the market cap
  // already on file.
  //
  // The full path is seven provider requests; across ~70 names that is ~490 a
  // day, which is what exhausted the quota and left mega caps rejected for
  // want of data. But most of the watchlist can never clear the entry gate —
  // a $50B company is not crossing $400B overnight — so the expensive half of
  // those requests bought nothing. Market cap is stable enough day to day to
  // decide this from yesterday's number.
  //
  // ONE query, not one per ticker: screener_latest_valuation is already a
  // DISTINCT ON (ticker_id) view over the snapshots.
  const { data: caps } = await supabase
    .from('screener_latest_valuation')
    .select('ticker_id, market_cap')
  const capByTicker = new Map(
    ((caps ?? []) as { ticker_id: string; market_cap: number | null }[]).map((c) => [
      c.ticker_id,
      c.market_cap,
    ]),
  )
  const lightSymbols = new Set(
    tickers
      .filter((t) => {
        const cap = capByTicker.get(t.id)
        // Unknown cap ⇒ full path. A ticker that has never been ingested has
        // no basis for the cheap decision, and getting a new symbol wrong is
        // worse than paying for it once.
        return cap != null && cap < FULL_REFRESH_FLOOR
      })
      .map((t) => t.symbol),
  )

  // Rotate the starting point by the day of the year.
  //
  // The query returns symbols in a stable order, and the deadline below cuts
  // the run off at whatever it has reached. Without this rotation the SAME
  // tail is truncated every single day — those tickers would never refresh
  // again, and nothing would report it as anything worse than the `skipped`
  // count a truncated run always has. Rotating spreads the truncation so
  // every symbol reaches the front of the queue within a full cycle.
  const dayOfYear = Math.floor(
    (Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86_400_000,
  )
  const offset = all.length > 0 ? dayOfYear % all.length : 0
  const symbols = [...all.slice(offset), ...all.slice(0, offset)]

  // Bounded concurrency AND a deadline — neither of which this had.
  //
  // This was `for (…) results.push(await ingestTicker(…))` — one provider
  // round trip at a time across every active ticker. At ~100 tickers that is
  // the entire 60s `maxDuration` of the cron that calls it, on its own, and
  // it is why /api/ingest began returning FUNCTION_INVOCATION_TIMEOUT once a
  // preparation phase was added after it. Nothing about the work requires
  // ordering: each ingestTicker upserts its own rows keyed by symbol.
  //
  // Per-ticker failure is non-fatal, which IS a change from the sequential
  // loop — that had no catch, so a single provider error aborted the entire
  // refresh and propagated to the caller. Observed in production: one
  // `FMP /ratios-ttm → 429` discarded ~100 tickers' worth of work that had
  // already succeeded. Rate limiting is per-request and transient, and the
  // right blast radius for it is one symbol, not the whole day.
  //
  // The hazard this introduces is that a partial refresh looks identical to
  // a complete one, so it is deliberately not silent: failures are logged
  // with their symbols and returned to the caller, which reports them in the
  // cron's response body.
  //
  // Result ORDER is no longer symbol order. The only consumers are
  // `results.length` and `results.map(r => r.symbol)` for cache warming,
  // neither of which depends on it.
  const results: IngestResult[] = []
  const failures: IngestFailure[] = []
  const skipped: string[] = []
  let next = 0
  const worker = async () => {
    for (let i = next++; i < symbols.length; i = next++) {
      // Stop STARTING new tickers past the deadline; one already in flight
      // finishes. Same shape as warmTechnicals and renderCharts.
      if (deadline != null && Date.now() > deadline) {
        skipped.push(symbols[i])
        continue
      }
      try {
        results.push(await ingestTicker(symbols[i], lightSymbols.has(symbols[i])))
      } catch (e) {
        failures.push({ symbol: symbols[i], error: (e as Error).message })
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(INGEST_CONCURRENCY, symbols.length) }, worker),
  )
  if (failures.length > 0) {
    console.error(
      `[ingest] ${failures.length} of ${symbols.length} ticker(s) failed: ` +
        failures.map((f) => `${f.symbol} (${f.error})`).join(', '),
    )
  }
  if (skipped.length > 0) {
    console.warn(
      `[ingest] deadline hit — refreshed ${results.length}, skipped ${skipped.length} of ${symbols.length}`,
    )
  }
  console.log(
    `[ingest] ${results.length} refreshed — ${symbols.length - lightSymbols.size} full, ` +
      `${lightSymbols.size} light (below $${(FULL_REFRESH_FLOOR / 1e9).toFixed(0)}B); ` +
      `~${(symbols.length - lightSymbols.size) * 7 + lightSymbols.size * 2} provider requests ` +
      `vs ${symbols.length * 7} before tiering`,
  )
  return { results, failures, skipped, light: lightSymbols.size }
}
