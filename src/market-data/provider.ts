// DataProvider — the single seam between the screener's calc engine and
// whatever upstream API supplies fundamentals. FMP is the v1 implementation
// (see providers/fmp.ts); a deterministic fixture provider (providers/mock.ts)
// backs tests and offline dev. Adding Finnhub / yfinance later means writing a
// new implementer of this interface — the signals engine never changes.

/** One quarter of EPS + revenue. `is_forecast` marks consensus estimates
 *  (the next 1–2 quarters) vs reported actuals. */
export interface EpsRow {
  fiscalPeriod: string // '2026Q1' — provider fiscal period, NOT calendar
  periodEnd: string // ISO date 'YYYY-MM-DD'
  epsActual: number | null
  epsEstimate: number | null
  revenueActual: number | null
  revenueEstimate: number | null
  isForecast: boolean
}

/** Point-in-time valuation + TTM margins for steps 1 and 5. */
export interface ValuationSnapshot {
  asOf: string // ISO date
  price: number | null
  trailingPe: number | null
  forwardPe: number | null
  /** PEG ratio (5-yr expected). Trailing P/E ÷ this ≈ expected EPS CAGR %. */
  peg5yr: number | null
  /** Forward EPS CAGR estimate (%), derived directly from consensus annual
   *  EPS estimates — see forwardEpsCagr in derive.ts. A SEPARATE estimate
   *  from peg5yr-derived CAGR, not a replacement: only used as a fallback
   *  when peg5yr is unavailable (see digest.ts's epsCagr5yr call site). */
  epsCagr5yrEst: number | null
  netMarginTtm: number | null
  grossMarginTtm: number | null
  operatingMarginTtm: number | null
  roiTtm: number | null
  marketCap: number | null
}

/** One fiscal year of the income statement for step 2's 5-year trend. */
export interface AnnualRow {
  fiscalYear: number
  revenue: number | null
  netIncome: number | null
}

/** One daily OHLC bar. `t` is a unix-seconds timestamp (Yahoo's native form). */
export interface Bar {
  t: number
  o: number
  h: number
  l: number
  c: number
}

export interface DataProvider {
  /** Symbol display name + currency, for the watchlist row header. */
  getProfile(symbol: string): Promise<{ name: string | null; currency: string | null }>
  /** `quarters` actual quarters + however many estimate quarters the provider returns. */
  getQuarterlyEps(symbol: string, quarters: number): Promise<EpsRow[]>
  getValuation(symbol: string): Promise<ValuationSnapshot>
  /** Cheap refresh for names that are not scoring candidates.
   *
   *  Same shape as getValuation, but built from the fewest provider requests
   *  that keep a watchlist row whole: price, market cap, margins, and the
   *  P/E family. Skips whatever only matters for SCORING a candidate.
   *
   *  Exists because the full path costs seven provider requests per ticker
   *  and most of the watchlist can never clear the market-cap gate — a
   *  ~$50B name is not crossing $400B overnight, so paying for its analyst
   *  estimates and five years of income statements every morning is waste
   *  that was exhausting the daily quota. */
  getValuationLight(symbol: string): Promise<ValuationSnapshot>
  getAnnualFinancials(symbol: string, years: number): Promise<AnnualRow[]>
}

/** Thrown for upstream failures so the ingest path can label the snapshot
 *  source / surface a useful toast instead of a raw fetch error. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly symbol: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
