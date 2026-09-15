// The TripleQ Score — which watchlist names go in the daily email, and in what
// order.
//
// Two layers, and the distinction matters:
//
//   GATES are the entry criteria. They are binary and absolute: a name that
//   fails one is not in the running no matter how well it scores elsewhere.
//   They answer "is this the kind of company we buy at all?".
//
//   FACTORS answer "and is today a good day to buy it?". They are continuous,
//   weighted, and sum to 100. A name must clear MIN_SCORE to be emailed even
//   if the list would otherwise come up short — a thin list is honest, a
//   padded one is not.
//
// Pure: no I/O, no React, no dates. Verified in scripts/test-signals.ts.

// Note: `epsCagr5yr` is NOT imported here. It is derived by the caller (see
// src/lib/digest.ts) and arrives on ScoreInput already computed, because the
// scorer must not know that the CAGR happens to come from a PEG ratio.
import { pctFromAth, vsSma150Pct } from './derive'
import { retracementRatio, type Technicals } from './technicals'
import type { SignalState } from './signals'

// ─── Tuning block — every threshold in the model lives here ─────────
/** Entry gate: mega caps only. Inclusive. */
export const MIN_MARKET_CAP = 500e9
/** A pick must score at least this to be emailed, even if that shortens the list. */
export const MIN_SCORE = 50
/** Hard cap on the list length. */
export const MAX_PICKS = 10

/** Points available per factor. Must sum to 100. */
export const WEIGHTS = {
  growth: 30,
  sma: 20,
  tunnel: 20,
  golden: 15,
  drawdown: 15,
} as const

/** Growth percentage that earns a growth sub-factor its full share. */
export const GROWTH_FULL_PCT = 30
/** Distance from the 150-day SMA (percent, either side) at which proximity scores zero. */
export const SMA_ZERO_AT_PCT = 15

/** Golden-zone credit as a function of retracement ratio. Full inside the
 *  classic 0.5–0.618 buy-the-dip band, tapering to nothing at the shallow
 *  (0.236) and deep (0.786) ends. */
export const GOLDEN_KNOTS: ReadonlyArray<readonly [number, number]> = [
  [0.236, 0],
  [0.5, 1],
  [0.618, 1],
  [0.786, 0],
]

/** Drawdown credit as a function of percent below the all-time high. A name at
 *  its high has no room and earns nothing; a genuine -25% to -30% pullback is
 *  the sweet spot; past -45% the trend is broken rather than discounted. */
export const DRAWDOWN_KNOTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [8, 0.4],
  [25, 1],
  [30, 1],
  [45, 0],
]

// ─── Types ──────────────────────────────────────────────────────────
export interface ScoreInput {
  symbol: string
  name: string | null
  price: number | null
  marketCap: number | null
  trailingPe: number | null
  sma150: number | null
  allTimeHigh: number | null
  yoyPct: number | null
  yoyState: SignalState
  ntmPct: number | null
  ntmState: SignalState
  epsCagr5yr: number | null
  technicals: Technicals | null
}

export type GateKey = 'megacap' | 'yoy' | 'ntm' | 'cagr' | 'belowAth'
export type FactorKey = 'growth' | 'sma' | 'tunnel' | 'golden' | 'drawdown'

export interface GateResult {
  key: GateKey
  label: string
  passed: boolean
  /** Human-readable value that decided it, for the preview and any debug view. */
  detail: string
}

export interface FactorScore {
  key: FactorKey
  label: string
  points: number
  max: number
  detail: string
}

export interface Evaluation {
  input: ScoreInput
  gates: GateResult[]
  passedGates: boolean
  factors: FactorScore[]
  /** 0–100, rounded to one decimal. Only meaningful when passedGates is true. */
  score: number
  reasons: string[]
}

export interface ScoredPick extends Evaluation {
  symbol: string
  name: string | null
  price: number | null
  marketCap: number | null
  trailingPe: number | null
  vsSma150Pct: number | null
  pctFromAth: number | null
  positionPct: number | null
  retracement: number | null
  yoyPct: number | null
  ntmPct: number | null
  epsCagr5yr: number | null
}

export interface Selection {
  picks: ScoredPick[]
  /** How many tickers were fed in. */
  considered: number
  /** How many PASSED every gate but fell below MIN_SCORE. Named for what it
   *  counts, not the mechanism — "gated" read as the opposite of what it
   *  measures (names that cleared the gates, not names the gates stopped). */
  belowCutoff: number
}

// ─── Curve helpers ──────────────────────────────────────────────────
function isNum(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v)
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Piecewise-linear interpolation through `knots` (ascending x). Outside the
 *  first and last knot the result is 0 — every curve in this model is a band
 *  with a defined domain, and "outside the band" always means no credit. */
export function piecewise(x: number, knots: ReadonlyArray<readonly [number, number]>): number {
  if (!Number.isFinite(x) || knots.length === 0) return 0
  if (x < knots[0][0] || x > knots[knots.length - 1][0]) return 0
  for (let i = 1; i < knots.length; i++) {
    const [x0, y0] = knots[i - 1]
    const [x1, y1] = knots[i]
    if (x <= x1) {
      if (x1 === x0) return y1
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
  }
  return knots[knots.length - 1][1]
}

/** Linear 0→1 credit for a growth percentage, full at GROWTH_FULL_PCT. */
function growthUnit(pct: number | null): number {
  if (!isNum(pct) || pct <= 0) return 0
  return clamp(pct / GROWTH_FULL_PCT, 0, 1)
}

function fmtPct(v: number | null, digits = 1): string {
  return isNum(v) ? `${v > 0 ? '+' : ''}${v.toFixed(digits)}%` : 'n/a'
}

// ─── Gates ──────────────────────────────────────────────────────────
/** Green means a real, positive, measurable growth rate. A 'turnaround' state
 *  carries a null percentage — loss→profit has no defined growth rate — so it
 *  is not green here. The model ranks on magnitude and cannot rank an
 *  undefined one. */
function isGreen(pct: number | null, state: SignalState): boolean {
  return state !== 'na' && isNum(pct) && pct > 0
}

export function runGates(input: ScoreInput): GateResult[] {
  const dd = pctFromAth(input.price, input.allTimeHigh)
  return [
    {
      key: 'megacap',
      label: 'Market cap ≥ $500B',
      passed: isNum(input.marketCap) && input.marketCap >= MIN_MARKET_CAP,
      detail: isNum(input.marketCap) ? `$${(input.marketCap / 1e9).toFixed(0)}B` : 'unknown',
    },
    {
      key: 'yoy',
      label: 'YoY EPS growth positive',
      passed: isGreen(input.yoyPct, input.yoyState),
      detail: fmtPct(input.yoyPct),
    },
    {
      key: 'ntm',
      label: 'NTM EPS growth positive',
      passed: isGreen(input.ntmPct, input.ntmState),
      detail: fmtPct(input.ntmPct),
    },
    {
      key: 'cagr',
      label: 'EPS CAGR 5yr expected positive',
      passed: isNum(input.epsCagr5yr) && input.epsCagr5yr > 0,
      detail: fmtPct(input.epsCagr5yr),
    },
    {
      key: 'belowAth',
      label: 'Trading below the all-time high',
      passed: isNum(dd) && dd < 0,
      detail: isNum(dd) ? `${dd.toFixed(1)}% from high` : 'unknown',
    },
  ]
}

// ─── Factors ────────────────────────────────────────────────────────
export function runFactors(input: ScoreInput): FactorScore[] {
  const tech = input.technicals
  const positionPct = tech?.channel ? tech.channel.positionPct : null
  const lastClose =
    tech && tech.visible.length > 0 ? tech.visible[tech.visible.length - 1].c : null
  const r = lastClose != null ? retracementRatio(lastClose, tech?.fib ?? null) : null
  const vsSma = vsSma150Pct(input.price, input.sma150)
  const dd = pctFromAth(input.price, input.allTimeHigh)

  // Growth — three equal sub-scores. Averaging the units keeps a single strong
  // metric from carrying two weak ones.
  const growthUnits = [
    growthUnit(input.yoyPct),
    growthUnit(input.ntmPct),
    growthUnit(input.epsCagr5yr),
  ]
  const growthPoints = (WEIGHTS.growth / 3) * growthUnits.reduce((s, u) => s + u, 0)

  const smaPoints = isNum(vsSma)
    ? WEIGHTS.sma * clamp(1 - Math.abs(vsSma) / SMA_ZERO_AT_PCT, 0, 1)
    : 0

  const tunnelPoints = isNum(positionPct)
    ? WEIGHTS.tunnel * (1 - clamp(positionPct, 0, 100) / 100)
    : 0

  const goldenPoints = isNum(r) ? WEIGHTS.golden * piecewise(r, GOLDEN_KNOTS) : 0

  const drawdownPoints = isNum(dd) ? WEIGHTS.drawdown * piecewise(Math.abs(dd), DRAWDOWN_KNOTS) : 0

  return [
    {
      key: 'growth',
      label: 'Growth engine',
      points: growthPoints,
      max: WEIGHTS.growth,
      detail: `YoY ${fmtPct(input.yoyPct, 0)} · NTM ${fmtPct(input.ntmPct, 0)} · CAGR ${fmtPct(input.epsCagr5yr, 0)}`,
    },
    {
      key: 'sma',
      label: 'SMA 150 proximity',
      points: smaPoints,
      max: WEIGHTS.sma,
      detail: isNum(vsSma) ? `${fmtPct(vsSma)} vs the 150-day average` : 'no SMA available',
    },
    {
      key: 'tunnel',
      label: 'Tunnel position',
      points: tunnelPoints,
      max: WEIGHTS.tunnel,
      detail: isNum(positionPct)
        ? `${clamp(positionPct, 0, 100).toFixed(0)}% up the regression channel`
        : 'no channel available',
    },
    {
      key: 'golden',
      label: 'Golden zone',
      points: goldenPoints,
      max: WEIGHTS.golden,
      detail: isNum(r) ? `${(r * 100).toFixed(1)}% retracement` : 'no swing anchored',
    },
    {
      key: 'drawdown',
      label: 'Room below the high',
      points: drawdownPoints,
      max: WEIGHTS.drawdown,
      detail: isNum(dd) ? `${dd.toFixed(1)}% below the all-time high` : 'no all-time high',
    },
  ]
}

// ─── Reasons ────────────────────────────────────────────────────────
/** Plain-English phrases for the factors that actually carried the score —
 *  60% of a factor's weight or better. Ordered strongest first, capped at
 *  three so the email line stays a sentence, not a paragraph. */
const REASON_TEXT: Record<FactorKey, (f: FactorScore) => string> = {
  growth: (f) => `growth is compounding on all three horizons (${f.detail})`,
  sma: (f) => `price is hugging its 150-day average (${f.detail})`,
  tunnel: (f) => `it is sitting in the lower half of its regression channel (${f.detail})`,
  golden: (f) => `the pullback is holding the golden zone (${f.detail})`,
  drawdown: (f) => `there is real room back to the high (${f.detail})`,
}

export function buildReasons(factors: FactorScore[]): string[] {
  return factors
    .filter((f) => f.max > 0 && f.points / f.max >= 0.6)
    .sort((a, b) => b.points / b.max - a.points / a.max)
    .slice(0, 3)
    .map((f) => REASON_TEXT[f.key](f))
}

// ─── Entry points ───────────────────────────────────────────────────
export function evaluate(input: ScoreInput): Evaluation {
  const gates = runGates(input)
  const factors = runFactors(input)
  const raw = factors.reduce((s, f) => s + f.points, 0)
  return {
    input,
    gates,
    passedGates: gates.every((g) => g.passed),
    factors,
    score: Math.round(raw * 10) / 10,
    reasons: buildReasons(factors),
  }
}

/** Exported for fixture construction — a later task's preview script builds
 *  `ScoredPick` fixtures through this instead of hand-duplicating the shape. */
export function toPick(e: Evaluation): ScoredPick {
  const t = e.input.technicals
  const lastClose = t && t.visible.length > 0 ? t.visible[t.visible.length - 1].c : null
  return {
    ...e,
    symbol: e.input.symbol,
    name: e.input.name,
    price: e.input.price,
    marketCap: e.input.marketCap,
    trailingPe: e.input.trailingPe,
    vsSma150Pct: vsSma150Pct(e.input.price, e.input.sma150),
    pctFromAth: pctFromAth(e.input.price, e.input.allTimeHigh),
    positionPct: t?.channel ? t.channel.positionPct : null,
    retracement: lastClose != null ? retracementRatio(lastClose, t?.fib ?? null) : null,
    yoyPct: e.input.yoyPct,
    ntmPct: e.input.ntmPct,
    epsCagr5yr: e.input.epsCagr5yr,
  }
}

/** Compact projection of a ScoredPick for persistence (screener_digest_sends.
 *  picks, a jsonb audit column). Deliberately excludes `input.technicals` —
 *  126 OHLC bars plus four 126-point series per pick, ~30–60KB each, which
 *  would otherwise accumulate at roughly 0.5MB/day / 150MB/year of raw market
 *  data inside an audit table, against a 500MB Supabase free-tier cap. Kept
 *  next to ScoredPick/toPick so the audit shape stays defined beside the type
 *  it projects. */
export interface DigestPickRecord {
  symbol: string
  name: string | null
  score: number
  factors: Array<{ key: FactorKey; points: number; max: number }>
  price: number | null
  marketCap: number | null
  trailingPe: number | null
  yoyPct: number | null
  ntmPct: number | null
  epsCagr5yr: number | null
  vsSma150Pct: number | null
  pctFromAth: number | null
}

export function toDigestPickRecord(p: ScoredPick): DigestPickRecord {
  return {
    symbol: p.symbol,
    name: p.name,
    score: p.score,
    factors: p.factors.map((f) => ({ key: f.key, points: f.points, max: f.max })),
    price: p.price,
    marketCap: p.marketCap,
    trailingPe: p.trailingPe,
    yoyPct: p.yoyPct,
    ntmPct: p.ntmPct,
    epsCagr5yr: p.epsCagr5yr,
    vsSma150Pct: p.vsSma150Pct,
    pctFromAth: p.pctFromAth,
  }
}

/** Gate, score, cut at MIN_SCORE, rank, cap at MAX_PICKS.
 *
 *  Ties break on symbol ascending so the same data always produces the same
 *  email — a digest whose order shuffles between the preview and the send
 *  would be impossible to trust. */
export function selectPicks(inputs: ScoreInput[]): Selection {
  const passed = inputs.map(evaluate).filter((e) => e.passedGates)
  const above = passed.filter((e) => e.score >= MIN_SCORE)
  const picks = above
    .sort((a, b) => b.score - a.score || a.input.symbol.localeCompare(b.input.symbol))
    .slice(0, MAX_PICKS)
    .map(toPick)
  return {
    picks,
    considered: inputs.length,
    belowCutoff: passed.length - above.length,
  }
}
