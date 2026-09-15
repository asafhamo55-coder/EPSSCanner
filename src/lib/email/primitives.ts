// Inline-CSS building blocks for every email this app sends.
//
// Email clients are not browsers: Gmail strips <style> blocks in some contexts,
// Outlook renders through Word, none of them run JavaScript, and Gmail drops
// inline SVG entirely. So every "chart" here is a nested table whose cells have
// background colours and percentage widths — the only charting primitive that
// renders the same everywhere.
//
// Stays pure (no I/O, no React, no Date) per the model constant it imports
// below — score.ts is pure too, so importing its tuning constants here does
// not compromise that.

import { GOLDEN_KNOTS } from '@/lib/score'

/** The golden-zone curve's domain (shallow/deep taper-to-zero knots) and its
 *  full-credit band (the two knots scoring 1), both read off GOLDEN_KNOTS
 *  rather than restated as literals. */
const GOLDEN_DOMAIN_LOW = GOLDEN_KNOTS[0][0]
const GOLDEN_DOMAIN_HIGH = GOLDEN_KNOTS[GOLDEN_KNOTS.length - 1][0]
const GOLDEN_FULL_CREDIT = GOLDEN_KNOTS.filter(([, y]) => y === 1).map(([x]) => x)
const GOLDEN_ZONE_LOW = GOLDEN_FULL_CREDIT[0]
const GOLDEN_ZONE_HIGH = GOLDEN_FULL_CREDIT[GOLDEN_FULL_CREDIT.length - 1]

/** Light-only palette. Email has no reliable dark-mode signal, so the design
 *  commits to light and sets every background explicitly rather than inheriting
 *  a client's default.
 *
 *  `positive` / `negative` / `gold` are FILL colours — tuned for bars and
 *  soft-background chips, not for text. None of the three clears WCAG AA as
 *  small text on its matching soft background (or, for gold, on the white
 *  card surface). `positiveInk` / `negativeInk` / `goldInk` are the dedicated
 *  TEXT tokens for exactly those spots — do not "simplify" them back onto the
 *  fill tokens, that regresses the contrast fix.
 *
 *  `warningSoft` / `warningInk` are a separate amber pair for signal-state
 *  chips (see render.ts's chipTone) — deliberately distinct from `gold` /
 *  `goldSoft` / `goldInk`, which are the golden-zone RETRACEMENT chart's
 *  colours and carry no relation to a signal's pass/flag/fail state.
 *  warningInk on warningSoft measures 6.37:1, comfortably clearing WCAG AA's
 *  4.5:1 for small text (computed via the standard relative-luminance
 *  formula: amber-800 #92400e on amber-100 #fef3c7). */
export const PALETTE = {
  ink: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  line: '#e2e8f0',
  surface: '#ffffff',
  canvas: '#f1f5f9',
  brand: '#4f46e5',
  brandDeep: '#3730a3',
  positive: '#059669',
  positiveSoft: '#d1fae5',
  positiveInk: '#065f46',   // emerald-800 — 6.8:1 on positiveSoft
  negative: '#dc2626',
  negativeSoft: '#fee2e2',
  negativeInk: '#991b1b',   // red-800 — 6.8:1 on negativeSoft
  gold: '#d97706',
  goldSoft: '#fef3c7',
  goldInk: '#b45309',       // amber-700 — 5.0:1 on white
  warningSoft: '#fef3c7',   // amber-100
  warningInk: '#92400e',    // amber-800 — 6.37:1 on warningSoft
  track: '#e2e8f0',
} as const

/** Presentation-only score bands for the meter's fill/text colour — where a
 *  score is painted, not what qualifies it for the email. Deliberately not
 *  model thresholds: MIN_SCORE (score.ts) is the only number that decides
 *  whether a pick is emailed at all; these two just pick a colour for
 *  whatever score already cleared that bar. */
export const METER_STRONG_AT = 80
export const METER_GOOD_AT = 65

export const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

/** Every interpolated string passes through here. Company names come from a
 *  third-party API and land inside HTML attributes and text nodes. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(100, v))
}

/** A labelled horizontal bar: label on the left, value on the right, a filled
 *  track below. `fillPct` is where the fill ends (0–100). */
export function bar(opts: {
  label: string
  value: string
  fillPct: number
  color: string
}): string {
  const w = clampPct(opts.fillPct)
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px 0;">
  <tr>
    <td style="font:400 11px ${FONT};color:${PALETTE.muted};padding:0 0 3px 0;">${escapeHtml(opts.label)}</td>
    <td align="right" style="font:700 11px ${FONT};color:${PALETTE.ink};padding:0 0 3px 0;">${escapeHtml(opts.value)}</td>
  </tr>
  <tr>
    <td colspan="2" style="padding:0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.track};border-radius:4px;">
        <tr>
          <td width="${w}%" style="background:${opts.color};height:8px;line-height:8px;font-size:0;border-radius:4px;">&nbsp;</td>
          <td width="${100 - w}%" style="height:8px;line-height:8px;font-size:0;">&nbsp;</td>
        </tr>
      </table>
    </td>
  </tr>
</table>`
}

/** A bar with a marker at a fixed point on the track — used for "% vs SMA",
 *  where the meaningful reference is the zero line at the centre, not the left
 *  edge. `markerPct` is where the position sits, 0–100. */
export function markerBar(opts: {
  label: string
  value: string
  markerPct: number
  color: string
  leftCap: string
  rightCap: string
}): string {
  const m = clampPct(opts.markerPct)
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px 0;">
  <tr>
    <td style="font:400 11px ${FONT};color:${PALETTE.muted};padding:0 0 3px 0;">${escapeHtml(opts.label)}</td>
    <td align="right" style="font:700 11px ${FONT};color:${opts.color};padding:0 0 3px 0;">${escapeHtml(opts.value)}</td>
  </tr>
  <tr>
    <td colspan="2" style="padding:0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.track};border-radius:4px;">
        <tr>
          <td width="${m}%" style="height:8px;line-height:8px;font-size:0;">&nbsp;</td>
          <td width="1" style="background:${opts.color};height:14px;line-height:14px;font-size:0;">&nbsp;</td>
          <td width="${100 - m}%" style="height:8px;line-height:8px;font-size:0;">&nbsp;</td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="font:400 10px ${FONT};color:${PALETTE.muted};padding:2px 0 0 0;">${escapeHtml(opts.leftCap)}</td>
    <td align="right" style="font:400 10px ${FONT};color:${PALETTE.muted};padding:2px 0 0 0;">${escapeHtml(opts.rightCap)}</td>
  </tr>
</table>`
}

/** The 0.236 → 0.786 retracement track with the golden 0.5–0.618 segment
 *  highlighted and the close marked. Widths are the real proportions of the
 *  band, so the picture is to scale. */
export function goldenBand(opts: { ratio: number | null }): string {
  const LOW = GOLDEN_DOMAIN_LOW
  const HIGH = GOLDEN_DOMAIN_HIGH
  const span = HIGH - LOW
  const goldStart = ((GOLDEN_ZONE_LOW - LOW) / span) * 100
  const goldEnd = ((GOLDEN_ZONE_HIGH - LOW) / span) * 100
  const label =
    opts.ratio == null ? 'no swing anchored' : `${(opts.ratio * 100).toFixed(1)}% retracement`
  const marker =
    opts.ratio == null ? null : clampPct(((opts.ratio - LOW) / span) * 100)
  const inZone = opts.ratio != null && opts.ratio >= GOLDEN_ZONE_LOW && opts.ratio <= GOLDEN_ZONE_HIGH
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px 0;">
  <tr>
    <td style="font:400 11px ${FONT};color:${PALETTE.muted};padding:0 0 3px 0;">Golden zone</td>
    <td align="right" style="font:700 11px ${FONT};color:${inZone ? PALETTE.goldInk : PALETTE.muted};padding:0 0 3px 0;">${inZone ? '⭐ ' : ''}${escapeHtml(label)}</td>
  </tr>
  <tr>
    <td colspan="2" style="padding:0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.track};border-radius:4px;">
        <tr>
          <td width="${goldStart.toFixed(1)}%" style="height:8px;line-height:8px;font-size:0;">&nbsp;</td>
          <td width="${(goldEnd - goldStart).toFixed(1)}%" style="background:${PALETTE.goldSoft};height:8px;line-height:8px;font-size:0;">&nbsp;</td>
          <td width="${(100 - goldEnd).toFixed(1)}%" style="height:8px;line-height:8px;font-size:0;">&nbsp;</td>
        </tr>
      </table>
    </td>
  </tr>
  ${
    marker == null
      ? ''
      : `<tr><td colspan="2" style="padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td width="${marker.toFixed(1)}%" style="height:6px;line-height:6px;font-size:0;">&nbsp;</td>
    <td width="1" style="background:${PALETTE.ink};height:6px;line-height:6px;font-size:0;">&nbsp;</td>
    <td width="${(100 - marker).toFixed(1)}%" style="height:6px;line-height:6px;font-size:0;">&nbsp;</td>
  </tr></table></td></tr>`
  }
  <tr>
    <td style="font:400 10px ${FONT};color:${PALETTE.muted};padding:2px 0 0 0;">${GOLDEN_DOMAIN_LOW}</td>
    <td align="right" style="font:400 10px ${FONT};color:${PALETTE.muted};padding:2px 0 0 0;">${GOLDEN_DOMAIN_HIGH}</td>
  </tr>
</table>`
}

/** A small pill for a green/amber/red reading. `tone` should track the
 *  underlying SignalState where one exists (see render.ts's chipTone) —
 *  callers with no signal state of their own (e.g. the CAGR chip) fall back
 *  to the sign of the value. */
export type ChipTone = 'positive' | 'warning' | 'negative'

const CHIP_COLORS: Record<ChipTone, { bg: string; fg: string }> = {
  positive: { bg: PALETTE.positiveSoft, fg: PALETTE.positiveInk },
  warning: { bg: PALETTE.warningSoft, fg: PALETTE.warningInk },
  negative: { bg: PALETTE.negativeSoft, fg: PALETTE.negativeInk },
}

export function chip(opts: { label: string; value: string; tone: ChipTone }): string {
  const { bg, fg } = CHIP_COLORS[opts.tone]
  return `<td align="center" style="padding:0 4px 0 0;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${bg};border-radius:6px;">
    <tr><td align="center" style="padding:6px 4px;font:400 10px ${FONT};color:${fg};">${escapeHtml(opts.label)}<br><span style="font:700 13px ${FONT};color:${fg};">${escapeHtml(opts.value)}</span></td></tr>
  </table>
</td>`
}

/** The score meter: a number and a proportional fill, coloured by band. */
export function meter(opts: { score: number }): string {
  const w = clampPct(opts.score)
  const color =
    opts.score >= METER_STRONG_AT ? PALETTE.positive : opts.score >= METER_GOOD_AT ? PALETTE.brand : PALETTE.gold
  const textColor =
    opts.score >= METER_STRONG_AT
      ? PALETTE.positiveInk
      : opts.score >= METER_GOOD_AT
        ? PALETTE.brand
        : PALETTE.goldInk
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td style="font:400 11px ${FONT};color:${PALETTE.muted};padding:0 0 3px 0;">TripleQ Score</td>
    <td align="right" style="font:700 18px ${FONT};color:${textColor};padding:0 0 3px 0;">${opts.score.toFixed(1)}<span style="font:400 11px ${FONT};color:${PALETTE.muted};">/100</span></td>
  </tr>
  <tr>
    <td colspan="2" style="padding:0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.track};border-radius:5px;">
        <tr>
          <td width="${w}%" style="background:${color};height:10px;line-height:10px;font-size:0;border-radius:5px;">&nbsp;</td>
          <td width="${100 - w}%" style="height:10px;line-height:10px;font-size:0;">&nbsp;</td>
        </tr>
      </table>
    </td>
  </tr>
</table>`
}

/** The document shell: doctype, 600px centred content, footer with the
 *  disclaimer, the unsubscribe link and the TripleQ Group signature. */
export function shell(opts: {
  title: string
  preheader: string
  bodyHtml: string
  footerLinksHtml: string
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:${PALETTE.canvas};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.canvas};">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
        ${opts.bodyHtml}
        <tr>
          <td style="background:${PALETTE.surface};padding:20px 24px 8px 24px;font:400 11px ${FONT};color:${PALETTE.muted};line-height:1.6;">
            Fundamental signals only — not investment advice.<br>
            ${opts.footerLinksHtml}
          </td>
        </tr>
        <tr>
          <td style="background:${PALETTE.surface};padding:0 24px 28px 24px;font:700 13px ${FONT};color:${PALETTE.ink};">
            TripleQ Group
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}
