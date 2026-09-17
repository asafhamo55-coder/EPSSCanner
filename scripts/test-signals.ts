/**
 * scripts/test-screener-signals.ts
 *
 * Verification harness for the EPS-screener calc engine. Pure functions +
 * the deterministic mock provider — no network, no DB. Follows the same
 * "self-contained exit 0/1" pattern as scripts/test-accounting.ts.
 *
 * Contract under test: the five methodology signals reproduce the deck's
 * NVDA numbers exactly, and the documented edge cases (turnaround, missing
 * forward P/E, short history) return labeled states instead of misleading
 * ratios.
 *
 * Usage:
 *   pnpm test:screener
 *   pnpm exec tsx scripts/test-screener-signals.ts
 */

import {
  buildScorecard,
  fwdGrowth,
  peReasonableness,
  qoqTrend,
  yoyGrowth,
} from '../src/lib/signals'
import { MockProvider } from '../src/market-data/index'
import { forwardPeFromTrend } from '../src/market-data/providers/yahoo'
import {
  analyze,
  buildChannel,
  computeFib,
  findGaps,
  findPivots,
  linreg,
  MIN_CHANNEL_BARS,
  PIVOT_K,
  scoreSignals,
  smaSeries,
  verdictFrom,
  inGoldenZone,
  retracementRatio,
} from '../src/lib/technicals'
import type { Bar } from '../src/market-data/provider'
import type { Fib, Technicals } from '../src/lib/technicals'
import {
  epsCagr5yr,
  epsSurprisePct,
  fiftyTwoWeekRange,
  pctFromAth,
  priceChangePct,
  vsSma150Pct,
} from '../src/lib/derive'
import { renderConfirm } from '../src/lib/email/confirm'
import { renderDigest, type DigestData, type DigestSelection } from '../src/lib/email/render'
import { renderDigestV2 } from '../src/lib/email/render-v2'
import type { PrepPickRecord } from '../src/lib/digest'
import { PALETTE } from '../src/lib/email/primitives'
import {
  deriveLevels,
  evaluate,
  selectPicks,
  toDigestPickRecord,
  toPick,
  MAX_PICKS,
  MIN_MARKET_CAP,
  MIN_SCORE,
  WEIGHTS,
  type ScoreInput,
} from '../src/lib/score'
import { buildPayload, isGrounded, numericTokens } from '../src/lib/ai/prompt'

let failures = 0

function approx(actual: number | null, expected: number, tol: number, label: string) {
  if (actual == null || Math.abs(actual - expected) > tol) {
    console.error(`  ✗ ${label}: expected ≈ ${expected}, got ${actual}`)
    failures++
  } else {
    console.log(`  ✓ ${label}: ${actual.toFixed(4)} ≈ ${expected}`)
  }
}

function eq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    console.error(`  ✗ ${label}: expected ${String(expected)}, got ${String(actual)}`)
    failures++
  } else {
    console.log(`  ✓ ${label}: ${String(actual)}`)
  }
}

async function main() {
  const provider = new MockProvider()

  // ── NVDA deck reproduction ───────────────────────────────────────
  console.log('\nNVDA — methodology deck reproduction')
  const eps = await provider.getQuarterlyEps('NVDA', 12)
  const val = await provider.getValuation('NVDA')
  const annual = await provider.getAnnualFinancials('NVDA', 5)
  const actuals = eps.filter((r) => !r.isForecast).map((r) => r.epsActual)

  // Step 3 — YoY: 1.87 / 0.81 = 2.31 → +131%
  const yoy = yoyGrowth(actuals[actuals.length - 1], actuals[actuals.length - 5])
  approx(yoy.ratio, 2.309, 0.01, 'YoY ratio (1.87 / 0.81)')
  approx(yoy.pct, 130.9, 0.5, 'YoY pct')
  eq(yoy.state, 'pass', 'YoY state')

  // Step 4 — QoQ deltas decelerating
  const qoq = qoqTrend(
    actuals
      .map((v, i) => (i === 0 ? null : (v! - actuals[i - 1]!)))
      .filter((d): d is number => d != null),
  )
  eq(qoq.label, 'decelerating', 'QoQ trend label')
  eq(qoq.state, 'fail', 'QoQ state')

  // Step 5 — fwd growth: 32.56 / 24.27 = 1.34 → +34%; fwd annual EPS 8.79
  const fwd = fwdGrowth(val.trailingPe, val.forwardPe, val.price)
  approx(fwd.ratio, 1.3415, 0.01, 'Fwd ratio (32.56 / 24.27)')
  approx(fwd.pct, 34.15, 0.5, 'Fwd pct')
  approx(fwd.fwdAnnualEps, 8.793, 0.01, 'Fwd annual EPS (213.4 / 24.27)')

  // Step 1 — P/E 32.56 is a premium (> 30)
  const pe = peReasonableness(val.trailingPe)
  eq(pe.premiumFlag, true, 'P/E premium flag (32.56 > 30)')

  // Composite
  const sc = buildScorecard({
    trailingPe: val.trailingPe,
    forwardPe: val.forwardPe,
    price: val.price,
    netMarginTtm: val.netMarginTtm,
    revenueGrowing: annual.every((r, i) => i === 0 || r.revenue! > annual[i - 1].revenue!),
    netIncomeGrowing: annual.every((r, i) => i === 0 || r.netIncome! > annual[i - 1].netIncome!),
    yearsOnFile: annual.length,
    epsSeries: actuals,
  })
  eq(sc.fundamentals.state, 'pass', 'Fundamentals (rev + NI both rising)')
  console.log(`  · composite: ${sc.passing}/${sc.scored} signals passing`)

  // ── Edge cases ───────────────────────────────────────────────────
  console.log('\nEdge cases')
  eq(yoyGrowth(1.5, -0.2).state, 'turnaround', 'Loss→profit turnaround')
  eq(yoyGrowth(1.5, 0).state, 'na', 'Zero prior-year EPS → n/a')
  eq(yoyGrowth(1.5, null).state, 'na', 'Missing prior-year EPS → n/a')
  eq(fwdGrowth(32, null, 200).state, 'na', 'Missing forward P/E → n/a')
  eq(qoqTrend([0.2]).state, 'na', 'Single delta → n/a (no slope)')
  eq(peReasonableness(null).state, 'na', 'Missing P/E → n/a')
  eq(peReasonableness(25).state, 'pass', 'P/E 25 in band → pass')

  // ── Forward P/E fiscal-year selection ────────────────────────────
  // Real Yahoo earningsTrend payloads, captured 2026-07-15. The roll to +1y
  // fires only while the current FY is still running; once it has ended but
  // not yet been reported, Yahoo's `0y` slot still holds the forward year.
  console.log('\nForward P/E fiscal-year selection')
  const NOW = Date.parse('2026-07-15T00:00:00Z')
  const trend = (endDate: string, cyEps: number, nyEps: number) => ({
    trend: [
      { period: '0y', endDate, earningsEstimate: { avg: cyEps } },
      { period: '+1y', endDate: '2027-12-31', earningsEstimate: { avg: nyEps } },
    ],
  })
  // SNDK: FY26 ended 16 days ago, unreported → stay on 0y (vendors quote ~24-27).
  approx(forwardPeFromTrend(trend('2026-06-30', 66.51192, 208.21712), 1615, NOW), 24.28, 0.01,
    'FY ended but unreported → 0y basis (SNDK 24.3, not 7.8)')
  // MU: FY26 still running, 46 days out → roll to +1y.
  approx(forwardPeFromTrend(trend('2026-08-31', 73.32485, 149.63846), 904.28, NOW), 6.04, 0.01,
    'FY ends within 120d → +1y basis (MU 6.04)')
  // PLTR: FY26 still running, 168 days out → stay on 0y.
  approx(forwardPeFromTrend(trend('2026-12-31', 1.47608, 2.09448), 133.76, NOW), 90.62, 0.01,
    'FY ends beyond 120d → 0y basis (PLTR 90.6)')
  eq(forwardPeFromTrend(trend('2026-06-30', 66.51, 208.22), null, NOW), null, 'Missing price → null')
  eq(forwardPeFromTrend(trend('2026-06-30', -1.5, 208.22), 1615, NOW), null, 'Negative FY estimate → null')

  // ── Technicals: linreg ──────────────────────────────────────────
  console.log('\nTechnicals — linreg')
  const linregKnown = linreg([1, 3, 5, 7, 9]) // y = 2x + 1, exact fit
  approx(linregKnown.slope, 2, 1e-9, 'linreg slope (y = 2x + 1)')
  approx(linregKnown.intercept, 1, 1e-9, 'linreg intercept (y = 2x + 1)')
  approx(linregKnown.sigma, 0, 1e-9, 'linreg sigma (perfect fit → 0)')

  // Population (÷n) vs sample (÷n-1) sigma differ for this series — population
  // ≈ 0.235702, sample would be ≈ 0.288675. Getting this wrong silently widens
  // the channel rails and skews every verdict.
  const linregNoisy = linreg([0, 1, 1])
  approx(linregNoisy.sigma, 0.2357022604, 1e-9, 'linreg sigma is population (÷n), not sample (÷n-1)')

  // ── Technicals: 3-factor scoring ─────────────────────────────────
  // Fib fixtures below are a rally anchored high=200 low=100 (span 100), so the
  // golden zone runs from 200-100*0.618 = 138.2 up to 200-100*0.5 = 150.
  console.log('\nTechnicals — signal scoring')
  const gzRallyFib = {
    high: 200,
    low: 100,
    direction: 'rally' as const,
    anchor: 'swing' as const,
    levels: [],
  }
  eq(inGoldenZone(150, gzRallyFib), true, 'golden zone: close on the 50% level (150) is inside')
  eq(inGoldenZone(138.2, gzRallyFib), true, 'golden zone: close on the 61.8% level (138.2) is inside')
  eq(inGoldenZone(144, gzRallyFib), true, 'golden zone: close mid-band (144) is inside')
  eq(inGoldenZone(150.01, gzRallyFib), false, 'golden zone: just above the 50% level is outside')
  eq(inGoldenZone(138.19, gzRallyFib), false, 'golden zone: just below the 61.8% level is outside')
  eq(inGoldenZone(144, null), false, 'golden zone: no fib anchor scores false, never throws')

  // Same band on a decline: levels measure UP from the low, so 100+100*0.5=150
  // and 100+100*0.618=161.8 — the min/max comparison must handle both orders.
  const gzDeclineFib = { ...gzRallyFib, direction: 'decline' as const }
  eq(inGoldenZone(155, gzDeclineFib), true, 'golden zone (decline): 155 is inside 150..161.8')
  eq(inGoldenZone(144, gzDeclineFib), false, 'golden zone (decline): 144 is outside')

  eq(scoreSignals(20, 144, gzRallyFib, 100).score, 3, 'score: all three factors fire → 3')
  eq(scoreSignals(50, 144, gzRallyFib, 100).score, 2, 'score: tunnel misses → 2')
  eq(scoreSignals(50, 160, gzRallyFib, 100).score, 1, 'score: only SMA fires → 1')
  eq(scoreSignals(50, 160, gzRallyFib, 200).score, 0, 'score: nothing fires → 0')
  eq(scoreSignals(30, 160, gzRallyFib, 200).tunnelOk, true, 'tunnelOk at exactly 30 (inclusive)')
  eq(scoreSignals(30.01, 160, gzRallyFib, 200).tunnelOk, false, 'tunnelOk just above 30 is false')
  eq(scoreSignals(50, 160, gzRallyFib, null).smaOk, false, 'smaOk: null SMA scores false, never throws')
  eq(scoreSignals(50, 100, gzRallyFib, 100).smaOk, false, 'smaOk: close equal to SMA is not above')

  console.log('\nTechnicals — verdict from score')
  const s3 = { tunnelOk: true, goldenOk: true, smaOk: true, score: 3 }
  const s2 = { tunnelOk: true, goldenOk: true, smaOk: false, score: 2 }
  const s1 = { tunnelOk: false, goldenOk: false, smaOk: true, score: 1 }
  const s0 = { tunnelOk: false, goldenOk: false, smaOk: false, score: 0 }
  eq(verdictFrom(s3, 20), 'strong-buy', 'score 3 → strong-buy')
  eq(verdictFrom(s2, 20), 'opportunity', 'score 2 → opportunity')
  eq(verdictFrom(s1, 50), 'fair', 'score 1 → fair')
  eq(verdictFrom(s0, 50), 'dont-buy', 'score 0 → dont-buy')
  // The veto: a high score cannot rescue price pinned at the top of the channel.
  eq(verdictFrom(s3, 70), 'dont-buy', 'veto: positionPct 70 overrides a 3/3 score')
  eq(verdictFrom(s2, 84), 'dont-buy', 'veto: positionPct 84 overrides a 2/3 score')
  eq(verdictFrom(s3, 69.99), 'strong-buy', 'veto: just under 70 does not override')

  // ── Technicals: channel math (hand-derived, not bisected) ────────
  console.log('\nTechnicals — channel math')
  const barsFromCloses = (closes: number[]): Bar[] =>
    closes.map((c, i) => ({ t: i, o: c, h: c, l: c, c }))

  // 32 closes = 100 + i + e[i], e repeating [+1,-1,-1,+1] every 4 indices.
  // For ANY block of 4 consecutive indices, this pattern satisfies
  // sum(e) = 0 and sum(i*e) = 0 (b+2c+3d = -1-2+3 = 0 for (a,b,c,d) =
  // (1,-1,-1,1), independent of the block's starting index) — i.e. it's
  // exactly orthogonal to the regression's own basis (the constant term and
  // the x term), so it contributes NOTHING to the OLS fit. The fit is
  // therefore *exactly* slope 1, intercept 100 (reproducing the underlying
  // "100 + i" line), and every residual is exactly e[i] = ±1, so sigma is
  // exactly 1 (population: sqrt(32 * 1^2 / 32)). No search, no floating
  // slop — every expected value below is closed-form arithmetic.
  //   mid[31]  = 100 + 31            = 131
  //   upper[31] = 131 + 2*1          = 133
  //   lower[31] = 131 - 2*1          = 129
  //   lastClose = 100 + 31 + e[31]   = 131 + 1 = 132   (31 % 4 === 3 → +1)
  //   positionPct = (132 - 129) / (133 - 129) * 100 = 75
  // (A sample-variance (÷n-1) implementation would give sigma ≈ 1.0159 and
  // positionPct ≈ 74.606, not 75 — this fixture discriminates the divisor.)
  const unitPattern = [1, -1, -1, 1]
  const knownChannelCloses = Array.from({ length: 32 }, (_, i) => 100 + i + unitPattern[i % 4])
  const knownChannel = buildChannel(barsFromCloses(knownChannelCloses))
  approx(knownChannel?.slopePerDay ?? null, 1, 1e-9, 'channel slope on 100+i+e[i] fixture → exactly 1')
  approx(knownChannel?.upper[31] ?? null, 133, 1e-9, 'channel upper[n-1] → 131 + 2*sigma(1) = 133')
  approx(knownChannel?.lower[31] ?? null, 129, 1e-9, 'channel lower[n-1] → 131 - 2*sigma(1) = 129')
  approx(knownChannel?.positionPct ?? null, 75, 1e-6, 'channel positionPct on known fixture → exactly 75')

  // Same 32-point, 8-block construction, but now scale only the LAST block
  // by s (still orthogonal to the fit for any s, by linearity of the
  // sum(e)=0 / sum(i*e)=0 identities above) so the last residual is exactly
  // s. With m=8 blocks and target residual = k*sigma, solving
  // sigma^2 = [(m-1) + s^2] / m against s = k*sigma gives the closed form
  // sigma^2 = (m-1)/(m-k^2). For k=+-2 (the rails): sigma^2 = 7/4, s = +-sqrt(7).
  // For k=0 (mid): s = 0 trivially (last block untouched, residual 0).
  const railCloses = (s: number): number[] =>
    Array.from({ length: 32 }, (_, i) => {
      const scale = Math.floor(i / 4) === 7 ? s : 1 // only the last block (idx 28-31) is scaled
      return 100 + i + scale * unitPattern[i % 4]
    })

  const upperRailTech = analyze(barsFromCloses(railCloses(Math.sqrt(7))))
  approx(upperRailTech.positionPct, 100, 1e-6, 'positionPct at upper rail (derived, not bisected) → 100')

  const lowerRailTech = analyze(barsFromCloses(railCloses(-Math.sqrt(7))))
  approx(lowerRailTech.positionPct, 0, 1e-6, 'positionPct at lower rail (derived, not bisected) → 0')

  const midRailTech = analyze(barsFromCloses(railCloses(0)))
  approx(midRailTech.positionPct, 50, 1e-6, 'positionPct at channel mid (derived, not bisected) → 50')

  // Flat series: sigma = 0 collapses upper/lower onto mid — the ratio is
  // undefined, defined as dead-center (50) rather than NaN/Infinity.
  const flatTech = analyze(barsFromCloses(new Array(MIN_CHANNEL_BARS).fill(100)))
  eq(flatTech.positionPct, 50, 'Flat series (sigma 0) → positionPct 50, not NaN/Infinity')

  // ── Technicals: findPivots ───────────────────────────────────────
  console.log('\nTechnicals — findPivots')
  const pivotBars: Bar[] = []
  for (let i = 0; i < 20; i++) {
    let h = 100, l = 90
    if (i === 5) l = 50 // obvious confirmed trough
    if (i === 10) h = 150 // obvious confirmed peak
    if (i === 18) h = 200 // global max, but inside the last PIVOT_K bars — must not confirm
    pivotBars.push({ t: i, o: h, h, l, c: l })
  }
  const pivots = findPivots(pivotBars, PIVOT_K)
  eq(JSON.stringify(pivots.highs), JSON.stringify([10]), 'findPivots: single confirmed peak at index 10')
  eq(JSON.stringify(pivots.lows), JSON.stringify([5]), 'findPivots: single confirmed trough at index 5')
  eq(
    pivots.highs.includes(18),
    false,
    'findPivots: last k bars never confirm (index 18 excluded despite being the global max)',
  )

  // ── Technicals: computeFib fallback ──────────────────────────────
  console.log('\nTechnicals — computeFib fallback')
  const fibBars: Bar[] = []
  for (let i = 0; i < 20; i++) {
    let h = 100, l = 99
    if (i === 5) l = 98.5 // confirmed low
    if (i === 10) h = 101 // confirmed high
    fibBars.push({ t: i, o: h, h, l, c: l })
  }
  // Pivots exist (index 5 low, index 10 high) but the swing is only ~2.5%,
  // under MIN_SWING_PCT — falls back to the window high/low instead.
  const fibFallback = computeFib(fibBars)
  eq(fibFallback?.anchor ?? 'MISSING', 'window', 'computeFib: sub-threshold swing falls back to anchor "window"')

  // Mis-ordered pivot pair: a confirmed pivot HIGH at index 40 (price ~100)
  // followed by a confirmed pivot LOW at index 60 (price ~120) — a trending
  // series where the more recent local trough still sits above the older
  // local peak. The two pivots are independent local extrema with no
  // ordering guarantee between them; asserting the pair is rejected (falls
  // back to the window anchor) rather than emitted as high(100) < low(120).
  const trendPivotBars: Bar[] = []
  for (let i = 0; i < 70; i++) {
    let h: number, l: number
    if (i < 30) { h = 50; l = 49 } // filler, far below both zones — never a pivot (flat, ties)
    else if (i < 50) { h = i === 40 ? 100 : 95; l = 94 } // pivot HIGH at 40
    else { h = 126; l = i === 60 ? 120 : 125 } // pivot LOW at 60, priced ABOVE the idx-40 high
    trendPivotBars.push({ t: i, o: h, h, l, c: l })
  }
  const trendPivots = findPivots(trendPivotBars, PIVOT_K)
  eq(JSON.stringify(trendPivots.highs), JSON.stringify([40]), 'mis-ordered fixture: pivot high only at index 40')
  eq(JSON.stringify(trendPivots.lows), JSON.stringify([60]), 'mis-ordered fixture: pivot low only at index 60')
  const trendFib = computeFib(trendPivotBars)
  eq(
    trendFib?.anchor ?? 'MISSING',
    'window',
    'computeFib: mis-ordered pivot pair (low priced above high) falls back to window, not an inverted swing',
  )
  eq(
    (trendFib?.high ?? -1) >= (trendFib?.low ?? -1),
    true,
    'computeFib: high >= low always holds (window fallback is max/min over the window, never inverted)',
  )

  // ── Technicals: computeFib swing anchor (rally + decline) ────────
  // Both branches below matter: a live run of the pipeline against 12 real
  // tickers returned anchor: 'swing' 12/12 (5 rally, 7 decline) — the
  // fallback tested above is the rare path, this is the one every real
  // verdict is actually built on.
  console.log('\nTechnicals — computeFib swing anchor')

  // Reuses pivotBars from the findPivots section above (already asserted
  // there: confirmed low at index 5 → l=50, confirmed high at index 10 →
  // h=150). Swing = (150-50)/50*100 = 200% >= MIN_SWING_PCT, and the high is
  // more recent than the low → direction 'rally'.
  const rallyFib = computeFib(pivotBars)
  eq(rallyFib?.anchor ?? 'MISSING', 'swing', 'computeFib rally: anchors on the confirmed swing, not the window fallback')
  eq(rallyFib?.direction ?? 'MISSING', 'rally', 'computeFib rally: high (idx 10) more recent than low (idx 5) → rally')
  // Hand arithmetic: rally level = high - (high-low)*ratio = 150 - (150-50)*0.618 = 150 - 61.8 = 88.2
  const rally618 = rallyFib?.levels.find((l) => l.ratio === 0.618)
  approx(rally618?.price ?? null, 88.2, 1e-9, 'computeFib rally: 0.618 level = 150 - 100*0.618 = 88.2')

  // Mirror image of pivotBars: confirmed peak at index 5 (h=150), confirmed
  // trough at index 10 (l=40), everything else flat at the same baseline
  // (h=100, l=90) so nothing else in the window can confirm. The low is more
  // recent than the high → direction 'decline'.
  const declineBars: Bar[] = []
  for (let i = 0; i < 20; i++) {
    let h = 100, l = 90
    if (i === 5) h = 150 // confirmed peak
    if (i === 10) l = 40 // confirmed trough
    declineBars.push({ t: i, o: h, h, l, c: l })
  }
  const declinePivots = findPivots(declineBars, PIVOT_K)
  eq(JSON.stringify(declinePivots.highs), JSON.stringify([5]), 'computeFib decline fixture: single confirmed peak at index 5')
  eq(JSON.stringify(declinePivots.lows), JSON.stringify([10]), 'computeFib decline fixture: single confirmed trough at index 10')

  const declineFib = computeFib(declineBars)
  eq(declineFib?.anchor ?? 'MISSING', 'swing', 'computeFib decline: anchors on the confirmed swing, not the window fallback')
  eq(declineFib?.direction ?? 'MISSING', 'decline', 'computeFib decline: low (idx 10) more recent than high (idx 5) → decline')
  // Hand arithmetic: decline level = low + (high-low)*ratio = 40 + (150-40)*0.618 = 40 + 67.98 = 107.98
  const decline618 = declineFib?.levels.find((l) => l.ratio === 0.618)
  approx(decline618?.price ?? null, 107.98, 1e-9, 'computeFib decline: 0.618 level = 40 + 110*0.618 = 107.98')

  // ── Technicals: findGaps ─────────────────────────────────────────
  console.log('\nTechnicals — findGaps')
  const mkBar = (t: number, h: number, l: number): Bar => ({ t, o: (h + l) / 2, h, l, c: (h + l) / 2 })

  const gapUpBars = [mkBar(0, 100, 99), mkBar(1, 104, 103)] // 3% gap up, nothing after to fill it
  const gapUp = findGaps(gapUpBars)
  eq(gapUp.length, 1, 'findGaps: 3% unclosed gap up is returned')
  approx(gapUp[0]?.pct ?? null, 3, 1e-9, 'findGaps: gap pct ≈ 3')
  eq(gapUp[0]?.direction, 'up', 'findGaps: direction is up')

  const gapSmallBars = [mkBar(0, 200, 199), mkBar(1, 203, 202)] // 1% gap, below GAP_MIN_PCT
  eq(findGaps(gapSmallBars).length, 0, 'findGaps: 1% gap is dropped (below threshold)')

  const gapFilledBars = [
    mkBar(0, 300, 299),
    mkBar(1, 310, 309), // 3% gap up vs bar 0
    mkBar(2, 320, 295), // trades back through 300 → fills it, without opening a new gap
  ]
  eq(findGaps(gapFilledBars).length, 0, 'findGaps: 3% gap later traded through is dropped (filled)')

  // ── Technicals: smaSeries ────────────────────────────────────────
  console.log('\nTechnicals — smaSeries')
  const smaBars = Array.from({ length: 5 }, (_, i) => ({ t: i, o: i, h: i, l: i, c: i + 1 })) // closes 1..5
  const sma3 = smaSeries(smaBars, 3, 5)
  eq(sma3[0], null, 'smaSeries: null before warmup satisfied (period 3, index 0)')
  eq(sma3[1], null, 'smaSeries: null before warmup satisfied (period 3, index 1)')
  approx(sma3[2], 2, 1e-9, 'smaSeries: mean of closes[0..2] = (1+2+3)/3 = 2')
  approx(sma3[4], 4, 1e-9, 'smaSeries: mean of closes[2..4] = (3+4+5)/3 = 4')

  // ── Technicals: analyze edge cases ───────────────────────────────
  console.log('\nTechnicals — analyze edge cases')
  const emptyTech = analyze([])
  eq(emptyTech.verdict, 'insufficient-history', 'analyze([]): verdict is insufficient-history')
  eq(emptyTech.channel, null, 'analyze([]): channel is null')
  eq(emptyTech.positionPct, null, 'analyze([]): positionPct is null')
  eq(emptyTech.visible.length, 0, 'analyze([]): visible is empty, no crash')

  const singleTech = analyze([{ t: 0, o: 1, h: 1, l: 1, c: 1 }])
  eq(singleTech.verdict, 'insufficient-history', 'analyze single bar: verdict is insufficient-history')
  eq(singleTech.sma150[0], null, 'analyze single bar: sma150 null (warmup not satisfied)')

  // ── Technicals: retracementRatio ─────────────────────────────────
  console.log('\nTechnicals — retracementRatio')
  // Note: named retRallyFib/retDeclineFib (not rallyFib/declineFib) — those
  // names are already taken by the computeFib() test consts above, in the
  // same function scope.
  const retRallyFib: Fib = {
    high: 200,
    low: 100,
    direction: 'rally',
    anchor: 'swing',
    levels: [],
  }
  // Rally: measured down from the high, so 150 is a 50% retracement.
  approx(retracementRatio(150, retRallyFib), 0.5, 1e-9, 'rally: midpoint is ratio 0.5')
  approx(retracementRatio(200, retRallyFib), 0, 1e-9, 'rally: the high is ratio 0')
  approx(retracementRatio(100, retRallyFib), 1, 1e-9, 'rally: the low is ratio 1')
  approx(retracementRatio(138.2, retRallyFib), 0.618, 1e-9, 'rally: 138.2 is the 0.618 level')

  const retDeclineFib: Fib = {
    high: 200,
    low: 100,
    direction: 'decline',
    anchor: 'swing',
    levels: [],
  }
  // Decline: measured up from the low, so 150 is still 0.5 but 161.8 is 0.618.
  approx(retracementRatio(150, retDeclineFib), 0.5, 1e-9, 'decline: midpoint is ratio 0.5')
  approx(retracementRatio(161.8, retDeclineFib), 0.618, 1e-9, 'decline: 161.8 is the 0.618 level')
  eq(retracementRatio(150, null), null, 'retracementRatio: null fib returns null')
  eq(
    retracementRatio(100, { high: 100, low: 100, direction: 'rally', anchor: 'swing', levels: [] }),
    null,
    'retracementRatio: zero-span swing returns null, not a divide-by-zero',
  )

  // inGoldenZone must still agree with its documented behaviour, now that it
  // delegates: on a rally the golden band is 138.2–150, on a decline 150–161.8.
  eq(inGoldenZone(145, retRallyFib), true, 'inGoldenZone: rally, 145 is inside the band')
  eq(inGoldenZone(180, retRallyFib), false, 'inGoldenZone: rally, 180 is above the band')
  eq(inGoldenZone(155, retDeclineFib), true, 'inGoldenZone: decline, 155 is inside the band')
  eq(inGoldenZone(120, retDeclineFib), false, 'inGoldenZone: decline, 120 is below the band')
  eq(inGoldenZone(145, null), false, 'inGoldenZone: null fib is false')

  // ── Derivations ──────────────────────────────────────────────────
  console.log('\nDerivations')
  approx(epsCagr5yr(30, 1.5), 20, 1e-9, 'epsCagr5yr: P/E 30 ÷ PEG 1.5 = 20%')
  eq(epsCagr5yr(30, 0), null, 'epsCagr5yr: PEG of 0 returns null, not Infinity')
  eq(epsCagr5yr(null, 1.5), null, 'epsCagr5yr: missing P/E returns null')
  eq(epsCagr5yr(30, null), null, 'epsCagr5yr: missing PEG returns null')

  approx(pctFromAth(80, 100), -20, 1e-9, 'pctFromAth: 80 vs ATH 100 is -20%')
  approx(pctFromAth(100, 100), 0, 1e-9, 'pctFromAth: at the ATH is 0%')
  eq(pctFromAth(80, 0), null, 'pctFromAth: ATH of 0 returns null')
  eq(pctFromAth(null, 100), null, 'pctFromAth: missing price returns null')

  approx(vsSma150Pct(110, 100), 10, 1e-9, 'vsSma150Pct: 10% above the SMA')
  approx(vsSma150Pct(90, 100), -10, 1e-9, 'vsSma150Pct: 10% below the SMA')
  eq(vsSma150Pct(110, 0), null, 'vsSma150Pct: SMA of 0 returns null')
  eq(vsSma150Pct(110, null), null, 'vsSma150Pct: missing SMA returns null')

  // ── TripleQ Score ────────────────────────────────────────────────
  console.log('\nTripleQ Score — gates')

  // A synthetic Technicals with dials for every technical factor. Only the
  // fields the scorer reads are populated; the rest are inert.
  function mkTech(positionPct: number, close: number, fib: Fib | null): Technicals {
    return {
      visible: [{ t: 0, o: close, h: close, l: close, c: close }],
      sma150: [null],
      channel: { upper: [], mid: [], lower: [], slopePerDay: 0, positionPct },
      fib,
      gaps: [],
      verdict: 'fair',
      positionPct,
      signals: null,
      windowBars: 126,
      fullRange: null,
    }
  }

  // A ticker that passes every gate and scores near the top: mega cap, all
  // three growth readings green, price below the ATH, sitting on its SMA, at
  // the bottom of the channel, inside the golden zone, 15% off the high.
  const perfect: ScoreInput = {
    symbol: 'AAA',
    name: 'Alpha',
    price: 100,
    marketCap: 1e12,
    trailingPe: 30,
    sma150: 100,
    // -25% from the high is the drawdown curve's full-credit point. Getting
    // this wrong is why the "scores 100" assertion below is worth having.
    allTimeHigh: 400 / 3, // 100 / 0.75 → pctFromAth = -25%
    yoyPct: 40,
    yoyState: 'pass',
    ntmPct: 40,
    ntmState: 'pass',
    epsCagr5yr: 40,
    technicals: mkTech(0, 100, { high: 200, low: 0, direction: 'rally', anchor: 'swing', levels: [] }),
  }

  const perfectEval = evaluate(perfect)
  eq(perfectEval.passedGates, true, 'gates: the perfect input passes all five')
  eq(perfectEval.gates.length, 5, 'gates: five gates are reported')
  approx(perfectEval.score, 100, 0.05, 'score: the perfect input scores 100')

  // ── deriveLevels: fibAnchor carries technicals.ts's own contract ───
  // Fib.anchor ('swing' | 'window') tells the dashboard whether a ladder is
  // a real swing retracement or a fallback drawn off the window's plain
  // high/low (TechnicalChart.tsx labels the fallback "window extremes").
  // deriveLevels must carry that same distinction into the email, not
  // silently drop it and present every fallback ladder as a real swing.
  eq(
    deriveLevels(mkTech(0, 100, { high: 200, low: 0, direction: 'rally', anchor: 'swing', levels: [] }))
      ?.fibAnchor,
    'swing',
    'deriveLevels: fibAnchor carries a real swing anchor through',
  )
  eq(
    deriveLevels(mkTech(0, 100, { high: 200, low: 0, direction: 'rally', anchor: 'window', levels: [] }))
      ?.fibAnchor,
    'window',
    'deriveLevels: fibAnchor carries a window (fallback) anchor through',
  )
  eq(
    deriveLevels(mkTech(0, 100, null))?.fibAnchor,
    null,
    'deriveLevels: fibAnchor is null when there is no fib at all (no swing to anchor)',
  )
  eq(deriveLevels(null), null, 'deriveLevels: null technicals produces null levels end-to-end')

  // Each gate must reject on its own.
  eq(
    evaluate({ ...perfect, marketCap: MIN_MARKET_CAP - 1 }).passedGates,
    false,
    'gate 1: market cap below $500B is rejected',
  )
  eq(
    evaluate({ ...perfect, marketCap: MIN_MARKET_CAP }).passedGates,
    true,
    'gate 1: exactly $500B passes (inclusive)',
  )
  eq(evaluate({ ...perfect, marketCap: null }).passedGates, false, 'gate 1: unknown market cap is rejected')
  eq(evaluate({ ...perfect, yoyPct: -1 }).passedGates, false, 'gate 2: negative YoY EPS is rejected')
  eq(
    evaluate({ ...perfect, yoyPct: null, yoyState: 'turnaround' }).passedGates,
    false,
    'gate 2: a turnaround has no growth rate, so it is rejected',
  )
  eq(evaluate({ ...perfect, ntmPct: 0 }).passedGates, false, 'gate 3: zero NTM growth is rejected')
  eq(evaluate({ ...perfect, ntmState: 'na' }).passedGates, false, 'gate 3: an n/a NTM reading is rejected')
  eq(evaluate({ ...perfect, epsCagr5yr: -5 }).passedGates, false, 'gate 4: negative EPS CAGR is rejected')
  eq(evaluate({ ...perfect, epsCagr5yr: null }).passedGates, false, 'gate 4: unknown EPS CAGR is rejected')
  eq(
    evaluate({ ...perfect, price: 400 / 3 }).passedGates,
    false,
    'gate 5: price at the all-time high is rejected',
  )
  eq(
    evaluate({ ...perfect, price: 150 }).passedGates,
    false,
    'gate 5: price above the all-time high is rejected',
  )
  eq(evaluate({ ...perfect, allTimeHigh: null }).passedGates, false, 'gate 5: unknown ATH is rejected')

  console.log('\nTripleQ Score — factors')
  const pointsOf = (e: ReturnType<typeof evaluate>, key: string) =>
    e.factors.find((f) => f.key === key)?.points ?? -1

  // Growth: 10 points per metric, full credit at +30%, linear below, capped above.
  approx(pointsOf(perfectEval, 'growth'), WEIGHTS.growth, 1e-6, 'growth: +40% on all three earns the full 30')
  approx(
    pointsOf(evaluate({ ...perfect, yoyPct: 15, ntmPct: 15, epsCagr5yr: 15 }), 'growth'),
    WEIGHTS.growth / 2,
    1e-6,
    'growth: +15% on all three is half credit',
  )

  // SMA proximity: peaks on the SMA, zero at ±15%.
  approx(pointsOf(perfectEval, 'sma'), WEIGHTS.sma, 1e-6, 'sma: price on the SMA earns the full 20')
  approx(
    pointsOf(evaluate({ ...perfect, sma150: 100 / 1.075 }), 'sma'),
    WEIGHTS.sma / 2,
    0.01,
    'sma: 7.5% above the SMA is half credit',
  )
  approx(
    pointsOf(evaluate({ ...perfect, sma150: 100 / 1.3 }), 'sma'),
    0,
    1e-6,
    'sma: 30% above the SMA earns nothing (clamped, never negative)',
  )
  approx(
    pointsOf(evaluate({ ...perfect, sma150: null }), 'sma'),
    0,
    1e-6,
    'sma: a missing SMA scores zero, not a free pass',
  )

  // Tunnel: bottom of the channel is full credit, top is zero, clamped outside.
  approx(pointsOf(perfectEval, 'tunnel'), WEIGHTS.tunnel, 1e-6, 'tunnel: channel floor earns the full 20')
  approx(
    pointsOf(evaluate({ ...perfect, technicals: mkTech(50, 100, perfect.technicals!.fib) }), 'tunnel'),
    WEIGHTS.tunnel / 2,
    1e-6,
    'tunnel: mid-channel is half credit',
  )
  approx(
    pointsOf(evaluate({ ...perfect, technicals: mkTech(130, 100, perfect.technicals!.fib) }), 'tunnel'),
    0,
    1e-6,
    'tunnel: above the upper rail clamps to zero, never negative',
  )
  approx(
    pointsOf(evaluate({ ...perfect, technicals: null }), 'tunnel'),
    0,
    1e-6,
    'tunnel: absent technicals score zero',
  )

  // Golden zone: full inside 0.5–0.618, tapering to zero at 0.236 / 0.786.
  const goldenAt = (ratio: number) => {
    // rally fib high 200 low 0 → close = 200 - 200*ratio
    const close = 200 - 200 * ratio
    return pointsOf(
      evaluate({
        ...perfect,
        technicals: mkTech(0, close, { high: 200, low: 0, direction: 'rally', anchor: 'swing', levels: [] }),
      }),
      'golden',
    )
  }
  approx(goldenAt(0.55), WEIGHTS.golden, 1e-6, 'golden: 0.55 retracement is full credit')
  approx(goldenAt(0.5), WEIGHTS.golden, 1e-6, 'golden: the 0.5 edge is full credit')
  approx(goldenAt(0.618), WEIGHTS.golden, 1e-6, 'golden: the 0.618 edge is full credit')
  approx(goldenAt(0.368), WEIGHTS.golden / 2, 0.01, 'golden: halfway from 0.236 to 0.5 is half credit')
  approx(goldenAt(0.236), 0, 1e-6, 'golden: the 0.236 knot is zero')
  approx(goldenAt(0.1), 0, 1e-6, 'golden: shallower than 0.236 is zero')
  approx(goldenAt(0.9), 0, 1e-6, 'golden: deeper than 0.786 is zero')

  // Drawdown: rewards a real pullback, not a broken trend.
  const ddAt = (dd: number) =>
    pointsOf(evaluate({ ...perfect, price: 100, allTimeHigh: 100 / (1 - dd / 100) }), 'drawdown')
  approx(ddAt(25), WEIGHTS.drawdown, 0.01, 'drawdown: -25% is full credit')
  approx(ddAt(30), WEIGHTS.drawdown, 0.01, 'drawdown: -30% still full credit (plateau)')
  approx(ddAt(8), WEIGHTS.drawdown * 0.4, 0.01, 'drawdown: -8% is 40% credit')
  approx(ddAt(45), 0, 0.01, 'drawdown: -45% is a broken trend, zero credit')
  approx(ddAt(60), 0, 0.01, 'drawdown: beyond -45% stays zero')

  // ── Score invariance across the widened input ────────────────────
  console.log('\nTripleQ Score — invariance under added context')
  const widened: ScoreInput = {
    ...perfect,
    forwardPe: 22.4,
    peg5yr: 1.8,
    netMarginTtm: 0.31,
    grossMarginTtm: 0.62,
    operatingMarginTtm: 0.4,
    roiTtm: 0.27,
    epsSurprisePct: 6.2,
    change1dPct: -1.4,
    change1wPct: 2.9,
    change1mPct: 8.1,
    fullRange: { high: 150, low: 60, pctFromHigh: -12, pctFromLow: 25 },
  }
  approx(
    evaluate(widened).score,
    evaluate(perfect).score,
    1e-9,
    'invariance: adding context fields moves the score by exactly zero',
  )
  eq(
    JSON.stringify(evaluate(widened).factors.map((f) => f.points)),
    JSON.stringify(evaluate(perfect).factors.map((f) => f.points)),
    'invariance: every individual factor is unchanged',
  )
  eq(
    JSON.stringify(evaluate(widened).gates.map((g) => g.passed)),
    JSON.stringify(evaluate(perfect).gates.map((g) => g.passed)),
    'invariance: every gate verdict is unchanged',
  )

  console.log('\nTripleQ Score — selection')
  const mk = (symbol: string, over: Partial<ScoreInput>): ScoreInput => ({ ...perfect, symbol, ...over })

  // A weak-but-passing name: all gates green, growth barely positive (1%),
  // and the SMA/tunnel/drawdown factors all at their worst (30% above the
  // SMA, top of the channel, -60% beyond the drawdown curve's domain) — but
  // NOT the golden factor: close=100 against a 200/0 rally swing is a 0.5
  // retracement, the golden curve's full-credit point (see the `goldenAt`
  // assertions above). Growth (~1pt) + golden (15pts full) still isn't
  // enough to clear the 50 cutoff.
  const weak = mk('WEAK', {
    yoyPct: 1,
    ntmPct: 1,
    epsCagr5yr: 1,
    sma150: 100 / 1.3,
    allTimeHigh: 100 / (1 - 0.6),
    technicals: mkTech(100, 100, { high: 200, low: 0, direction: 'rally', anchor: 'swing', levels: [] }),
  })
  eq(evaluate(weak).passedGates, true, 'selection: the weak name passes every gate')
  eq(evaluate(weak).score < MIN_SCORE, true, 'selection: the weak name scores under the cutoff')

  const sel = selectPicks([weak, mk('BBB', {}), mk('CCC', { marketCap: 1 })])
  eq(sel.picks.length, 1, 'selection: only the qualifying, above-cutoff name is picked')
  eq(sel.picks[0].symbol, 'BBB', 'selection: the picked name is the one that qualified')
  eq(sel.considered, 3, 'selection: reports how many were considered')
  eq(sel.belowCutoff, 1, 'selection: reports how many cleared the gates but missed the cutoff')

  // Ordering and the cap.
  const many = Array.from({ length: 14 }, (_, i) =>
    mk(`T${String(i).padStart(2, '0')}`, { yoyPct: 30 - i, ntmPct: 30 - i, epsCagr5yr: 30 - i }),
  )
  const capped = selectPicks(many)
  eq(capped.picks.length, MAX_PICKS, 'selection: never returns more than MAX_PICKS')
  eq(capped.picks[0].symbol, 'T00', 'selection: the highest score ranks first')
  eq(
    capped.picks.every((p, i, a) => i === 0 || a[i - 1].score >= p.score),
    true,
    'selection: picks are ordered by score descending',
  )

  // Ties break on symbol so two runs of the same data produce the same email.
  const tied = selectPicks([mk('ZZZ', {}), mk('AAB', {})])
  eq(tied.picks[0].symbol, 'AAB', 'selection: equal scores tie-break on symbol ascending')

  eq(selectPicks([]).picks.length, 0, 'selection: an empty watchlist yields no picks')
  eq(
    selectPicks([mk('DDD', { marketCap: 1 })]).picks.length,
    0,
    'selection: a list where nothing qualifies yields no picks',
  )
  eq(
    evaluate(perfect).reasons.length > 0,
    true,
    'reasons: a high-scoring pick explains itself',
  )

  // ── Email renderers ─────────────────────────────────────────────
  // The only Critical this branch found was a proved XSS in renderConfirm.
  // It was fixed and the payload deleted, but no regression guard was left
  // behind — these assertions are that guard. Local names are prefixed
  // `renderer` to avoid colliding with the many consts already declared
  // above in this same function scope (mk, perfect, capped, tied, ...).
  console.log('\nEmail renderers')

  const rendererXssPayload = '"><script>alert(1)</script>'

  const rendererConfirmHtml = renderConfirm({
    firstName: 'Test',
    confirmUrl: rendererXssPayload,
  }).html
  eq(
    rendererConfirmHtml.includes('<script'),
    false,
    'renderConfirm: an XSS payload in confirmUrl is escaped, not rendered as a tag',
  )

  const rendererXssPick = toPick(evaluate(mk('XSS', { name: rendererXssPayload })))
  const rendererDigestXssHtml = renderDigest({
    recipient: { firstName: 'Test', unsubscribeToken: 'tok' },
    selection: { picks: [rendererXssPick], considered: 1, belowCutoff: 0 },
    asOfLabel: 'Monday, 1 January 2026',
    siteUrl: 'https://example.com',
    indices: [],
  }).html
  eq(
    rendererDigestXssHtml.includes('<script'),
    false,
    'renderDigest: an XSS payload in a pick name is escaped, not rendered as a tag',
  )

  const rendererEmpty = renderDigest({
    recipient: { firstName: 'Test', unsubscribeToken: 'tok' },
    selection: { picks: [], considered: 12, belowCutoff: 2 },
    asOfLabel: 'Monday, 1 January 2026',
    siteUrl: 'https://example.com',
    indices: [],
  })
  eq(
    rendererEmpty.subject,
    'TripleQ Daily Maily — no setups cleared the bar today',
    'renderDigest: zero picks renders the no-setups subject variant',
  )
  eq(
    rendererEmpty.html.includes('Nothing cleared the bar this morning'),
    true,
    'renderDigest: zero picks renders the empty-state body',
  )

  // Every numeric input null (not just technicals) — exercises every
  // null-guarded formatter (usd/bigUsd/num/pct) plus the tunnel bar's own
  // inline `.toFixed(0)`, which is not routed through pct()/format.ts.
  const rendererNullPick = toPick(
    evaluate(
      mk('NULLS', {
        price: null,
        marketCap: null,
        trailingPe: null,
        sma150: null,
        allTimeHigh: null,
        yoyPct: null,
        ntmPct: null,
        epsCagr5yr: null,
        technicals: null,
      }),
    ),
  )
  const rendererNullHtml = renderDigest({
    recipient: { firstName: 'Test', unsubscribeToken: 'tok' },
    selection: { picks: [rendererNullPick], considered: 1, belowCutoff: 0 },
    asOfLabel: 'Monday, 1 January 2026',
    siteUrl: 'https://example.com',
    indices: [],
  }).html
  eq(
    rendererNullHtml.includes('NaN%'),
    false,
    'renderDigest: null technical readings never render as "NaN%"',
  )

  // Email clients: Gmail drops inline SVG, and neither Gmail nor Outlook
  // (which renders through Word) can be trusted with flex/grid layout — every
  // "chart" in this email must be a table with percentage-width cells.
  const rendererFullHtml = renderDigest({
    recipient: { firstName: 'Test', unsubscribeToken: 'tok' },
    selection: capped,
    asOfLabel: 'Monday, 1 January 2026',
    siteUrl: 'https://example.com',
    indices: [],
  }).html
  eq(rendererFullHtml.includes('<svg'), false, 'renderDigest: no inline SVG anywhere in the output')
  eq(rendererFullHtml.includes('display:flex'), false, 'renderDigest: no flexbox layout anywhere in the output')
  eq(rendererFullHtml.includes('display:grid'), false, 'renderDigest: no grid layout anywhere in the output')

  // ── Email renderer — the prepared-row (PrepPickRecord) branch ────
  // Task 7's digest route reads picks back from screener_digest_prep as
  // `PrepPickRecord`s (a `toDigestPickRecord` projection + chartUrl), not
  // full `ScoredPick`s, and `considered`/`belowCutoff` come from columns
  // (migration 0031) that are null on a row written before it. Nothing
  // above exercises that branch of card()/renderDigest — this is the
  // committed guard the scratchpad verification from Task 7's first pass
  // never became.
  console.log('\nEmail renderers — prepared-row branch')

  // A fresh prepared pick: exactly what a post-fix-round upsert writes —
  // real reasons, real positionPct/retracement, and a real signal state.
  // yoyPct: 10 with yoyState: 'flag' is the case the reviewer called out as
  // mattering most: 10% is soft-positive (0–20% is 'flag', amber), so if the
  // chip were coloured by sign instead of by state it would wrongly render
  // green ('positive') — indistinguishable from a genuine >=20% 'pass'.
  const rendererFreshFlagPick = toPick(
    evaluate(mk('FRESH', { yoyPct: 10, yoyState: 'flag', ntmPct: 40, ntmState: 'pass' })),
  )
  const rendererPrepFresh: PrepPickRecord = {
    ...toDigestPickRecord(rendererFreshFlagPick),
    chartUrl: 'https://example.com/chart/FRESH.png',
  }
  eq(
    rendererPrepFresh.reasons.length > 0 && rendererPrepFresh.yoyState === 'flag',
    true,
    'fixture sanity: the fresh prepared pick carries real reasons and yoyState',
  )

  // A legacy row: same yoyPct (10, soft-positive), but written before this
  // fix round — the jsonb payload genuinely lacks reasons/positionPct/
  // retracement/yoyState/ntmState at runtime even though the TS type now
  // claims they're required. The cast mirrors readPrep's own
  // `as PrepPickRecord[]` (no runtime validation), not a type escape hatch
  // invented for this test — it is what a real old row looks like once cast.
  const rendererPrepLegacy = {
    symbol: 'LEGACY',
    name: 'Legacy Co',
    score: 55.5,
    factors: [],
    price: 42,
    marketCap: 900_000_000_000,
    trailingPe: 20,
    yoyPct: 10,
    ntmPct: -2,
    epsCagr5yr: 1,
    vsSma150Pct: 0.5,
    pctFromAth: -5,
    forwardPe: null,
    peg5yr: null,
    netMarginTtm: null,
    grossMarginTtm: null,
    operatingMarginTtm: null,
    roiTtm: null,
    epsSurprisePct: null,
    change1dPct: null,
    change1wPct: null,
    change1mPct: null,
    fullRange: null,
    chartUrl: null,
  } as unknown as PrepPickRecord

  const rendererPrepSelection: DigestSelection = {
    picks: [rendererPrepFresh, rendererPrepLegacy],
    // Null exactly as a pre-0031 row (or a row `readPrep` mapped before the
    // columns existed) reports it — the denominator-free header branch.
    considered: null,
    belowCutoff: null,
  }

  const rendererPrepMail = renderDigest({
    recipient: { firstName: 'Test', unsubscribeToken: 'tok' },
    selection: rendererPrepSelection,
    asOfLabel: 'Monday, 1 January 2026',
    siteUrl: 'https://example.com',
    indices: [],
    commentary: { marketRead: 'Markets steady.', perStock: { FRESH: 'Strong quarter.' } },
  })

  eq(
    rendererPrepMail.html.includes('NaN'),
    false,
    'renderDigest (prep row): no "NaN" anywhere, full or legacy pick',
  )
  eq(
    // The rendered sentence capitalizes only the very first character of the
    // whole joined reason list (see the `card()` reason-building logic in
    // render.ts), so compare from index 1 — everything after that is an
    // unmodified substring of the persisted reasons[0].
    rendererPrepMail.html.includes(rendererPrepFresh.reasons[0].slice(1)),
    true,
    'renderDigest (prep row): the fresh pick shows its real persisted reason, not the generic fallback',
  )
  eq(
    rendererPrepMail.html.includes('Cleared every entry gate.'),
    true,
    'renderDigest (prep row): the legacy pick (no persisted reasons) falls back to the generic reason',
  )
  eq(
    rendererPrepMail.html.includes(PALETTE.warningInk),
    true,
    "renderDigest (prep row): a fresh 'flag' (soft-positive) YoY chip renders amber, coloured by SignalState — not green by sign",
  )
  eq(
    rendererPrepMail.html.includes('of null'),
    false,
    'renderDigest (prep row): a null considered never prints a fabricated denominator',
  )
  eq(
    rendererPrepMail.html.includes(
      `2 setups cleared the entry gate and scored ${MIN_SCORE} or better today. Ranked best first, ${MAX_PICKS} maximum.`,
    ),
    true,
    'renderDigest (prep row): a null considered degrades the header to a denominator-free sentence',
  )

  // A prepared row with zero picks (a legitimate "nothing cleared" day) and
  // no commentary must still render the empty state without a "No name
  // both..." grammar break or an "Of null names" fabricated count.
  const rendererPrepEmptyMail = renderDigest({
    recipient: { firstName: 'Test', unsubscribeToken: 'tok' },
    selection: { picks: [], considered: null, belowCutoff: null },
    asOfLabel: 'Monday, 1 January 2026',
    siteUrl: 'https://example.com',
    indices: [],
    commentary: null,
  })
  eq(
    rendererPrepEmptyMail.html.includes('Of null'),
    false,
    'renderDigest (prep row, empty): a null considered never prints "Of null" in the empty state',
  )
  eq(
    rendererPrepEmptyMail.html.includes('Nothing passed every entry gate'),
    true,
    'renderDigest (prep row, empty): the null-considered empty state reads grammatically',
  )

  // ── Email renderers — v2 template ────────────────────────────────
  // Task 9's own coverage: renderDigestV2 called directly (not through the
  // renderDigest() dispatcher), plus the dispatcher's DIGEST_TEMPLATE flag
  // itself further down. `indices: []` is required on every call now that
  // DigestData carries it (see render.ts) — that requirement is itself part
  // of what this branch is verifying: a `DigestData` literal missing the key
  // entirely no longer compiles.
  console.log('\nEmail renderers — v2 template')

  const rendererV2XssPick = toPick(evaluate(mk('XSS2', { name: rendererXssPayload })))
  const rendererV2XssHtml = renderDigestV2({
    recipient: { firstName: 'Test', unsubscribeToken: 'tok' },
    selection: { picks: [rendererV2XssPick], considered: 1, belowCutoff: 0 },
    asOfLabel: 'Monday, 1 January 2026',
    siteUrl: 'https://example.com',
    indices: [],
  }).html
  eq(
    rendererV2XssHtml.includes('<script'),
    false,
    'renderDigestV2: an XSS payload in a pick name is escaped, not rendered as a tag',
  )

  // A broken <img> in a financial email is worse than no image, so a pick
  // with no chartUrl must never emit the chart row. The card's LOGO <img> is
  // unconditional (every card gets one, chartUrl or not), so the assertion
  // targets the chart row's own alt text specifically — "no <img at all"
  // would be true of no real digest and would pass by accident.
  eq(
    rendererV2XssHtml.includes('126-day price chart'),
    false,
    'renderDigestV2: a pick with no chartUrl emits no chart <img> (the always-present logo <img> is a separate element)',
  )
  // Control case proving the assertion above can actually fail: the same
  // shape of pick WITH a chartUrl does emit the chart image.
  const rendererV2ChartPick = toPick(
    evaluate(mk('V2CHART', { chartUrl: 'https://example.com/chart/V2CHART.png' })),
  )
  const rendererV2ChartHtml = renderDigestV2({
    recipient: { firstName: 'Test', unsubscribeToken: 'tok' },
    selection: { picks: [rendererV2ChartPick], considered: 1, belowCutoff: 0 },
    asOfLabel: 'Monday, 1 January 2026',
    siteUrl: 'https://example.com',
    indices: [],
  }).html
  eq(
    rendererV2ChartHtml.includes('126-day price chart'),
    true,
    'renderDigestV2: a pick WITH a chartUrl does emit the chart <img> (control case for the assertion above)',
  )

  // Same email-client constraints as v1: no inline SVG (Gmail strips it), no
  // flex/grid (neither Gmail nor Word-rendered Outlook can be trusted with
  // it). Uses `capped` (MAX_PICKS worth of picks, defined above) plus real
  // commentary so every block in cardV2 — metrics grid, technical levels,
  // per-stock AI panel — actually renders and gets checked, not just an
  // empty shell.
  const rendererV2FullHtml = renderDigestV2({
    recipient: { firstName: 'Test', unsubscribeToken: 'tok' },
    selection: capped,
    asOfLabel: 'Monday, 1 January 2026',
    siteUrl: 'https://example.com',
    indices: [],
    commentary: { marketRead: 'Broad markets are firm into the open.', perStock: { T00: 'Strong quarter.' } },
  }).html
  eq(rendererV2FullHtml.includes('<svg'), false, 'renderDigestV2: no inline SVG anywhere in the output')
  eq(
    rendererV2FullHtml.includes('display:flex'),
    false,
    'renderDigestV2: no flexbox layout anywhere in the output',
  )
  eq(
    rendererV2FullHtml.includes('display:grid'),
    false,
    'renderDigestV2: no grid layout anywhere in the output',
  )

  // `considered: null` must never fabricate a denominator. Asserted two ways:
  // the literal "of null" never appears, AND (able to actually fail, unlike
  // a "did not throw" check) the header degrades to the exact denominator-
  // free sentence — if the null branch were ever skipped, this exact string
  // would not appear because the numbered branch would render instead.
  const rendererV2ConsideredNullHtml = renderDigestV2({
    recipient: { firstName: 'Test', unsubscribeToken: 'tok' },
    selection: { picks: [rendererV2XssPick], considered: null, belowCutoff: null },
    asOfLabel: 'Monday, 1 January 2026',
    siteUrl: 'https://example.com',
    indices: [],
  }).html
  eq(
    rendererV2ConsideredNullHtml.includes('of null'),
    false,
    'renderDigestV2: a null considered never prints a fabricated "of null" denominator',
  )
  eq(
    rendererV2ConsideredNullHtml.includes(
      `1 setup cleared the entry gate and scored ${MIN_SCORE} or better today. Ranked best first, ${MAX_PICKS} maximum.`,
    ),
    true,
    'renderDigestV2: a null considered degrades the header to the denominator-free sentence',
  )

  // ── Email renderers — the DIGEST_TEMPLATE flag ───────────────────
  // The default matters more than anything else in this task: 13 real
  // subscribers receive v1 today, and DIGEST_TEMPLATE unset must keep it
  // that way. Structural marker, not incidental text: "📐 Technical levels"
  // is the technical-levels panel's own heading, unique to v2's markup (see
  // primitives-v2.ts) and rendered unconditionally whenever a card renders —
  // its presence/absence is a direct read on which template actually ran.
  console.log('\nEmail renderers — the DIGEST_TEMPLATE flag')

  const rendererFlagPick = toPick(evaluate(mk('FLAG', {})))
  const rendererFlagData: DigestData = {
    recipient: { firstName: 'Test', unsubscribeToken: 'tok' },
    selection: { picks: [rendererFlagPick], considered: 1, belowCutoff: 0 },
    asOfLabel: 'Monday, 1 January 2026',
    siteUrl: 'https://example.com',
    indices: [],
  }
  const V2_MARKER = '📐 Technical levels'
  const originalDigestTemplate = process.env.DIGEST_TEMPLATE

  delete process.env.DIGEST_TEMPLATE
  eq(
    renderDigest(rendererFlagData).html.includes(V2_MARKER),
    false,
    'renderDigest: DIGEST_TEMPLATE unset dispatches to v1 — the v2-only technical-levels panel is absent',
  )

  process.env.DIGEST_TEMPLATE = 'v2'
  eq(
    renderDigest(rendererFlagData).html.includes(V2_MARKER),
    true,
    "renderDigest: DIGEST_TEMPLATE='v2' dispatches to v2 — the technical-levels panel is present",
  )

  // Ambiguity resolved in the brief: anything other than exactly 'v2' fails
  // safe to v1 rather than throwing or falling through to the new template.
  process.env.DIGEST_TEMPLATE = 'v3'
  eq(
    renderDigest(rendererFlagData).html.includes(V2_MARKER),
    false,
    "renderDigest: an unrecognised DIGEST_TEMPLATE ('v3') fails safe to v1, not v2",
  )
  process.env.DIGEST_TEMPLATE = ''
  eq(
    renderDigest(rendererFlagData).html.includes(V2_MARKER),
    false,
    'renderDigest: DIGEST_TEMPLATE set to the empty string falls back to v1, same as unset',
  )

  // Whitespace and case are normalised before comparison.
  process.env.DIGEST_TEMPLATE = ' V2 '
  eq(
    renderDigest(rendererFlagData).html.includes(V2_MARKER),
    true,
    "renderDigest: DIGEST_TEMPLATE=' V2 ' still matches (trimmed + lowercased) and dispatches to v2",
  )

  if (originalDigestTemplate === undefined) delete process.env.DIGEST_TEMPLATE
  else process.env.DIGEST_TEMPLATE = originalDigestTemplate

  // ── AI commentary — grounding guard ───────────────────────────────
  console.log('\nAI commentary — grounding guard')
  const perfectPickForPrompt = toPick(evaluate(perfect))
  const gPayload = buildPayload(
    [{ ...perfectPickForPrompt }],
    [{ key: 'sp500', name: 'S&P 500', ytdPct: 12.4, trailingPe: 24.1, forwardPe: 21.0 }],
  )
  eq(
    isGrounded('AAA sits at 100.0 with the S&P 500 up 12.4% this year.', gPayload),
    true,
    'grounding: prose using only supplied figures passes',
  )
  eq(
    isGrounded('AAA rallied to $412.50 on heavy volume.', gPayload),
    false,
    'grounding: an invented figure is rejected',
  )
  eq(
    isGrounded('Momentum is constructive and breadth is improving.', gPayload),
    true,
    'grounding: prose with no figures passes',
  )
  // Regex-only extraction reads "12.4" as one token, "100" as one, "109" as
  // one — three numeric literals, not four; the brief's worked example
  // assumed each digit run split further. Documented in the Task 5 report.
  eq(
    numericTokens('up 12.4% from $100 to 109').length,
    3,
    'numericTokens: extracts every numeric token',
  )

  // ── STRUCTURAL_TOKENS: period/ratio phrasing admitted unconditionally ──
  // Before this fix, the natural way to describe this system's own output —
  // "holding above its 150-day average" — tripped the guard: no payload
  // NUMBER happens to equal 150, so the whole commentary was dropped over
  // phrasing, not a fabrication.
  eq(
    isGrounded('AAA is holding above its 150-day average.', gPayload),
    true,
    'grounding: STRUCTURAL_TOKENS admits "150-day" without a matching payload value',
  )
  eq(
    isGrounded('AAA sits near the top of its 52-week range.', gPayload),
    true,
    'grounding: STRUCTURAL_TOKENS admits "52-week" the same way',
  )
  eq(
    isGrounded('AAA is pulling back toward the 61.8% retracement.', gPayload),
    true,
    'grounding: STRUCTURAL_TOKENS admits a bare Fibonacci ratio like "61.8%"',
  )

  // Five-claim regression (Task 5's fix round): confirm admitting
  // STRUCTURAL_TOKENS did NOT resurrect the index-name digit leak that fix
  // closed. Payload deliberately avoids any coincidental legitimate match —
  // price is 230.50 (not 100/500/2000/35), and the index roster reproduces
  // every name whose embedded digits used to leak (Russell 2000, Nasdaq-100,
  // S&P 500, TA-35).
  //
  // One of the reviewer's original five claims ("a breakout target near
  // $150") is deliberately NOT reproduced here: 150 is now a structural
  // token, admitted regardless of context (see STRUCTURAL_TOKENS' own doc
  // comment) — that specific claim now legitimately PASSES, which the
  // assertion right after this block confirms is the intended tradeoff, not
  // a regression.
  const fiveClaimsPick = toPick(evaluate({ ...perfect, price: 230.5 }))
  const fiveClaimsPayload = buildPayload(
    [fiveClaimsPick],
    [
      { key: 'rut', name: 'Russell 2000', ytdPct: 8.1, trailingPe: 24.6, forwardPe: 19.4 },
      { key: 'ndx', name: 'Nasdaq-100', ytdPct: 22.3, trailingPe: 31.7, forwardPe: 27.9 },
      { key: 'sp500', name: 'S&P 500', ytdPct: 12.4, trailingPe: 24.1, forwardPe: 21.0 },
      { key: 'ta35', name: 'TA-35', ytdPct: 9.6, trailingPe: 14.2, forwardPe: 12.8 },
    ],
  )
  eq(
    isGrounded('AAA is trading at $100 resistance.', fiveClaimsPayload),
    false,
    'grounding (5-claim regression): a fabricated $100 is still rejected',
  )
  eq(
    isGrounded('AAA rallied to $500 today.', fiveClaimsPayload),
    false,
    'grounding (5-claim regression): the digits inside "S&P 500" do not leak into a fabricated $500',
  )
  eq(
    isGrounded('AAA moved 2000 basis points intraday.', fiveClaimsPayload),
    false,
    'grounding (5-claim regression): the digits inside "Russell 2000" do not leak into a fabricated 2000',
  )
  eq(
    isGrounded('AAA is down 35% from highs.', fiveClaimsPayload),
    false,
    'grounding (5-claim regression): the digits inside "TA-35" do not leak into a fabricated 35%',
  )
  eq(
    isGrounded('AAA rallied to $317.25 on heavy volume.', fiveClaimsPayload),
    false,
    'grounding (5-claim regression): an invented precise figure is still rejected',
  )
  // The documented tradeoff named above: 150 IS admitted regardless of
  // context, by design, because it's in STRUCTURAL_TOKENS.
  eq(
    isGrounded('AAA has a breakout target near $150.', fiveClaimsPayload),
    true,
    'grounding: 150 is a structural token (the SMA period) — admitted unconditionally, not a leak',
  )

  // ── Derivations: momentum, range, surprise ───────────────────────
  console.log('\nDerivations — momentum and range')
  // closes 100..109 over 10 bars
  const mBars = Array.from({ length: 10 }, (_, i) => ({ t: i, o: 0, h: 0, l: 0, c: 100 + i }))
  approx(priceChangePct(mBars, 1), (109 / 108 - 1) * 100, 0.01, 'priceChangePct(1): 109 vs 108 ≈ +0.93%')
  approx(priceChangePct(mBars, 5), (109 / 104 - 1) * 100, 1e-9, 'priceChangePct(5): 109 vs 104')
  eq(priceChangePct(mBars, 20), null, 'priceChangePct: lookback beyond history returns null')
  eq(priceChangePct([], 1), null, 'priceChangePct: empty series returns null')

  const rBars = [
    { t: 0, o: 0, h: 120, l: 80, c: 100 },
    { t: 1, o: 0, h: 150, l: 95, c: 140 },
    { t: 2, o: 0, h: 130, l: 60, c: 75 },
  ]
  const r52 = fiftyTwoWeekRange(rBars)
  approx(r52?.high ?? null, 150, 1e-9, 'fiftyTwoWeekRange: high is the max of highs')
  approx(r52?.low ?? null, 60, 1e-9, 'fiftyTwoWeekRange: low is the min of lows')
  approx(r52?.pctFromHigh ?? null, (75 / 150 - 1) * 100, 1e-9, 'fiftyTwoWeekRange: last close vs high')
  approx(r52?.pctFromLow ?? null, (75 / 60 - 1) * 100, 1e-9, 'fiftyTwoWeekRange: last close vs low')
  eq(fiftyTwoWeekRange([]), null, 'fiftyTwoWeekRange: empty series returns null')

  approx(epsSurprisePct(1.2, 1.0), 20, 1e-9, 'epsSurprisePct: 1.20 actual vs 1.00 estimate = +20%')
  approx(epsSurprisePct(0.8, 1.0), -20, 1e-9, 'epsSurprisePct: a miss is negative')
  eq(epsSurprisePct(1.2, 0), null, 'epsSurprisePct: zero estimate returns null, not Infinity')
  eq(epsSurprisePct(null, 1.0), null, 'epsSurprisePct: missing actual returns null')
  approx(epsSurprisePct(-0.8, -1.0), 20, 1e-9, 'epsSurprisePct: a loss narrower than consensus is a BEAT (+20%)')
  approx(epsSurprisePct(-1.2, -1.0), -20, 1e-9, 'epsSurprisePct: a loss wider than consensus is a MISS (-20%)')

  // analyze() surfaces the full-series range so nothing re-walks the bars
  const rangeTech = analyze(rBars)
  approx(rangeTech.fullRange?.high ?? null, 150, 1e-9, 'analyze: fullRange.high')
  eq(analyze([]).fullRange, null, 'analyze([]): fullRange is null')

  // ── Result ───────────────────────────────────────────────────────
  console.log('')
  if (failures > 0) {
    console.error(`✗ ${failures} assertion(s) failed`)
    process.exit(1)
  }
  console.log('✓ all screener signal checks passed')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
