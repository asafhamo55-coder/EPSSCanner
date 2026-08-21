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
  smaSeries,
  verdictFor,
} from '../src/lib/technicals'
import type { Bar } from '../src/market-data/provider'

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

  // ── Technicals: verdictFor boundaries ───────────────────────────
  console.log('\nTechnicals — verdictFor boundaries')
  eq(verdictFor(70), 'dont-buy', 'positionPct 70 → dont-buy (boundary, inclusive)')
  eq(verdictFor(69.99), 'fair', 'positionPct 69.99 → fair (just under boundary)')
  eq(verdictFor(30), 'opportunity', 'positionPct 30 → opportunity (boundary, inclusive)')
  eq(verdictFor(30.01), 'fair', 'positionPct 30.01 → fair (just over boundary)')

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
