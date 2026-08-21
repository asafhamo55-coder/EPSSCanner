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

  // ── Technicals: channel positionPct ─────────────────────────────
  console.log('\nTechnicals — channel positionPct')
  const barsFromCloses = (closes: number[]): Bar[] =>
    closes.map((c, i) => ({ t: i, o: c, h: c, l: c, c }))

  // Shared 29-bar base (deterministic sinusoidal noise so sigma > 0), plus one
  // free last close solved by bisection — against this module's own linreg —
  // so it lands exactly on the upper rail, lower rail, or dead-center. The
  // regression couples every point together, so the target close can't be
  // derived by hand; it's the root of positionPct(x) = target for this base.
  const channelBase = [
    100, 102.43265306171307, 103.95634918996538, 102.58962809994662, 101.50496445046771,
    99.94765031693115, 97.38527268275924, 97.552642162127, 99.10620008638304, 100.05044170145305,
    102.47095979615636, 103.964504701631, 102.56379672426485, 101.45729508704805, 99.90056261224422,
    97.360912720085, 97.56246681254605, 99.14558866328889, 100.10086914166341, 102.5087092865898,
    103.97182206708462, 102.5372404934288, 101.40935507023711, 99.85378574844798, 97.33729889925549,
    97.57312198359553, 99.18550153278115, 100.15126806342043, 102.5458908602044,
  ]

  const upperRailTech = analyze(barsFromCloses([...channelBase, 105.09689917066314]))
  approx(upperRailTech.positionPct, 100, 1e-4, 'positionPct at upper rail → 100')

  const lowerRailTech = analyze(barsFromCloses([...channelBase, 94.85615351380913]))
  approx(lowerRailTech.positionPct, 0, 1e-4, 'positionPct at lower rail → 0')

  const midRailTech = analyze(barsFromCloses([...channelBase, 99.97652634223617]))
  approx(midRailTech.positionPct, 50, 1e-4, 'positionPct at channel mid → 50')

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
