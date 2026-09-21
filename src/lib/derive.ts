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

/** Minimum span, in years, between the nearest and farthest usable future
 *  estimate before a forward CAGR is trusted. Below this, a single volatile
 *  consensus jump (observed: one real ticker had only 1 usable year after
 *  filtering) would be mislabeled as a multi-year trend. */
const MIN_FORWARD_YEARS = 3

/** Forward EPS CAGR estimate, in percent, derived directly from consensus
 *  annual EPS estimates — NOT via PEG inversion like `epsCagr5yr` above.
 *  Used only as a fallback when PEG-based data is unavailable (Yahoo does
 *  not cover PEG for every name).
 *
 *  `estimates` — fiscal year end date ('YYYY-MM-DD') paired with consensus
 *  EPS for that year, in any order, from any provider (kept generic, no FMP
 *  type imported here — this file has no provider dependencies and should
 *  keep it that way).
 *
 *  Returns null when: fewer than 2 future years have a POSITIVE eps
 *  estimate (a loss-making base or terminal year makes a CAGR undefined or
 *  meaningless — same rule `posPe`/gate logic elsewhere in this codebase
 *  already applies to P/E), or when the usable span is under
 *  MIN_FORWARD_YEARS — a real fallback exists, but calling a 1-year
 *  consensus jump a multi-year trend would be a materially different,
 *  misleading claim. */
export function forwardEpsCagr(
  estimates: Array<{ date: string; eps: number | null | undefined }>,
  asOf: string,
): number | null {
  // Dedupe by date BEFORE sorting, averaging any duplicates.
  //
  // FMP can revise a fiscal year's consensus, producing two rows for the
  // same date — and there is no revision timestamp in this shape to prefer
  // one over the other by any principled rule. "Keep whichever one appears
  // last in the input" was tried first and rejected: that is STILL
  // order-dependent for the exact rows that collide, which a test caught by
  // reversing an array containing a duplicate and getting a different
  // answer. Averaging is genuinely order-independent — sum and count of a
  // multiset don't depend on which order its elements were seen in — and it
  // dampens one stale or erroneous duplicate rather than being swayed
  // entirely by whichever row happened to be seen last.
  const byDate = new Map<string, number[]>()
  for (const e of estimates) {
    if (e.date > asOf && isNum(e.eps) && e.eps > 0) {
      const vals = byDate.get(e.date) ?? []
      vals.push(e.eps)
      byDate.set(e.date, vals)
    }
  }
  const future = [...byDate.entries()]
    .map(([date, vals]) => ({ date, eps: vals.reduce((a, b) => a + b, 0) / vals.length }))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (future.length < 2) return null

  const base = future[0]
  const terminal = future[future.length - 1]
  const baseYear = Number(base.date.slice(0, 4))
  const terminalYear = Number(terminal.date.slice(0, 4))
  const years = terminalYear - baseYear
  // Number(date.slice(0,4)) silently returns NaN for a date string that
  // doesn't start with 4 digits — a caller violating the documented
  // 'YYYY-MM-DD' contract, but violating it should degrade to null, not
  // fail the years<MIN_FORWARD_YEARS guard OPEN (NaN < 3 is false) and
  // produce Math.pow(x, 1/NaN) = NaN, a value that is not a number this
  // function's own return type claims to allow.
  if (!Number.isFinite(years) || years < MIN_FORWARD_YEARS) return null

  return (Math.pow(terminal.eps / base.eps, 1 / years) - 1) * 100
}

/** `epsCagr5yr` widened with the forward-estimate fallback, in one place so
 *  the dashboard table, the digest email and any future consumer read this
 *  decision identically. Before this existed, `src/app/page.tsx` and
 *  `src/lib/digest.ts` each called `epsCagr5yr` directly and only the
 *  latter was updated to add `?? epsCagr5yrEst` — the exact kind of drift
 *  this file's own header comment says it exists to prevent: a mega cap
 *  with no Yahoo PEG data would score and email with a real CAGR (fallback
 *  applied) while the dashboard showed it as N/A (fallback missing) for the
 *  identical underlying number. */
export function epsCagr5yrWithFallback(
  trailingPe: number | null | undefined,
  peg5yr: number | null | undefined,
  epsCagr5yrEst: number | null | undefined,
): number | null {
  return epsCagr5yr(trailingPe, peg5yr) ?? epsCagr5yrEst ?? null
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
