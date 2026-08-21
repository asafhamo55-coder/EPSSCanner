// The technical-chart calc engine — regression channel, pivot-based Fibonacci
// retracement, unfilled gaps, and the buy/fair/avoid verdict they imply. Pure
// functions, zero I/O, zero React: the cached server action and the ECharts UI
// both consume only what `analyze()` returns, so every formula lives here once.
//
// Verified in scripts/test-signals.ts.

import type { Bar } from '@/market-data/provider'

// ─── Constants (binding — see task-2 brief) ─────────────────────────
/** Bars needed before `VISIBLE_BARS` so the 150-day SMA is defined for every
 *  visible bar. Also the SMA period itself. */
export const WARMUP_BARS = 150
/** Bars actually charted. */
export const VISIBLE_BARS = 126
/** What the fetch layer should request: warmup + visible, no slack — Yahoo
 *  returns exactly what's asked and we slice locally. */
export const FETCH_BARS = WARMUP_BARS + VISIBLE_BARS
export const SMA_PERIOD = 150
/** Regression-channel half-width in standard deviations of the residuals. */
export const CHANNEL_SIGMA = 2
/** Verdict thresholds on `positionPct` (0..100 scale within the channel). */
export const DONT_BUY_PCT = 70
export const OPPORTUNITY_PCT = 30
/** Pivot confirmation window: a bar must beat `k` neighbors on each side. */
export const PIVOT_K = 5
/** Minimum high/low swing (%) for a pivot pair to anchor a Fib retracement. */
export const MIN_SWING_PCT = 5
export const FIB_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786] as const
/** Minimum gap size (%) to surface — smaller gaps are noise. */
export const GAP_MIN_PCT = 2
/** Below this many visible bars the regression channel is too short to trust. */
export const MIN_CHANNEL_BARS = 30

export type Verdict = 'dont-buy' | 'fair' | 'opportunity' | 'insufficient-history'

export interface Channel {
  upper: number[] // per visible bar
  mid: number[]
  lower: number[]
  slopePerDay: number
  positionPct: number // raw; MAY fall outside 0..100
}

export interface FibLevel {
  ratio: number
  price: number
}

export interface Fib {
  high: number
  low: number
  direction: 'rally' | 'decline'
  levels: FibLevel[]
  anchor: 'swing' | 'window' // 'window' = fallback, UI must label it
}

export interface Gap {
  fromT: number
  toT: number
  top: number
  bottom: number
  pct: number
  direction: 'up' | 'down'
  side: 'above' | 'below' // vs the latest close
}

export interface Technicals {
  visible: Bar[]
  sma150: (number | null)[] // aligned to visible; null until warmup satisfied
  channel: Channel | null
  fib: Fib | null
  gaps: Gap[]
  verdict: Verdict
  positionPct: number | null
}

// ─── SMA ─────────────────────────────────────────────────────────────
/**
 * Simple moving average of `.c` over `period` bars, one value per visible bar.
 * Visible index `i` maps to absolute index `a = bars.length - visibleCount + i`;
 * the window `bars[a-period+1 .. a]` must fully exist or the value is null
 * (warmup not yet satisfied), never a partial-window average.
 */
export function smaSeries(bars: Bar[], period: number, visibleCount: number): (number | null)[] {
  const out: (number | null)[] = new Array(visibleCount)
  const offset = bars.length - visibleCount
  for (let i = 0; i < visibleCount; i++) {
    const a = offset + i
    const start = a - period + 1
    if (start < 0) {
      out[i] = null
      continue
    }
    let sum = 0
    for (let j = start; j <= a; j++) sum += bars[j].c
    out[i] = sum / period
  }
  return out
}

// ─── Linear regression ───────────────────────────────────────────────
export interface LinregResult {
  slope: number
  intercept: number
  sigma: number
}

/** Least squares fit of `ys` over x = 0..n-1, plus the population standard
 *  deviation (÷n, not ÷n-1) of the residuals — that's the channel half-width
 *  before scaling by CHANNEL_SIGMA. Sample sigma would silently widen the
 *  rails and skew every verdict, so this must stay population. */
export function linreg(ys: number[]): LinregResult {
  const n = ys.length
  if (n === 0) return { slope: 0, intercept: 0, sigma: 0 }
  if (n === 1) return { slope: 0, intercept: ys[0], sigma: 0 }

  let sx = 0, sy = 0, sxy = 0, sxx = 0
  for (let i = 0; i < n; i++) {
    sx += i
    sy += ys[i]
    sxy += i * ys[i]
    sxx += i * i
  }
  const denom = n * sxx - sx * sx
  // denom is 0 only when n < 2, already handled above; guard anyway for safety.
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / n

  let sumSqResid = 0
  for (let i = 0; i < n; i++) {
    const resid = ys[i] - (intercept + slope * i)
    sumSqResid += resid * resid
  }
  const sigma = Math.sqrt(sumSqResid / n)

  return { slope, intercept, sigma }
}

// ─── Regression channel ──────────────────────────────────────────────
function buildChannel(visible: Bar[]): Channel | null {
  const n = visible.length
  if (n < MIN_CHANNEL_BARS) return null

  const closes = visible.map((b) => b.c)
  const { slope, intercept, sigma } = linreg(closes)

  const mid: number[] = new Array(n)
  const upper: number[] = new Array(n)
  const lower: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    mid[i] = intercept + slope * i
    upper[i] = mid[i] + CHANNEL_SIGMA * sigma
    lower[i] = mid[i] - CHANNEL_SIGMA * sigma
  }

  const lastClose = closes[n - 1]
  const width = upper[n - 1] - lower[n - 1]
  // Flat series (sigma 0) collapses the rails onto the mid — undefined ratio,
  // define as dead-center rather than propagate NaN/Infinity.
  const positionPct = width === 0 ? 50 : ((lastClose - lower[n - 1]) / width) * 100

  return { upper, mid, lower, slopePerDay: slope, positionPct }
}

// ─── Pivots ──────────────────────────────────────────────────────────
export interface Pivots {
  highs: number[]
  lows: number[]
}

/**
 * Confirmed swing points: bar `i` is a pivot high when `bars[i].h` strictly
 * beats every bar within `k` on each side (ties disqualify — an equal high
 * nearby means the swing isn't confirmed yet). Pivot low is the symmetric
 * strict minimum on `.l`. The last `k` bars can never be pivots — confirmation
 * needs `k` bars of future data, which they don't have yet.
 */
export function findPivots(bars: Bar[], k: number): Pivots {
  const highs: number[] = []
  const lows: number[] = []
  const n = bars.length
  for (let i = k; i < n - k; i++) {
    let isHigh = true
    let isLow = true
    const h = bars[i].h
    const l = bars[i].l
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue
      if (bars[j].h >= h) isHigh = false
      if (bars[j].l <= l) isLow = false
      if (!isHigh && !isLow) break
    }
    if (isHigh) highs.push(i)
    if (isLow) lows.push(i)
  }
  return { highs, lows }
}

// ─── Fibonacci retracement ───────────────────────────────────────────
/**
 * Anchors a retracement on the most recent confirmed pivot high/low pair when
 * they form a swing of at least MIN_SWING_PCT; otherwise falls back to the
 * visible window's raw high/low (`anchor: 'window'`) so the UI always has
 * something to draw, labeled as the weaker signal it is.
 */
export function computeFib(visible: Bar[]): Fib | null {
  if (visible.length < 2) return null

  const { highs, lows } = findPivots(visible, PIVOT_K)
  const lastHighIdx = highs.length ? highs[highs.length - 1] : null
  const lastLowIdx = lows.length ? lows[lows.length - 1] : null

  let picked: Omit<Fib, 'levels'> | null = null

  if (lastHighIdx != null && lastLowIdx != null) {
    const h = visible[lastHighIdx].h
    const l = visible[lastLowIdx].l
    const swingPct = (Math.abs(h - l) / l) * 100
    if (swingPct >= MIN_SWING_PCT) {
      picked = {
        high: h,
        low: l,
        // Direction compares recency (index), not which price is larger.
        direction: lastHighIdx > lastLowIdx ? 'rally' : 'decline',
        anchor: 'swing',
      }
    }
  }

  if (picked == null) {
    let hi = -Infinity, hiIdx = 0
    let lo = Infinity, loIdx = 0
    for (let i = 0; i < visible.length; i++) {
      if (visible[i].h > hi) { hi = visible[i].h; hiIdx = i }
      if (visible[i].l < lo) { lo = visible[i].l; loIdx = i }
    }
    picked = { high: hi, low: lo, direction: hiIdx > loIdx ? 'rally' : 'decline', anchor: 'window' }
  }

  const { high, low, direction } = picked
  const levels: FibLevel[] = FIB_LEVELS.map((ratio) => ({
    ratio,
    price: direction === 'rally' ? high - (high - low) * ratio : low + (high - low) * ratio,
  }))

  return { ...picked, levels }
}

// ─── Gaps ────────────────────────────────────────────────────────────
/**
 * Unfilled price gaps of at least GAP_MIN_PCT between adjacent bars. A gap is
 * "filled" the moment any later bar trades back through its far edge, at
 * which point it's no longer live and is dropped — only open gaps are useful
 * to a trader looking at the chart today.
 */
export function findGaps(visible: Bar[]): Gap[] {
  const lastClose = visible.length ? visible[visible.length - 1].c : 0
  const out: Gap[] = []

  for (let i = 1; i < visible.length; i++) {
    const prev = visible[i - 1]
    const cur = visible[i]

    let direction: 'up' | 'down' | null = null
    let top = 0
    let bottom = 0
    if (cur.l > prev.h) {
      direction = 'up'
      bottom = prev.h
      top = cur.l
    } else if (cur.h < prev.l) {
      direction = 'down'
      bottom = cur.h
      top = prev.l
    }
    if (direction == null) continue

    const pct = ((top - bottom) / bottom) * 100
    if (pct < GAP_MIN_PCT) continue

    let filled = false
    for (let j = i + 1; j < visible.length; j++) {
      if (direction === 'up' ? visible[j].l <= bottom : visible[j].h >= top) {
        filled = true
        break
      }
    }
    if (filled) continue

    const side: 'above' | 'below' = bottom > lastClose ? 'above' : 'below'
    out.push({ fromT: prev.t, toT: cur.t, top, bottom, pct, direction, side })
  }

  return out
}

// ─── Verdict ─────────────────────────────────────────────────────────
export function verdictFor(positionPct: number): Verdict {
  if (positionPct >= DONT_BUY_PCT) return 'dont-buy'
  if (positionPct <= OPPORTUNITY_PCT) return 'opportunity'
  return 'fair'
}

// ─── Entry point ─────────────────────────────────────────────────────
export function analyze(bars: Bar[]): Technicals {
  const visible = bars.length > VISIBLE_BARS ? bars.slice(-VISIBLE_BARS) : bars

  const sma150 = smaSeries(bars, SMA_PERIOD, visible.length)
  const channel = buildChannel(visible)
  const fib = computeFib(visible)
  const gaps = findGaps(visible)

  const positionPct = channel ? channel.positionPct : null
  const verdict: Verdict = channel ? verdictFor(channel.positionPct) : 'insufficient-history'

  return { visible, sma150, channel, fib, gaps, verdict, positionPct }
}
