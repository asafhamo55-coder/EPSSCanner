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
import { pctFromAth, vsSma150Pct, type PriceRange } from './derive'
import { retracementRatio, type Technicals } from './technicals'
import type { SignalState } from './signals'

// ─── Tuning block — every threshold in the model lives here ─────────
/** Entry gate: mega caps only. Inclusive. */
export const MIN_MARKET_CAP = 400e9
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

  // ── Carried context ───────────────────────────────────────────────
  // Everything below is passed through to the renderer and the market read and
  // is deliberately NOT read by runGates or runFactors. Scoring on these would
  // silently change every historical ranking, so the invariance assertions in
  // scripts/test-signals.ts exist to catch exactly that.
  forwardPe?: number | null
  peg5yr?: number | null
  netMarginTtm?: number | null
  grossMarginTtm?: number | null
  operatingMarginTtm?: number | null
  roiTtm?: number | null
  epsSurprisePct?: number | null
  /** Public URL of this pick's rendered chart, attached during preparation
   *  (Task 6). Absent means the email falls back to the v1 CSS bars. */
  chartUrl?: string | null
  change1dPct?: number | null
  change1wPct?: number | null
  change1mPct?: number | null
  fullRange?: PriceRange | null
}

export type GateKey = 'megacap' | 'yoy' | 'ntm' | 'cagr' | 'belowAth'
export type FactorKey = 'growth' | 'sma' | 'tunnel' | 'golden' | 'drawdown'

/** Why a gate did not pass.
 *
 *  'fail' means the reading arrived and was bad. 'unknown' means it never
 *  arrived — and before this the two were indistinguishable, because every
 *  gate rejects a null exactly as it rejects a bad value. A live run showed
 *  all three EPS-CAGR rejections among mega caps were 'unknown', not one
 *  genuinely negative reading.
 *
 *  'unknown' still does NOT pass. A name whose growth cannot be verified has
 *  no business in a list of recommendations; the change is that it is now
 *  reported as unverified rather than silently lumped in with real failures. */
export type GateState = 'pass' | 'fail' | 'unknown'

export interface GateResult {
  key: GateKey
  label: string
  state: GateState
  /** True only for state 'pass'. Kept so existing consumers are unchanged. */
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

  // ── Carried context ───────────────────────────────────────────────
  // Same fields as ScoreInput, same rule: carried through by toPick(), never
  // read by runGates or runFactors.
  forwardPe?: number | null
  peg5yr?: number | null
  netMarginTtm?: number | null
  grossMarginTtm?: number | null
  operatingMarginTtm?: number | null
  roiTtm?: number | null
  epsSurprisePct?: number | null
  chartUrl?: string | null
  change1dPct?: number | null
  change1wPct?: number | null
  change1mPct?: number | null
  fullRange?: PriceRange | null
}


// ─── Selection funnel ───────────────────────────────────────────────

export interface GateFunnelRow {
  key: GateKey
  label: string
  /** How many of the considered names this gate rejected. Counts are
   *  INDEPENDENT, not sequential — one name failing three gates is counted by
   *  all three — because the useful question is "which criterion is doing the
   *  filtering", not "which one happened to run first". */
  failed: number
  /** Of `failed`, how many were rejected because the reading was ABSENT
   *  rather than genuinely bad.
   *
   *  This is the number worth watching. Every gate above rejects a missing
   *  value exactly as it rejects a failing one — `isNum(...)` is false either
   *  way, and `isGreen` additionally rejects state 'na' — so a name whose
   *  fundamentals did not refresh is indistinguishable, in the output, from a
   *  name with genuinely negative growth. When a provider rate-limits the
   *  refresh (observed: FMP 429s skipping ~20 of 62 tickers), the pick list
   *  silently shrinks and nothing in the email says so. */
  failedMissingData: number
}

export interface SelectionFunnel {
  considered: number
  gates: GateFunnelRow[]
  passedAllGates: number
  /** Passed every gate but scored below MIN_SCORE. */
  belowCutoff: number
  /** Cleared the cutoff AND survived the MAX_PICKS cap — what is emailed. */
  picks: number
  /** Cleared the cutoff but were dropped by the MAX_PICKS cap. Non-zero here
   *  means the cap is binding and real candidates are being withheld. */
  droppedByCap: number
  /** How many names had no data at all for at least one gate. */
  incompleteData: number
  /** The same funnel restricted to names that clear the market-cap gate.
   *
   *  This is the actionable view. The $500B rule DEFINES the universe rather
   *  than filtering within it — it rejects the large majority of the
   *  watchlist by design, which makes the raw per-gate counts above dominated
   *  by names that were never candidates. Among mega caps, a rejection for
   *  missing data is a pick actually lost to data quality. */
  amongMegaCaps: {
    count: number
    gates: GateFunnelRow[]
    passedAllGates: number
    /** Mega caps rejected by at least one gate purely for want of data —
     *  i.e. names that might have qualified had the refresh been complete. */
    lostToMissingData: number
  }
  minScore: number
  maxPicks: number
  minMarketCap: number
}

/** Why the pick list is the size it is — computed from the same inputs
 *  `selectPicks` consumes, so the two cannot disagree.
 *
 *  Exists because "only five stocks today" has several possible causes that
 *  look identical from outside: a genuinely narrow market, a provider that
 *  did not refresh, or a cap quietly binding. This separates them. */
export function selectionFunnel(inputs: ScoreInput[]): SelectionFunnel {
  // Gate state is now authoritative for "was this reading present" — see
  // GateState. This used to duplicate that judgement per gate, which is
  // exactly the drift the single helper in runGates prevents.
  const rows = new Map<GateKey, GateFunnelRow>()
  let incompleteData = 0

  for (const input of inputs) {
    let anyMissing = false
    for (const gate of runGates(input)) {
      const row = rows.get(gate.key) ?? {
        key: gate.key,
        label: gate.label,
        failed: 0,
        failedMissingData: 0,
      }
      if (gate.state === 'unknown') anyMissing = true
      if (!gate.passed) {
        row.failed++
        if (gate.state === 'unknown') row.failedMissingData++
      }
      rows.set(gate.key, row)
    }
    if (anyMissing) incompleteData++
  }

  // Same tally, restricted to the universe the market-cap rule defines.
  const megaCaps = inputs.filter((i) => isNum(i.marketCap) && i.marketCap >= MIN_MARKET_CAP)
  const megaRows = new Map<GateKey, GateFunnelRow>()
  let lostToMissingData = 0
  for (const input of megaCaps) {
    let lost = false
    for (const gate of runGates(input)) {
      if (gate.key === 'megacap') continue
      const row = megaRows.get(gate.key) ?? {
        key: gate.key,
        label: gate.label,
        failed: 0,
        failedMissingData: 0,
      }
      if (!gate.passed) {
        row.failed++
        if (gate.state === 'unknown') {
          row.failedMissingData++
          lost = true
        }
      }
      megaRows.set(gate.key, row)
    }
    if (lost) lostToMissingData++
  }

  const evaluated = inputs.map(evaluate)
  const passed = evaluated.filter((e) => e.passedGates)
  const above = passed.filter((e) => e.score >= MIN_SCORE)

  return {
    considered: inputs.length,
    gates: [...rows.values()],
    amongMegaCaps: {
      count: megaCaps.length,
      gates: [...megaRows.values()],
      passedAllGates: megaCaps.map(evaluate).filter((e) => e.passedGates).length,
      lostToMissingData,
    },
    passedAllGates: passed.length,
    belowCutoff: passed.length - above.length,
    picks: Math.min(above.length, MAX_PICKS),
    droppedByCap: Math.max(0, above.length - MAX_PICKS),
    incompleteData,
    minScore: MIN_SCORE,
    maxPicks: MAX_PICKS,
    minMarketCap: MIN_MARKET_CAP,
  }
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
  /** A gate's state from "is the reading present" and "is it good". Keeping
   *  this in one helper is what stops the two questions drifting apart
   *  gate-by-gate, which is how they became conflated in the first place. */
  const state = (present: boolean, good: boolean): GateState =>
    !present ? 'unknown' : good ? 'pass' : 'fail'
  const row = (key: GateKey, label: string, st: GateState, detail: string): GateResult => ({
    key,
    label,
    state: st,
    passed: st === 'pass',
    detail,
  })

  return [
    row(
      'megacap',
      `Market cap ≥ $${(MIN_MARKET_CAP / 1e9).toFixed(0)}B`,
      state(isNum(input.marketCap), isNum(input.marketCap) && input.marketCap >= MIN_MARKET_CAP),
      isNum(input.marketCap) ? `$${(input.marketCap / 1e9).toFixed(0)}B` : 'unknown',
    ),
    row(
      'yoy',
      'YoY EPS growth positive',
      state(input.yoyState !== 'na' && isNum(input.yoyPct), isGreen(input.yoyPct, input.yoyState)),
      fmtPct(input.yoyPct),
    ),
    row(
      'ntm',
      'NTM EPS growth positive',
      state(input.ntmState !== 'na' && isNum(input.ntmPct), isGreen(input.ntmPct, input.ntmState)),
      fmtPct(input.ntmPct),
    ),
    row(
      'cagr',
      'EPS CAGR 5yr expected positive',
      state(isNum(input.epsCagr5yr), isNum(input.epsCagr5yr) && input.epsCagr5yr > 0),
      fmtPct(input.epsCagr5yr),
    ),
    row(
      'belowAth',
      'Trading below the all-time high',
      state(isNum(dd), isNum(dd) && dd < 0),
      isNum(dd) ? `${dd.toFixed(1)}% from high` : 'unknown',
    ),
  ]
}

// ─── Shared derivation ──────────────────────────────────────────────
/** Readings derived from a ScoreInput that both runFactors() (to score them)
 *  and toPick() (to display them) need. Computed once here so the two can't
 *  drift into recomputing lastClose / retracementRatio / vsSma150Pct /
 *  pctFromAth independently. */
export interface DerivedReadings {
  positionPct: number | null
  retracement: number | null
  vsSma150Pct: number | null
  pctFromAth: number | null
}

export function deriveReadings(input: ScoreInput): DerivedReadings {
  const tech = input.technicals
  const lastClose =
    tech && tech.visible.length > 0 ? tech.visible[tech.visible.length - 1].c : null
  return {
    positionPct: tech?.channel ? tech.channel.positionPct : null,
    retracement: lastClose != null ? retracementRatio(lastClose, tech?.fib ?? null) : null,
    vsSma150Pct: vsSma150Pct(input.price, input.sma150),
    pctFromAth: pctFromAth(input.price, input.allTimeHigh),
  }
}

// ─── Factors ────────────────────────────────────────────────────────
export function runFactors(input: ScoreInput): FactorScore[] {
  const { positionPct, retracement: r, vsSma150Pct: vsSma, pctFromAth: dd } = deriveReadings(input)

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
      // Magnitude, not the signed value: `pctFromAth` is negative below the
      // high, so interpolating it raw produced "-24.3% below the all-time
      // high" — a double negative that reads as ABOVE the high. The words
      // carry the direction here, the same convention src/lib/market-read.ts
      // follows.
      detail: isNum(dd) ? `${Math.abs(dd).toFixed(1)}% below the all-time high` : 'no all-time high',
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
  const readings = deriveReadings(e.input)
  return {
    ...e,
    symbol: e.input.symbol,
    name: e.input.name,
    price: e.input.price,
    marketCap: e.input.marketCap,
    trailingPe: e.input.trailingPe,
    vsSma150Pct: readings.vsSma150Pct,
    pctFromAth: readings.pctFromAth,
    positionPct: readings.positionPct,
    retracement: readings.retracement,
    yoyPct: e.input.yoyPct,
    ntmPct: e.input.ntmPct,
    epsCagr5yr: e.input.epsCagr5yr,
    forwardPe: e.input.forwardPe,
    peg5yr: e.input.peg5yr,
    netMarginTtm: e.input.netMarginTtm,
    grossMarginTtm: e.input.grossMarginTtm,
    operatingMarginTtm: e.input.operatingMarginTtm,
    roiTtm: e.input.roiTtm,
    epsSurprisePct: e.input.epsSurprisePct,
    chartUrl: e.input.chartUrl,
    change1dPct: e.input.change1dPct,
    change1wPct: e.input.change1wPct,
    change1mPct: e.input.change1mPct,
    fullRange: e.input.fullRange,
  }
}

/** A pick's technical price levels, projected from `Technicals` for the ~15
 *  numbers a trader actually reads off a chart — channel rail prices, the Fib
 *  ladder's price levels, the nearest open gaps, and the 150-day SMA's own
 *  price (not just the percent distance from it). Deliberately NOT the same
 *  exclusion as `input.technicals` itself: that field is excluded from
 *  persistence because it carries the full 126-bar OHLC series plus four
 *  126-point derived series (~30–60KB/pick); this is a small fixed-size
 *  summary computed FROM it, cheap enough to persist next to the rest of
 *  `DigestPickRecord`. Null end-to-end when `technicals` itself is null (no
 *  bars, or too short a history) — never partially fabricated. */
export interface DigestPickLevels {
  /** Regression-channel rails at the last visible bar, as prices. */
  channelUpper: number | null
  channelMid: number | null
  channelLower: number | null
  /** The 150-day SMA's own price (last visible value), enabling a dollar
   *  distance from price, not just percent. */
  sma150: number | null
  /** The Fib ladder, each level with its actual price — empty (not null)
   *  when there's no swing to anchor a retracement, so the renderer can tell
   *  "no data yet" (null `levels`) from "computed, but no Fib" (empty array)
   *  and degrade the two independently. */
  fib: Array<{ ratio: number; price: number }>
  /** `Technicals['fib']['anchor']` (technicals.ts), carried through so the
   *  email can honour the same contract the dashboard already does
   *  (`TechnicalChart.tsx` labels a 'window' anchor "window extremes" rather
   *  than presenting it as a real swing retracement — see that file's own
   *  Fib heading). Null exactly when `fib` is empty — there is no anchor to
   *  label when there's no ladder to label it on. Without this, the email
   *  presented every fallback ladder as a genuine swing retracement, to
   *  expert traders, under the owner's name. */
  fibAnchor: 'swing' | 'window' | null
  /** Open gaps nearest the last close, capped at 3 — a name with a dozen
   *  unfilled gaps should not produce a dozen email rows. */
  gaps: Array<{
    top: number
    bottom: number
    pct: number
    direction: 'up' | 'down'
    side: 'above' | 'below'
  }>
}

/** Pulls `DigestPickLevels` out of a `Technicals` reading, the one place this
 *  ~15-number summary is computed so the persisted path (`toDigestPickRecord`,
 *  which discards `input.technicals` right after) and the in-memory fallback
 *  path (a freshly-scored `ScoredPick`, which still has `input.technicals`
 *  live) can both call this instead of drifting into two derivations. */
export function deriveLevels(technicals: Technicals | null): DigestPickLevels | null {
  if (!technicals) return null
  const { channel, fib, gaps, sma150: smaSeries, visible } = technicals

  const channelUpper = channel ? (channel.upper[channel.upper.length - 1] ?? null) : null
  const channelMid = channel ? (channel.mid[channel.mid.length - 1] ?? null) : null
  const channelLower = channel ? (channel.lower[channel.lower.length - 1] ?? null) : null

  let sma150: number | null = null
  for (let i = smaSeries.length - 1; i >= 0; i--) {
    if (smaSeries[i] != null) {
      sma150 = smaSeries[i]
      break
    }
  }

  const fibLevels = fib ? fib.levels.map((l) => ({ ratio: l.ratio, price: l.price })) : []
  // Null exactly when there's no ladder — see the field's own doc comment.
  const fibAnchor = fib ? fib.anchor : null

  const lastClose = visible.length > 0 ? visible[visible.length - 1].c : null
  const nearestGaps = [...gaps]
    .sort((a, b) => {
      if (lastClose == null) return 0
      const da = Math.abs((a.top + a.bottom) / 2 - lastClose)
      const db = Math.abs((b.top + b.bottom) / 2 - lastClose)
      return da - db
    })
    .slice(0, 3)
    .map((g) => ({ top: g.top, bottom: g.bottom, pct: g.pct, direction: g.direction, side: g.side }))

  return { channelUpper, channelMid, channelLower, sma150, fib: fibLevels, fibAnchor, gaps: nearestGaps }
}

/** Compact projection of a ScoredPick for persistence (screener_digest_sends.
 *  picks, and — since Task 7 — screener_digest_prep.picks, both jsonb
 *  columns). Deliberately excludes `input.technicals` — 126 OHLC bars plus
 *  four 126-point series per pick, ~30–60KB each, which would otherwise
 *  accumulate at roughly 0.5MB/day / 150MB/year of raw market data inside an
 *  audit table, against a 500MB Supabase free-tier cap. Kept next to
 *  ScoredPick/toPick so the audit shape stays defined beside the type it
 *  projects.
 *
 *  The valuation, momentum and range fields added alongside chartUrl (see
 *  ScoredPick) are single numbers — negligible next to the bar series above —
 *  so they're included for audit. `chartUrl` itself is excluded: it's not
 *  carried context but an attached artifact from the preparation phase (Task
 *  6), not yet populated by anything that flows through here.
 *
 *  `reasons`, `positionPct`, `retracement`, `yoyState` and `ntmState` were
 *  added in Task 7's fix round 1: the digest route's prepared-row path reads
 *  this exact projection back (see readPrep in src/lib/digest.ts) and feeds
 *  it to the same email renderer a freshly-scored ScoredPick goes through.
 *  Without these five, every prepared-path card fell back to a generic
 *  reason, an empty tunnel/golden-zone bar, and — worst — a YoY/NTM chip
 *  coloured by the sign of the percentage instead of by SignalState, so a
 *  'flag' (soft-positive) rendered green instead of amber. All five are
 *  short strings/enums/small numbers, nothing like the technicals blob this
 *  projection exists to exclude. Still excluded: `gates`, `passedGates` and
 *  `input` itself (beyond the two states pulled out below) — the prepared
 *  email doesn't need them, and the full `input.technicals` (126 OHLC bars
 *  plus four 126-point series) is exactly the payload this type exists to
 *  keep out. `levels` (added in the v2 email's fix round 1) is the one
 *  deliberate exception: a small FIXED-SIZE summary of ~15 numbers computed
 *  FROM `input.technicals` — channel rails, the Fib ladder's prices, the
 *  SMA-150 price, up to 3 gaps — not the blob itself. See
 *  `DigestPickLevels`/`deriveLevels` just above. */
export interface DigestPickRecord {
  symbol: string
  name: string | null
  score: number
  factors: Array<{ key: FactorKey; points: number; max: number }>
  price: number | null
  marketCap: number | null
  trailingPe: number | null
  yoyPct: number | null
  yoyState: SignalState
  ntmPct: number | null
  ntmState: SignalState
  epsCagr5yr: number | null
  vsSma150Pct: number | null
  pctFromAth: number | null
  positionPct: number | null
  retracement: number | null
  forwardPe: number | null
  peg5yr: number | null
  netMarginTtm: number | null
  grossMarginTtm: number | null
  operatingMarginTtm: number | null
  roiTtm: number | null
  epsSurprisePct: number | null
  change1dPct: number | null
  change1wPct: number | null
  change1mPct: number | null
  fullRange: PriceRange | null
  /** Why this pick cleared the bar, e.g. "strong YoY and NTM growth". Empty
   *  is a legitimate value (a pick that passed on the strength of its score
   *  alone) — the renderer's "Cleared every entry gate." fallback covers
   *  that case, not a missing-field one. */
  reasons: string[]
  /** Channel rails, Fib ladder, nearest gaps and the SMA-150 price — see
   *  `DigestPickLevels`. Null when `input.technicals` was null (short/missing
   *  history), independent of every other field on this record. */
  levels: DigestPickLevels | null
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
    yoyState: p.input.yoyState,
    ntmPct: p.ntmPct,
    ntmState: p.input.ntmState,
    epsCagr5yr: p.epsCagr5yr,
    vsSma150Pct: p.vsSma150Pct,
    pctFromAth: p.pctFromAth,
    positionPct: p.positionPct,
    retracement: p.retracement,
    forwardPe: p.forwardPe ?? null,
    peg5yr: p.peg5yr ?? null,
    netMarginTtm: p.netMarginTtm ?? null,
    grossMarginTtm: p.grossMarginTtm ?? null,
    operatingMarginTtm: p.operatingMarginTtm ?? null,
    roiTtm: p.roiTtm ?? null,
    epsSurprisePct: p.epsSurprisePct ?? null,
    change1dPct: p.change1dPct ?? null,
    change1wPct: p.change1wPct ?? null,
    change1mPct: p.change1mPct ?? null,
    fullRange: p.fullRange ?? null,
    reasons: p.reasons,
    levels: deriveLevels(p.input.technicals),
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
