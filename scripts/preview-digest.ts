/**
 * scripts/preview-digest.ts
 *
 * Renders the daily email to an HTML file so the design can be reviewed in a
 * browser without sending anything or touching the network.
 *
 * Usage:
 *   pnpm preview:digest            → writes .preview/digest.html
 *
 * Fixtures are built as `ScoreInput` and run through the real `evaluate()` +
 * `toPick()` pipeline (see src/lib/score.ts) rather than hand-assembled as a
 * `ScoredPick` — that's the only way a fixture's shape can't drift from the
 * type the real scorer produces.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { renderDigest } from '../src/lib/email/render'
import { evaluate, toPick, type ScoreInput, type ScoredPick, type Selection } from '../src/lib/score'
import type { Fib, Technicals } from '../src/lib/technicals'

/** A minimal fixture Technicals: one visible bar (only its close matters — it
 *  feeds the golden-zone retracement calc), a channel carrying only the
 *  `positionPct` the scorer reads, and either a Fib swing or `null` to
 *  exercise the "no swing anchored" branch. */
function mkTech(positionPct: number, close: number, fib: Fib | null): Technicals {
  return {
    visible: [{ t: 0, o: close, h: close, l: close, c: close }],
    sma150: [null],
    channel: { upper: [], mid: [], lower: [], slopePerDay: 0, positionPct },
    fib,
    gaps: [],
    verdict: 'opportunity',
    positionPct,
    signals: null,
    windowBars: 126,
    fullRange: null,
  }
}

/** Shared swing (0..200) so each fixture's retracement ratio is just
 *  (200 - close) / 200 — easy to reason about and to pick a target ratio from. */
const FIB: Fib = { high: 200, low: 0, direction: 'rally', anchor: 'swing', levels: [] }

interface Fixture {
  symbol: string
  name: string
  price: number
  marketCap: number
  trailingPe: number
  sma150: number
  allTimeHigh: number
  yoyPct: number
  ntmPct: number
  epsCagr5yr: number
  positionPct: number
  /** Fib swing close, or null to render the "no swing anchored" golden-zone state. */
  fibClose: number | null
}

// Four fixtures, each chosen to exercise a different corner of the mini-charts:
//
//  NVDA — maxed growth (all three legs clear GROWTH_FULL_PCT=30), price
//         basically riding its 150-day average (+2.9%), deep in the lower
//         channel (positionPct 8 → a long green tunnel bar), and a 0.56
//         retracement that lands inside the golden 0.5–0.618 zone (⭐ marker).
//         This is the top-ranked card.
//  MSFT — moderate growth, price a little under its average (-3.8%, a
//         left-of-centre marker), mid-channel (22), and a 0.30 retracement —
//         shallower than the golden zone, so the marker sits left of the
//         highlighted band with no star.
//  AVGO — strong-ish growth, price running hot above its average (+6.1%, a
//         right-of-centre marker), upper-mid channel (35), and a 0.70
//         retracement — past the golden zone toward the deep 0.786 edge.
//  META — weakest growth mix, price below its average (-7.2%), upper channel
//         (47, a short tunnel bar), the deepest drawdown of the four (-30.8%,
//         near the point the model calls the trend broken), and no Fib swing
//         at all — the "no swing anchored" branch of the golden-zone band.
const FIXTURES: Fixture[] = [
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    price: 180,
    marketCap: 3.3e12,
    trailingPe: 45.1,
    sma150: 175,
    allTimeHigh: 210,
    yoyPct: 62,
    ntmPct: 41,
    epsCagr5yr: 35,
    positionPct: 8,
    fibClose: 88, // (200-88)/200 = 0.56 → golden zone
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft Corporation',
    price: 100,
    marketCap: 3.1e12,
    trailingPe: 29.8,
    sma150: 104,
    allTimeHigh: 132,
    yoyPct: 18,
    ntmPct: 14,
    epsCagr5yr: 16,
    positionPct: 22,
    fibClose: 140, // (200-140)/200 = 0.30 → shallow of the golden zone
  },
  {
    symbol: 'AVGO',
    name: 'Broadcom Inc.',
    price: 140,
    marketCap: 900e9,
    trailingPe: 38.6,
    sma150: 132,
    allTimeHigh: 155,
    yoyPct: 44,
    ntmPct: 27,
    epsCagr5yr: 24,
    positionPct: 35,
    fibClose: 60, // (200-60)/200 = 0.70 → deep of the golden zone
  },
  {
    symbol: 'META',
    name: 'Meta Platforms, Inc.',
    price: 90,
    marketCap: 1.5e12,
    trailingPe: 24.3,
    sma150: 97,
    allTimeHigh: 130,
    yoyPct: 31,
    ntmPct: 18,
    epsCagr5yr: 22,
    positionPct: 47,
    fibClose: null, // no swing anchored
  },
]

const picks: ScoredPick[] = FIXTURES.map((f) => {
  const input: ScoreInput = {
    symbol: f.symbol,
    name: f.name,
    price: f.price,
    marketCap: f.marketCap,
    trailingPe: f.trailingPe,
    sma150: f.sma150,
    allTimeHigh: f.allTimeHigh,
    yoyPct: f.yoyPct,
    yoyState: 'pass',
    ntmPct: f.ntmPct,
    ntmState: 'pass',
    epsCagr5yr: f.epsCagr5yr,
    technicals: mkTech(f.positionPct, f.fibClose ?? 0, f.fibClose == null ? null : FIB),
  }
  return toPick(evaluate(input))
}).sort((a, b) => b.score - a.score)

console.log('Fixture scores (rank, symbol, score):')
picks.forEach((p, i) => console.log(`  ${i + 1}. ${p.symbol} — ${p.score.toFixed(1)}/100`))

const selection: Selection = { picks, considered: 61, belowCutoff: 3 }

const { subject, html } = renderDigest({
  recipient: { firstName: 'Asaf', unsubscribeToken: 'preview-token' },
  selection,
  asOfLabel: 'Monday, 14 September 2026',
  siteUrl: 'https://tripleqgroup.vercel.app',
  indices: [],
})

mkdirSync('.preview', { recursive: true })
writeFileSync('.preview/digest.html', html)
console.log(`subject: ${subject}`)
console.log('wrote .preview/digest.html — open it in a browser')

// Also render the empty state, which is the easiest variant to get wrong.
const empty = renderDigest({
  recipient: { firstName: 'Asaf', unsubscribeToken: 'preview-token' },
  selection: { picks: [], considered: 61, belowCutoff: 2 },
  asOfLabel: 'Monday, 14 September 2026',
  siteUrl: 'https://tripleqgroup.vercel.app',
  indices: [],
})
writeFileSync('.preview/digest-empty.html', empty.html)
console.log('wrote .preview/digest-empty.html')
