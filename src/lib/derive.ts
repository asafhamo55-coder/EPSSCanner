// Derived readings shared by the dashboard table, the TripleQ scorer and the
// daily email. Each formula lived inline in exactly one component before a
// second consumer appeared; they live here now so the three surfaces cannot
// disagree about what "EPS CAGR 5yr" or "% from ATH" means.
//
// Every function returns null rather than a misleading number when an input is
// missing or would produce a division by zero — the same contract the signals
// engine follows.

import type { Bar } from '@/market-data/provider'

function isNum(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v)
}

/** Expected 5-year EPS CAGR, in percent. Trailing P/E ÷ PEG (5-yr expected) —
 *  the algebraic inverse of how PEG is defined, so it recovers the growth rate
 *  the PEG was built from. */
export function epsCagr5yr(
  trailingPe: number | null | undefined,
  peg5yr: number | null | undefined,
): number | null {
  if (!isNum(trailingPe) || !isNum(peg5yr) || peg5yr === 0) return null
  return trailingPe / peg5yr
}

/** Percent the current price sits below its all-time high. Zero means the
 *  stock is making new highs; the value is otherwise negative. */
export function pctFromAth(
  price: number | null | undefined,
  allTimeHigh: number | null | undefined,
): number | null {
  if (!isNum(price) || !isNum(allTimeHigh) || allTimeHigh === 0) return null
  return ((price - allTimeHigh) / allTimeHigh) * 100
}

/** Percent the current price sits above (+) or below (−) its 150-day SMA. */
export function vsSma150Pct(
  price: number | null | undefined,
  sma150: number | null | undefined,
): number | null {
  if (!isNum(price) || !isNum(sma150) || sma150 === 0) return null
  return ((price - sma150) / sma150) * 100
}

/** Percent change of the close over `lookback` trading days. Null when the
 *  series is too short — a shorter-than-requested window would silently
 *  report a different period than the label claims. */
export function priceChangePct(bars: Bar[], lookback: number): number | null {
  if (bars.length <= lookback || lookback < 1) return null
  const now = bars[bars.length - 1].c
  const then = bars[bars.length - 1 - lookback].c
  if (!isNum(now) || !isNum(then) || then === 0) return null
  return ((now - then) / then) * 100
}

export interface PriceRange {
  high: number
  low: number
  /** Last close vs the range high, percent (≤ 0). */
  pctFromHigh: number
  /** Last close vs the range low, percent (≥ 0). */
  pctFromLow: number
}

/** High/low across the whole supplied series, with the last close's distance
 *  from each. Callers should pass ~252 bars (one year of trading days), not
 *  the 126-bar visible window (which would understate the labelled
 *  "52-week range" by half a year) and not the full ~276-bar fetched window
 *  either (WARMUP_BARS + VISIBLE_BARS in technicals.ts, which pads roughly
 *  a month of SMA warmup ahead of the visible window and would overstate it
 *  by about a month) — a "52-week range" computed over a different span
 *  would be a different statistic wearing the same label. See
 *  technicals.ts's `analyze()`, which slices the fetched series to the
 *  trailing 252 bars before calling this. */
export function fiftyTwoWeekRange(bars: Bar[]): PriceRange | null {
  if (bars.length === 0) return null
  let high = -Infinity
  let low = Infinity
  for (const b of bars) {
    if (b.h > high) high = b.h
    if (b.l < low) low = b.l
  }
  const close = bars[bars.length - 1].c
  if (!isNum(high) || !isNum(low) || high === 0 || low === 0) return null
  return {
    high,
    low,
    pctFromHigh: ((close - high) / high) * 100,
    pctFromLow: ((close - low) / low) * 100,
  }
}

/** Latest reported EPS against consensus, in percent. Uses the absolute
 *  estimate as the denominator so a negative-estimate quarter still reports a
 *  correctly-signed surprise rather than an inverted one. */
export function epsSurprisePct(
  actual: number | null | undefined,
  estimate: number | null | undefined,
): number | null {
  if (!isNum(actual) || !isNum(estimate) || estimate === 0) return null
  return ((actual - estimate) / Math.abs(estimate)) * 100
}
