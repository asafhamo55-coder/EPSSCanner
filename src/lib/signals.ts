// The methodology calc engine — five pure, fully-tested signals. No I/O, no
// provider, no DB. The /api/ingest path and the dashboard both compute signals
// from already-persisted rows through these functions, so the formulas live in
// exactly one place and the edge cases (turnaround, missing forward P/E,
// short history) are handled once.
//
// Verified against the deck's NVDA numbers in scripts/test-screener-signals.ts.

/** QoQ-slope regression window (step 4). Config, not schema — widen to 8/12
 *  as history accumulates without touching the data model. */
export const QOQ_WINDOW = 4

/** Trailing-P/E reasonableness band (step 1). */
export const PE_BAND = { low: 20, high: 30 } as const

export type SignalState = 'pass' | 'flag' | 'fail' | 'na' | 'turnaround'
export type TrendLabel = 'accelerating' | 'flat' | 'decelerating' | 'na'

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

// ─── Step 1 — P/E reasonableness ────────────────────────────────────
export interface PeSignal {
  trailingPe: number | null
  inBand: boolean
  premiumFlag: boolean
  state: SignalState
}

export function peReasonableness(trailingPe: number | null | undefined): PeSignal {
  if (!isNum(trailingPe) || trailingPe <= 0) {
    return { trailingPe: trailingPe ?? null, inBand: false, premiumFlag: false, state: 'na' }
  }
  const inBand = trailingPe >= PE_BAND.low && trailingPe <= PE_BAND.high
  const premiumFlag = trailingPe > PE_BAND.high
  // In band → pass; premium → flag (only "justified" if growth is high, judged
  // by the human against steps 3/5); below band → flag (cheap, but why?).
  const state: SignalState = inBand ? 'pass' : 'flag'
  return { trailingPe, inBand, premiumFlag, state }
}

// ─── Step 2 — Trend of fundamentals (5 yr) ──────────────────────────
export interface FundamentalsSignal {
  revenueGrowing: boolean | null
  netIncomeGrowing: boolean | null
  netMarginTtm: number | null
  state: SignalState
}

export function fundamentalsTrend(input: {
  revenueGrowing: boolean | null
  netIncomeGrowing: boolean | null
  netMarginTtm: number | null
  yearsOnFile?: number | null
}): FundamentalsSignal {
  const { revenueGrowing, netIncomeGrowing, netMarginTtm } = input
  const years = input.yearsOnFile ?? null
  if ((years != null && years < 2) || revenueGrowing == null || netIncomeGrowing == null) {
    return { revenueGrowing, netIncomeGrowing, netMarginTtm: netMarginTtm ?? null, state: 'na' }
  }
  const state: SignalState =
    revenueGrowing && netIncomeGrowing ? 'pass' : revenueGrowing || netIncomeGrowing ? 'flag' : 'fail'
  return { revenueGrowing, netIncomeGrowing, netMarginTtm: netMarginTtm ?? null, state }
}

// ─── Step 3 — YoY EPS growth (backward) ─────────────────────────────
export interface YoySignal {
  epsQ: number | null
  epsQ4: number | null
  ratio: number | null
  pct: number | null
  state: SignalState
}

/** eps[Q] / eps[Q-4]. Returns `turnaround` on a loss→profit sign change and
 *  `na` when the prior-year quarter is missing — never a misleading ratio. */
export function yoyGrowth(epsQ: number | null | undefined, epsQ4: number | null | undefined): YoySignal {
  if (!isNum(epsQ) || !isNum(epsQ4)) {
    return { epsQ: epsQ ?? null, epsQ4: epsQ4 ?? null, ratio: null, pct: null, state: 'na' }
  }
  // Prior-year EPS <= 0: the ratio is meaningless. A strictly-negative prior
  // with a positive current is a genuine loss→profit turnaround; a zero base
  // (breakeven) has no defined growth, so it degrades to n/a.
  if (epsQ4 <= 0) {
    const state: SignalState = epsQ4 < 0 && epsQ > 0 ? 'turnaround' : 'na'
    return { epsQ, epsQ4, ratio: null, pct: null, state }
  }
  const ratio = epsQ / epsQ4
  const pct = (ratio - 1) * 100
  // > +20% YoY is a strong pass; positive-but-soft flags; contraction fails.
  const state: SignalState = pct >= 20 ? 'pass' : pct >= 0 ? 'flag' : 'fail'
  return { epsQ, epsQ4, ratio, pct, state }
}

// ─── Step 4 — QoQ EPS delta trend (accel / decel) ───────────────────
export interface QoqSignal {
  deltas: number[]
  slope: number | null
  label: TrendLabel
  state: SignalState
}

/** Least-squares slope of y over x = 0..n-1. */
function linregSlope(y: number[]): number | null {
  const n = y.length
  if (n < 2) return null
  let sx = 0, sy = 0, sxy = 0, sxx = 0
  for (let i = 0; i < n; i++) {
    sx += i
    sy += y[i]
    sxy += i * y[i]
    sxx += i * i
  }
  const denom = n * sxx - sx * sx
  if (denom === 0) return null
  return (n * sxy - sx * sy) / denom
}

/**
 * Slope of the last `window` QoQ deltas. `deltas` is the full ordered series
 * (oldest→newest) of eps[i] - eps[i-1]. A clearly negative slope =
 * decelerating, clearly positive = accelerating, near-zero = flat. The
 * threshold scales with the magnitude of the deltas so it works across tickers
 * of different EPS scale.
 */
export function qoqTrend(deltas: number[], window: number = QOQ_WINDOW): QoqSignal {
  const recent = deltas.slice(-window)
  const slope = linregSlope(recent)
  if (slope == null) {
    return { deltas: recent, slope: null, label: 'na', state: 'na' }
  }
  const avgMag = recent.reduce((s, d) => s + Math.abs(d), 0) / recent.length || 1
  const threshold = 0.08 * avgMag // 8% of typical delta = "flat" dead-band
  let label: TrendLabel
  let state: SignalState
  if (slope > threshold) {
    label = 'accelerating'
    state = 'pass'
  } else if (slope < -threshold) {
    label = 'decelerating'
    state = 'fail'
  } else {
    label = 'flat'
    state = 'flag'
  }
  return { deltas: recent, slope, label, state }
}

/** Helper: build the QoQ delta series from an ordered EPS-actual series. */
export function qoqDeltas(epsSeries: Array<number | null>): number[] {
  const out: number[] = []
  for (let i = 1; i < epsSeries.length; i++) {
    const a = epsSeries[i]
    const b = epsSeries[i - 1]
    if (isNum(a) && isNum(b)) out.push(a - b)
  }
  return out
}

// ─── Step 5 — Forward growth via P/E ratio ──────────────────────────
export interface FwdSignal {
  trailingPe: number | null
  forwardPe: number | null
  ratio: number | null
  pct: number | null
  fwdAnnualEps: number | null
  state: SignalState
}

/** trailing ÷ forward P/E = expected EPS-growth ratio (= EPS_fwd / EPS_ttm).
 *  Returns `na` when forward P/E is missing — scorecard degrades gracefully. */
export function fwdGrowth(
  trailingPe: number | null | undefined,
  forwardPe: number | null | undefined,
  price: number | null | undefined,
): FwdSignal {
  const fwdAnnualEps = isNum(price) && isNum(forwardPe) && forwardPe > 0 ? price / forwardPe : null
  if (!isNum(trailingPe) || !isNum(forwardPe) || forwardPe <= 0) {
    return {
      trailingPe: trailingPe ?? null,
      forwardPe: forwardPe ?? null,
      ratio: null,
      pct: null,
      fwdAnnualEps,
      state: 'na',
    }
  }
  const ratio = trailingPe / forwardPe
  const pct = (ratio - 1) * 100
  const state: SignalState = pct >= 15 ? 'pass' : pct >= 0 ? 'flag' : 'fail'
  return { trailingPe, forwardPe, ratio, pct, fwdAnnualEps, state }
}

// ─── Composite scorecard ────────────────────────────────────────────
export interface Scorecard {
  pe: PeSignal
  fundamentals: FundamentalsSignal
  yoy: YoySignal
  qoq: QoqSignal
  fwd: FwdSignal
  /** Count of the five steps in a 'pass' or 'turnaround' state. */
  passing: number
  /** Steps with a usable (non-na) reading. */
  scored: number
}

export interface ScorecardInput {
  trailingPe: number | null
  forwardPe: number | null
  price: number | null
  netMarginTtm: number | null
  revenueGrowing: boolean | null
  netIncomeGrowing: boolean | null
  yearsOnFile: number | null
  epsSeries: Array<number | null> // ordered oldest→newest actuals
}

/** Soft composite — counts passing signals. No hard buy/avoid verdict: we
 *  show the five chips and let the human decide (BarBGate no-overclaim). */
export function buildScorecard(input: ScorecardInput): Scorecard {
  const series = input.epsSeries
  const epsQ = series.length ? series[series.length - 1] : null
  const epsQ4 = series.length >= 5 ? series[series.length - 5] : null

  const pe = peReasonableness(input.trailingPe)
  const fundamentals = fundamentalsTrend({
    revenueGrowing: input.revenueGrowing,
    netIncomeGrowing: input.netIncomeGrowing,
    netMarginTtm: input.netMarginTtm,
    yearsOnFile: input.yearsOnFile,
  })
  const yoy = yoyGrowth(epsQ, epsQ4)
  const qoq = qoqTrend(qoqDeltas(series))
  const fwd = fwdGrowth(input.trailingPe, input.forwardPe, input.price)

  const states = [pe.state, fundamentals.state, yoy.state, qoq.state, fwd.state]
  const passing = states.filter((s) => s === 'pass' || s === 'turnaround').length
  const scored = states.filter((s) => s !== 'na').length

  return { pe, fundamentals, yoy, qoq, fwd, passing, scored }
}
