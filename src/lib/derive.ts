// Derived readings shared by the dashboard table, the TripleQ scorer and the
// daily email. Each formula lived inline in exactly one component before a
// second consumer appeared; they live here now so the three surfaces cannot
// disagree about what "EPS CAGR 5yr" or "% from ATH" means.
//
// Every function returns null rather than a misleading number when an input is
// missing or would produce a division by zero — the same contract the signals
// engine follows.

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
