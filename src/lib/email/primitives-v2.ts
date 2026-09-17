// v2-only inline-CSS building blocks: the index strip, the four-block metrics
// grid, the technical-levels panel, and the AI-commentary panel. Every v1
// markup rule still applies (nested tables only, all CSS inline, light
// palette, no SVG/script/flex/grid) — see primitives.ts's file banner for the
// full rationale. This file adds only what v1 didn't need; escapeHtml,
// PALETTE, FONT, shell, bar, markerBar, goldenBand, chip and meter are
// imported from there rather than duplicated.
//
// Colour pairs introduced here (WCAG AA 4.5:1 target for normal text),
// computed with the standard relative-luminance formula:
//   muted #64748b on surface #ffffff   → 4.76:1  (reused from primitives.ts,
//     unchanged — but NOT reused on any tinted background below: muted on
//     canvas #f1f5f9 measures 4.34:1 and muted on infoSoft #e0f2fe measures
//     4.15:1, both sub-4.5, which is why every block/card/panel below keeps
//     its label text on plain white `surface`, never on `canvas` or a soft
//     tint — that decision is a computed necessity, not a style preference.
//   ink #0f172a on surface #ffffff     → 17.85:1
//   ink #0f172a on infoSoft #e0f2fe    → 15.56:1
//   body #334155 on surface #ffffff    → 10.35:1
//   body #334155 on infoSoft #e0f2fe   → 9.02:1
//   positiveInk #065f46 on surface     → 7.68:1
//   negativeInk #991b1b on surface     → 8.31:1
//   infoInk #075985 on infoSoft        → 6.59:1  (same pair primitives.ts
//     already documents for the 'turnaround' chip — reused unchanged)
// The lowest ratio actually shipped by this file is muted-on-surface at
// 4.76:1, and every text colour below sits on `surface` or `infoSoft` only —
// never `canvas` — for exactly the reason in the first bullet.

import type { PriceRange } from '@/lib/derive'
import type { IndexCardData } from '@/market-data/indices'
import { num, pct, usd } from '@/lib/format'
import { SMA_ZERO_AT_PCT } from '@/lib/score'
import { bar, escapeHtml, FONT, goldenBand, markerBar, PALETTE } from './primitives'

/** Where the "vs 150-day SMA" marker sits on its track — the same domain
 *  render.ts's v1 card uses (±SMA_ZERO_AT_PCT maps to the full track width,
 *  centred on the SMA itself), duplicated here rather than imported because
 *  render.ts doesn't export it (see render-v2.ts's file banner for why this
 *  file can't import from render.ts at all: the dependency would run the
 *  wrong direction — render.ts is the one that imports the renderer this
 *  file supports). */
function smaMarkerPct(v: number | null): number {
  if (v == null) return 50
  return 50 + (Math.max(-SMA_ZERO_AT_PCT, Math.min(SMA_ZERO_AT_PCT, v)) / SMA_ZERO_AT_PCT) * 50
}

// ─── Index strip ────────────────────────────────────────────────────
// DigestData (render.ts) carries no indices field today — the digest route
// never fetches IndexCardData at send time (getIndices() is only called
// during the morning prep phase, to build the AI commentary payload, and the
// result isn't persisted). So `indices` on the v2 data shape is optional,
// and an absent/empty array means this whole strip renders as '' — the same
// "never fabricate, degrade in richness" rule chartUrl and commentary follow
// elsewhere in this pipeline, not a new one invented for this file.
export function indexStrip(indices: IndexCardData[]): string {
  if (indices.length === 0) return ''
  const n = indices.length
  const w = Math.floor(100 / n)
  const cells = indices
    .map((idx, i) => {
      const ytdColor =
        idx.ytdPct == null ? PALETTE.muted : idx.ytdPct >= 0 ? PALETTE.positiveInk : PALETTE.negativeInk
      const padRight = i === n - 1 ? '0' : '8px'
      return `
    <td width="${w}%" valign="top" style="padding:0 ${padRight} 0 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.surface};border:1px solid ${PALETTE.line};border-radius:8px;">
        <tr><td style="padding:8px 10px 0 10px;font:700 11px ${FONT};color:${PALETTE.ink};">${escapeHtml(idx.name)}</td></tr>
        <tr><td style="padding:0 10px 4px 10px;font:400 9px ${FONT};color:${PALETTE.muted};">${escapeHtml(idx.region)}</td></tr>
        <tr><td style="padding:0 10px 2px 10px;font:700 14px ${FONT};color:${ytdColor};font-variant-numeric:tabular-nums;">${escapeHtml(pct(idx.ytdPct))}</td></tr>
        <tr><td style="padding:0 10px 8px 10px;font:400 9px ${FONT};color:${PALETTE.muted};">P/E ${escapeHtml(num(idx.trailingPe, 1))} · Fwd ${escapeHtml(num(idx.forwardPe, 1))}${idx.live ? '' : ' · est.'}</td></tr>
      </table>
    </td>`
    })
    .join('')
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`
}

// ─── Four-block metrics grid ───────────────────────────────────────
// Stat-tile contract per the dataviz skill: label in sentence case with no
// trailing colon, value in a semibold weight. Values are a COLUMN of numbers
// that must align — `font-variant-numeric:tabular-nums` is applied there
// (never on the score meter's big standalone number in primitives.ts, which
// stays proportional per the same guidance).
export interface MetricRow {
  label: string
  value: string
  /** 'neutral' (ink) unless the row IS a signed delta a trader reads
   *  directionally — momentum changes and the EPS surprise. Never used to
   *  re-encode magnitude that a chip elsewhere already colours by
   *  SignalState (see render-v2.ts's earnings block, which stays neutral so
   *  it doesn't compete with the YoY/NTM chip's SignalState colour). */
  tone?: 'positive' | 'negative' | 'neutral'
}

export interface MetricBlock {
  title: string
  rows: MetricRow[]
}

const TONE_COLOR: Record<NonNullable<MetricRow['tone']>, string> = {
  positive: PALETTE.positiveInk,
  negative: PALETTE.negativeInk,
  neutral: PALETTE.ink,
}

function metricBlock(b: MetricBlock): string {
  const rows = b.rows
    .map(
      (r) => `
        <tr>
          <td style="padding:3px 0;font:400 11px ${FONT};color:${PALETTE.muted};">${escapeHtml(r.label)}</td>
          <td align="right" style="padding:3px 0;font:700 12px ${FONT};color:${TONE_COLOR[r.tone ?? 'neutral']};font-variant-numeric:tabular-nums;">${escapeHtml(r.value)}</td>
        </tr>`,
    )
    .join('')
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.surface};border:1px solid ${PALETTE.line};border-radius:8px;">
  <tr><td style="padding:10px 12px 2px 12px;font:700 11px ${FONT};color:${PALETTE.ink};">${escapeHtml(b.title)}</td></tr>
  <tr><td style="padding:0 12px 8px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
  </td></tr>
</table>`
}

/** Exactly four blocks, arranged 2×2 in a plain nested table (no CSS grid —
 *  Gmail strips the properties, not just the tag). Order is the caller's
 *  choice; spec §7 names valuation, margins, momentum, earnings. */
export function metricsGrid(blocks: readonly [MetricBlock, MetricBlock, MetricBlock, MetricBlock]): string {
  const [a, b, c, d] = blocks
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td width="50%" valign="top" style="padding:0 4px 8px 0;">${metricBlock(a)}</td>
    <td width="50%" valign="top" style="padding:0 0 8px 4px;">${metricBlock(b)}</td>
  </tr>
  <tr>
    <td width="50%" valign="top" style="padding:0 4px 0 0;">${metricBlock(c)}</td>
    <td width="50%" valign="top" style="padding:0 0 0 4px;">${metricBlock(d)}</td>
  </tr>
</table>`
}

// ─── Technical levels ──────────────────────────────────────────────
// Spec §7 asks for "channel rails as prices, the Fib ladder with prices,
// unfilled gaps, SMA-150 distance in both percent and dollars". Only the
// last of those four is achievable from a `PrepPickRecord`: the raw channel
// rail prices, the Fib ladder's price levels and the open-gap list live only
// on `Technicals` (input.technicals), which `toDigestPickRecord` deliberately
// excludes from persistence (the ~27KB-per-pick payload score.ts's own
// comment calls out) — so a pick reaching this renderer never carries them.
// What IS on the record: `vsSma150Pct` (percent only — no raw sma150 price),
// `positionPct` (percent up the regression channel, no rail prices),
// `retracement` (the Fib ratio, no swing-price levels) and `fullRange`
// (actual 52-week high/low prices, since Task 1 added it as its own field).
// This panel renders exactly that: a real 52-week price range from
// `fullRange`, and a percent-AND-dollar SMA-150 reading — the dollar figure
// isn't persisted either, but it's recoverable without a new field, by
// inverting vsSma150Pct's own formula (see derive.ts): if
// vsSma150Pct = (price − sma150) / sma150 × 100, then
// sma150 = price / (1 + vsSma150Pct/100), and the dollar gap follows. Tunnel
// position and the golden-zone band reuse v1's own `bar`/`goldenBand`
// primitives unchanged — the "deterministic factor breakdown, retained from
// v1" spec §7 asks for, not a redraw.
export function technicalLevels(opts: {
  price: number | null
  vsSma150Pct: number | null
  positionPct: number | null
  retracement: number | null
  fullRange: PriceRange | null
}): string {
  const smaDollar =
    opts.price != null && opts.vsSma150Pct != null && Number.isFinite(opts.vsSma150Pct)
      ? (opts.price * (opts.vsSma150Pct / 100)) / (1 + opts.vsSma150Pct / 100)
      : null
  const rangeValue = opts.fullRange
    ? `${escapeHtml(usd(opts.fullRange.low))} – ${escapeHtml(usd(opts.fullRange.high))}`
    : '—'
  const rangeSub = opts.fullRange
    ? `${escapeHtml(pct(opts.fullRange.pctFromLow, 1))} from low · ${escapeHtml(pct(opts.fullRange.pctFromHigh, 1))} from high`
    : ''
  // The dollar delta has nowhere to sit inside markerBar's fixed slots
  // (label / value / two axis caps), so it rides as a small caption under the
  // gauge instead of replacing the percent value markerBar already shows.
  const smaCaption =
    smaDollar != null
      ? `${smaDollar >= 0 ? '+' : '−'}${escapeHtml(usd(Math.abs(smaDollar)))} vs the 150-day average`
      : ''
  const positionPct = opts.positionPct
  const clamped = positionPct == null ? null : Math.max(0, Math.min(100, positionPct))

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.surface};border:1px solid ${PALETTE.line};border-radius:8px;">
  <tr><td style="padding:10px 12px 6px 12px;font:700 11px ${FONT};color:${PALETTE.ink};">📐 Technical levels</td></tr>
  <tr>
    <td style="padding:0 12px 8px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="font:400 11px ${FONT};color:${PALETTE.muted};padding:2px 0;">52-week range</td>
          <td align="right" style="font:700 12px ${FONT};color:${PALETTE.ink};padding:2px 0;font-variant-numeric:tabular-nums;">${rangeValue}</td>
        </tr>
        ${rangeSub ? `<tr><td colspan="2" align="right" style="font:400 10px ${FONT};color:${PALETTE.muted};padding:0 0 4px 0;">${rangeSub}</td></tr>` : ''}
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding:0 12px 10px 12px;">
      ${markerBar({
        label: '📏 vs 150-day SMA',
        value: pct(opts.vsSma150Pct),
        markerPct: smaMarkerPct(opts.vsSma150Pct),
        color: PALETTE.brand,
        leftCap: `−${SMA_ZERO_AT_PCT}%`,
        rightCap: `+${SMA_ZERO_AT_PCT}%`,
      })}
      ${
        smaCaption
          ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font:400 10px ${FONT};color:${PALETTE.muted};padding:2px 0 8px 0;">${smaCaption}</td></tr></table>`
          : ''
      }
      ${bar({
        label: '🎯 Tunnel position (lower is better)',
        value: clamped == null ? 'n/a' : `${clamped.toFixed(0)}% up the channel`,
        fillPct: clamped == null ? 0 : 100 - clamped,
        color: PALETTE.positive,
      })}
      ${goldenBand({ ratio: opts.retracement })}
    </td>
  </tr>
</table>`
}

// ─── AI-commentary panel ───────────────────────────────────────────
// infoSoft/infoInk — the same pair primitives.ts already reserves for the
// 'turnaround' signal state — reused here as the "this is generated, not
// editorial" tint, per spec §7's requirement that AI copy be visibly
// labelled rather than presented as house commentary. Body copy sits in
// `body` (9.02:1 on infoSoft), never `muted` (4.15:1 — fails).
export function commentaryPanel(opts: { heading: string; text: string; compact?: boolean }): string {
  const pad = opts.compact ? '10px 12px' : '16px 18px'
  const headingSize = opts.compact ? '10px' : '11px'
  const textSize = opts.compact ? '12px' : '13px'
  const radius = opts.compact ? '8px' : '12px'
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.infoSoft};border-radius:${radius};">
  <tr>
    <td style="padding:${pad};">
      <span style="font:700 ${headingSize} ${FONT};color:${PALETTE.infoInk};text-transform:uppercase;letter-spacing:0.04em;">🤖 ${escapeHtml(opts.heading)}</span><br>
      <span style="font:400 ${textSize} ${FONT};color:${PALETTE.body};line-height:1.6;">${escapeHtml(opts.text)}</span>
    </td>
  </tr>
</table>`
}
