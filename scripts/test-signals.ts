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
