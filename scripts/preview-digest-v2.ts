/**
 * scripts/preview-digest-v2.ts
 *
 * Renders the v2 daily digest to HTML files so the design can be reviewed in
 * a browser without sending anything or touching the network — the same
 * discipline as scripts/preview-digest.ts, plus one thing that script
 * doesn't need: a REAL chart PNG. Email clients raster the chart (see
 * src/lib/chart/render.ts's file banner: Gmail strips inline SVG), so a
 * preview that skips actually calling `renderChart` would never catch a
 * chart-rendering regression — only whether the <img> tag was written.
 *
 * Fixtures are built the same way scripts/preview-digest.ts's are: as
 * `ScoreInput` run through the real `evaluate()` + `toPick()` pipeline, so a
 * fixture's shape can't drift from what the real scorer produces. The one
 * addition here is that `technicals` itself comes from the real `analyze()`
 * over a synthetic-but-realistic 280-bar price series (deterministic
 * xorshift32 noise, not Math.random — the same PNG bytes every run, which
 * matters for diffing preview output across commits), not the minimal
 * one-bar stub scripts/preview-digest.ts's mkTech() uses — that stub has no
 * channel/Fib/SMA series to actually chart.
 *
 * Usage:
 *   pnpm preview:digest:v2   → writes:
 *     .preview/digest-v2.html            — real charts + fixture commentary
 *     .preview/chart-<SYMBOL>.png        — the charts digest-v2.html embeds,
 *                                          referenced by relative path
 *     .preview/digest-v2-degraded.html   — commentary: null, no chart URLs —
 *                                          proves the degraded path renders
 *                                          cleanly rather than with holes
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { renderDigestV2 } from '../src/lib/email/render-v2'
import { renderChart } from '../src/lib/chart/render'
import { evaluate, toPick, MIN_SCORE, type ScoreInput, type ScoredPick } from '../src/lib/score'
import { analyze } from '../src/lib/technicals'
import { priceChangePct } from '../src/lib/derive'
import type { Bar } from '../src/market-data/provider'
import type { IndexCardData } from '../src/market-data/indices'
import { buildMarketRead } from '../src/lib/market-read'

// ─── Deterministic synthetic price series ───────────────────────────
// xorshift32, not Math.random(): the whole point of a fixture is that it
// produces the same PNG bytes on every run, so a diff between two commits'
// preview output is meaningful.
function makeRng(seed: number): () => number {
  let state = seed
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state |= 0
    return (state >>> 0) / 4294967296
  }
}

/** `n` daily bars starting at `start`, drifting by `drift`/day with a slow
 *  sine wave plus xorshift noise scaled by `amp` — enough shape for a
 *  regression channel, a Fib swing and open gaps to all have something real
 *  to find, not a flat line. `FETCH_BARS` (WARMUP_BARS 150 + VISIBLE_BARS
 *  126 = 276) is the real pipeline's own minimum for a fully-warmed 150-day
 *  SMA across the whole visible window — 280 clears it with a few bars of
 *  slack, same shape queries.ts requests from Yahoo. */
function genBars(n: number, start: number, drift: number, amp: number, seed: number): Bar[] {
  const rand = makeRng(seed)
  const bars: Bar[] = []
  let price = start
  for (let i = 0; i < n; i++) {
    const noise = (rand() - 0.5) * amp
    const wave = Math.sin(i / 11) * amp * 0.5
    price = Math.max(1, price + drift + wave * 0.06 + noise * 0.4)
    const o = Math.max(0.5, price - noise * 0.3)
    const c = price
    const h = Math.max(o, c) + Math.abs(noise) * 0.35
    const l = Math.max(0.25, Math.min(o, c) - Math.abs(noise) * 0.35)
    // Real Unix-second daily timestamps, not the bar index — the date axis
    // (src/lib/chart/render.ts) reads `t` directly, and an index here would
    // collapse every label to the same calendar day near the Unix epoch,
    // making the axis look broken to a reviewer even though it isn't.
    bars.push({ t: Math.floor(Date.now() / 1000) - (n - 1 - i) * 86_400, o, h, l, c })
  }
  return bars
}

interface FixtureSpec {
  symbol: string
  name: string
  start: number
  drift: number
  amp: number
  seed: number
  marketCap: number
  trailingPe: number
  forwardPe: number
  peg5yr: number
  netMarginTtm: number
  grossMarginTtm: number
  operatingMarginTtm: number
  roiTtm: number
  yoyPct: number
  ntmPct: number
  epsCagr5yr: number
  epsSurprisePct: number
}

// Four fixtures with different drift/noise profiles so the four charts
// actually look distinct in the preview, not four copies of the same shape.
const FIXTURES: FixtureSpec[] = [
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    start: 140,
    drift: 0.32,
    amp: 3.2,
    seed: 0x9e3779b1,
    marketCap: 3.3e12,
    trailingPe: 45.1,
    forwardPe: 32.4,
    peg5yr: 1.3,
    netMarginTtm: 0.55,
    grossMarginTtm: 0.75,
    operatingMarginTtm: 0.62,
    roiTtm: 0.48,
    yoyPct: 62,
    ntmPct: 41,
    epsCagr5yr: 35,
    epsSurprisePct: 8.4,
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft Corporation',
    start: 95,
    drift: 0.06,
    amp: 2.1,
    seed: 0x243f6a88,
    marketCap: 3.1e12,
    trailingPe: 29.8,
    forwardPe: 26.1,
    peg5yr: 2.1,
    netMarginTtm: 0.36,
    grossMarginTtm: 0.69,
    operatingMarginTtm: 0.44,
    roiTtm: 0.21,
    yoyPct: 18,
    ntmPct: 14,
    epsCagr5yr: 16,
    epsSurprisePct: 2.1,
  },
  {
    symbol: 'AVGO',
    name: 'Broadcom Inc.',
    start: 120,
    drift: 0.18,
    amp: 3.8,
    seed: 0x85ebca77,
    marketCap: 900e9,
    trailingPe: 38.6,
    forwardPe: 29.9,
    peg5yr: 1.7,
    netMarginTtm: 0.4,
    grossMarginTtm: 0.66,
    operatingMarginTtm: 0.41,
    roiTtm: 0.19,
    yoyPct: 44,
    ntmPct: 27,
    epsCagr5yr: 24,
    epsSurprisePct: 5.6,
  },
  {
    symbol: 'META',
    name: 'Meta Platforms, Inc.',
    start: 130,
    drift: -0.1,
    amp: 4.4,
    seed: 0xc2b2ae35,
    marketCap: 1.5e12,
    trailingPe: 24.3,
    forwardPe: 21.8,
    peg5yr: 1.1,
    netMarginTtm: 0.34,
    grossMarginTtm: 0.81,
    operatingMarginTtm: 0.4,
    roiTtm: 0.24,
    yoyPct: 31,
    ntmPct: 18,
    epsCagr5yr: 22,
    epsSurprisePct: -1.8,
  },
]

const BAR_COUNT = 280 // WARMUP_BARS(150) + VISIBLE_BARS(126) + slack

/** Builds one ScoredPick from a fixture spec, wiring `technicals` up to a
 *  real `analyze()` result so channel rails, the Fib ladder, gaps and the
 *  SMA series are all genuine — not just present-but-empty. */
function buildPick(spec: FixtureSpec): ScoredPick {
  const bars = genBars(BAR_COUNT, spec.start, spec.drift, spec.amp, spec.seed)
  const technicals = analyze(bars)
  const lastClose = bars[bars.length - 1].c
  const smaLast = [...technicals.sma150].reverse().find((v): v is number => v != null) ?? lastClose
  // All-time high a bit above the series' own high, so pctFromAth has a real
  // (non-zero) drawdown to render rather than always landing on 0%.
  const allTimeHigh = Math.max(...bars.map((b) => b.h)) * 1.08

  const input: ScoreInput = {
    symbol: spec.symbol,
    name: spec.name,
    price: lastClose,
    marketCap: spec.marketCap,
    trailingPe: spec.trailingPe,
    sma150: smaLast,
    allTimeHigh,
    yoyPct: spec.yoyPct,
    yoyState: 'pass',
    ntmPct: spec.ntmPct,
    ntmState: 'pass',
    epsCagr5yr: spec.epsCagr5yr,
    technicals,
    forwardPe: spec.forwardPe,
    peg5yr: spec.peg5yr,
    netMarginTtm: spec.netMarginTtm,
    grossMarginTtm: spec.grossMarginTtm,
    operatingMarginTtm: spec.operatingMarginTtm,
    roiTtm: spec.roiTtm,
    epsSurprisePct: spec.epsSurprisePct,
    change1dPct: priceChangePct(technicals.visible, 1),
    change1wPct: priceChangePct(technicals.visible, 5),
    change1mPct: priceChangePct(technicals.visible, 21),
    fullRange: technicals.fullRange,
  }
  return toPick(evaluate(input))
}

// Fixture header index-strip data. Static, not fetched — this script makes
// no network calls (see the file banner) — mirroring the four real cards in
// src/market-data/indices.ts (rut/ndx/spx/ta35) so the preview's index strip
// looks like the real thing. `live: false` on all four is honest: none of
// this actually came from Yahoo this run.
const FIXTURE_INDICES: IndexCardData[] = [
  {
    key: 'rut',
    name: 'Russell 2000',
    region: 'US · Small Cap',
    accent: 'amber',
    ytdPct: 17.6,
    trailingPe: 35,
    forwardPe: 25,
    eps2026: '+25–30%',
    eps2027: '+15–20%',
    live: false,
  },
  {
    key: 'ndx',
    name: 'Nasdaq-100',
    region: 'US · Tech',
    accent: 'violet',
    ytdPct: 17.5,
    trailingPe: 32,
    forwardPe: 24.5,
    eps2026: '+25–30%',
    eps2027: '+15–18%',
    live: false,
  },
  {
    key: 'spx',
    name: 'S&P 500',
    region: 'US · Large Cap',
    accent: 'emerald',
    ytdPct: 14.2,
    trailingPe: 24,
    forwardPe: 21,
    eps2026: '+12–15%',
    eps2027: '+10–12%',
    live: false,
  },
  {
    key: 'ta35',
    name: 'TA-35',
    region: 'Israel · Large Cap',
    accent: 'sky',
    ytdPct: 21.3,
    trailingPe: 14.5,
    forwardPe: 12.8,
    eps2026: '+10–14%',
    eps2027: '+8–10%',
    live: false,
  },
]

async function main() {
  mkdirSync('.preview', { recursive: true })

  // MIN_SCORE is applied here for the same reason selectPicks applies it in
  // production: a preview that displays a sub-cutoff name is showing a state
  // subscribers can never receive, and the email's own header ("scored 50 or
  // better") then contradicts the rows beneath it. Fixtures below the cutoff
  // are kept in FIXTURES deliberately — they feed belowCutoff, which is what
  // the header's "N more passed the gate but fell short on score" reports.
  const scored = FIXTURES.map(buildPick).sort((a, b) => b.score - a.score)
  const picks = scored.filter((p) => p.score >= MIN_SCORE)
  const belowCutoff = scored.length - picks.length

  console.log('Fixture scores (rank, symbol, score):')
  scored.forEach((p, i) =>
    console.log(
      `  ${i + 1}. ${p.symbol} — ${p.score.toFixed(1)}/100${p.score < MIN_SCORE ? '  (below cutoff — not shown)' : ''}`,
    ),
  )

  // ── File 1: real charts + fixture commentary ──────────────────────
  // Render and write a real chart PNG per pick, wiring chartUrl to a plain
  // relative filename — both files land in .preview/, so the browser
  // resolves it against digest-v2.html's own location with no server needed.
  for (const p of picks) {
    const png = await renderChart({ symbol: p.symbol, technicals: p.input.technicals! })
    if (!png) {
      console.warn(`  ! ${p.symbol}: renderChart returned null — chart omitted, not a broken <img>`)
      continue
    }
    const fileName = `chart-${p.symbol}.png`
    writeFileSync(`.preview/${fileName}`, png)
    p.chartUrl = fileName
  }

  // Composed from the fixture picks themselves, not hand-written prose: the
  // preview's whole job is to show what subscribers will actually receive,
  // and buildMarketRead is deterministic, so a hand-written fixture here
  // would be the one part of the page that is not the real output.
  const commentary = buildMarketRead(picks, FIXTURE_INDICES)

  const full = renderDigestV2({
    recipient: { firstName: 'Asaf', unsubscribeToken: 'preview-token' },
    selection: { picks, considered: 61, belowCutoff },
    asOfLabel: 'Monday, 14 September 2026',
    siteUrl: 'https://tripleqgroup.vercel.app',
    indices: FIXTURE_INDICES,
    commentary,
  })
  writeFileSync('.preview/digest-v2.html', full.html)
  console.log(`subject: ${full.subject}`)
  console.log('wrote .preview/digest-v2.html + .preview/chart-*.png — open the html in a browser')

  // ── File 2: the degraded path — no commentary, no chart URLs ──────
  // Same scored picks (so the technical-levels panel, metrics grid etc. are
  // still full and real), but chartUrl cleared and commentary null — proving
  // the "Market read" panel, the per-stock "Read" panels and every
  // chart <img> all disappear cleanly rather than rendering broken or empty.
  const degradedPicks: ScoredPick[] = picks.map((p) => ({ ...p, chartUrl: null }))
  const degraded = renderDigestV2({
    recipient: { firstName: 'Asaf', unsubscribeToken: 'preview-token' },
    selection: { picks: degradedPicks, considered: 61, belowCutoff },
    asOfLabel: 'Monday, 14 September 2026',
    siteUrl: 'https://tripleqgroup.vercel.app',
    indices: FIXTURE_INDICES,
    commentary: null,
  })
  writeFileSync('.preview/digest-v2-degraded.html', degraded.html)
  console.log('wrote .preview/digest-v2-degraded.html — no charts, no market read')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
