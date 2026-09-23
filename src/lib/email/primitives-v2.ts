// v2-only inline-CSS building blocks: the index strip, the four-block metrics
// grid, the technical-levels panel, and the commentary panel. Every v1
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
import type { DigestPickLevels } from '@/lib/score'
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
// `indices` is a REQUIRED field on `DigestData` (Task 9 hoisted it there —
// see render.ts's DigestData doc comment — away from a v2-local optional
// type), and the digest route DOES fetch it at send time: `getIndices()` is
// called directly in src/app/api/digest/route.ts, immediately before
// building each recipient's DigestData, raced against a 5s timeout (the
// prep-phase cache it reads is 15-minute TTL and this route runs 90+
// minutes later, so every read there is a cold, live Yahoo fan-out, not a
// cache hit — see that route's own comment). An empty array is still a
// fully legitimate value on either path — a timed-out or failed fetch
// degrades to `[]` — and this whole strip still renders as '' for it, the
// same "never fabricate, degrade in richness" rule chartUrl and commentary
// follow elsewhere in this pipeline, not a new one invented for this file.
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
// unfilled gaps, SMA-150 distance in both percent and dollars". As of the v2
// template's fix round 1, `DigestPickRecord.levels` (score.ts's
// `deriveLevels`) persists exactly that — channel rail prices, the Fib
// ladder's price levels, the nearest open gaps and the SMA-150's own price —
// so all four are reachable here now, not just the percent-only readings
// (`vsSma150Pct`, `positionPct`, `retracement`) and `fullRange` that were all
// this panel could show before. `levels` is still null end-to-end when
// `input.technicals` itself was null (short/missing history) — every
// sub-block below degrades independently on that, exactly as the fix round
// asked: a pick with no Fib anchor still shows its rails, and vice versa.
// Tunnel position and the golden-zone band still reuse v1's own
// `bar`/`goldenBand` primitives unchanged — the "deterministic factor
// breakdown, retained from v1" spec §7 asks for, not a redraw.
//
// No NEW colour pair is introduced by this block: rail/Fib/gap prices use
// `ink` on `surface` (17.85:1, already shipped elsewhere in this file), the
// two golden-zone Fib rows (0.5/0.618) reuse `goldInk` on `surface` — the
// exact pair primitives.ts's own `goldenBand` already ships at 5.02:1 — and
// every label stays on `muted` on `surface` (4.76:1). Nothing here sits on a
// tinted background, so the `canvas`/`infoSoft` failure modes documented at
// the top of this file don't apply.
export function technicalLevels(opts: {
  price: number | null
  vsSma150Pct: number | null
  positionPct: number | null
  retracement: number | null
  fullRange: PriceRange | null
  levels: DigestPickLevels | null
}): string {
  const l = opts.levels

  const rangeValue = opts.fullRange
    ? `${escapeHtml(usd(opts.fullRange.low))} – ${escapeHtml(usd(opts.fullRange.high))}`
    : '—'
  const rangeSub = opts.fullRange
    ? `${escapeHtml(pct(opts.fullRange.pctFromLow, 1))} from low · ${escapeHtml(pct(opts.fullRange.pctFromHigh, 1))} from high`
    : ''

  // Channel rails degrade on their own — a name too short for a regression
  // channel (< MIN_CHANNEL_BARS in technicals.ts) still gets everything else
  // in this panel, per the fix round's "degrade each sub-row independently".
  const hasRails = l != null && (l.channelUpper != null || l.channelMid != null || l.channelLower != null)
  const railsRow = hasRails
    ? `<tr>
          <td style="font:400 11px ${FONT};color:${PALETTE.muted};padding:2px 0;">Channel rails (upper · mid · lower)</td>
          <td align="right" style="font:700 12px ${FONT};color:${PALETTE.ink};padding:2px 0;font-variant-numeric:tabular-nums;">${escapeHtml(usd(l!.channelUpper))} · ${escapeHtml(usd(l!.channelMid))} · ${escapeHtml(usd(l!.channelLower))}</td>
        </tr>`
    : ''

  // SMA-150 dollar distance: prefer the real persisted price (`levels.sma150`)
  // — precise, no inversion needed. Falls back to inverting vsSma150Pct's own
  // formula (sma150 = price / (1 + vsSma150Pct/100), from derive.ts) only
  // when `levels` is null but the percent still persisted — `vsSma150Pct` is
  // computed from a separate `sma150` field on ScoreInput, independent of
  // `technicals`, so it can be present even when `levels` is not.
  const smaPrice = l?.sma150 ?? null
  const smaDollar =
    smaPrice != null && opts.price != null
      ? opts.price - smaPrice
      : opts.price != null && opts.vsSma150Pct != null && Number.isFinite(opts.vsSma150Pct)
        ? (opts.price * (opts.vsSma150Pct / 100)) / (1 + opts.vsSma150Pct / 100)
        : null
  const smaCaption =
    smaDollar != null
      ? `${smaDollar >= 0 ? '+' : '−'}${escapeHtml(usd(Math.abs(smaDollar)))} vs the 150-day average${smaPrice != null ? ` (${escapeHtml(usd(smaPrice))})` : ''}`
      : ''

  // Fib ladder: each level with its real price, the two golden-zone rungs
  // (0.5/0.618 — the same band goldenBand highlights below) picked out in
  // goldInk. Empty array (computed, no swing) renders nothing, same as null
  // (never computed) — the renderer doesn't need to tell those apart.
  //
  // technicals.ts's own contract (Fib.anchor) requires a 'window' anchor —
  // no real swing found, levels drawn from the fetched window's plain
  // high/low as a fallback — be visibly labelled as such (the dashboard
  // honours this too: TechnicalChart.tsx renders "window extremes" vs "from
  // detected swing"). Presenting a fallback ladder as a real swing
  // retracement, unlabelled, to expert traders, under the owner's name, is
  // exactly the gap this heading closes.
  const fibHeading = l?.fibAnchor === 'window' ? 'Fib ladder · window extremes' : 'Fib ladder'
  const fibRows = l && l.fib.length
    ? l.fib
        .map((f) => {
          const inGolden = f.ratio >= 0.5 && f.ratio <= 0.618
          return `<tr>
          <td style="font:400 11px ${FONT};color:${PALETTE.muted};padding:2px 0;">${inGolden ? '⭐ ' : ''}${(f.ratio * 100).toFixed(1)}% Fib</td>
          <td align="right" style="font:700 12px ${FONT};color:${inGolden ? PALETTE.goldInk : PALETTE.ink};padding:2px 0;font-variant-numeric:tabular-nums;">${escapeHtml(usd(f.price))}</td>
        </tr>`
        })
        .join('')
    : ''

  // Nearest open gaps (already capped at 3 by deriveLevels). Gap size is a
  // magnitude, not a signed delta, so it's rendered with a plain `%` suffix
  // rather than format.ts's `pct()`, which would prepend a misleading '+'.
  const gapRows = l && l.gaps.length
    ? l.gaps
        .map((g) => {
          const arrow = g.direction === 'up' ? '↑' : '↓'
          return `<tr>
          <td style="font:400 11px ${FONT};color:${PALETTE.muted};padding:2px 0;">${arrow} Gap ${escapeHtml(g.side)}</td>
          <td align="right" style="font:700 12px ${FONT};color:${PALETTE.ink};padding:2px 0;font-variant-numeric:tabular-nums;">${escapeHtml(usd(g.bottom))}–${escapeHtml(usd(g.top))} <span style="color:${PALETTE.muted};font-weight:400;">(${g.pct.toFixed(1)}%)</span></td>
        </tr>`
        })
        .join('')
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
        ${railsRow}
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
  ${
    fibRows
      ? `<tr><td style="padding:0 12px 8px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td colspan="2" style="font:700 10px ${FONT};color:${PALETTE.muted};padding:0 0 3px 0;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(fibHeading)}</td></tr>
        ${fibRows}
      </table>
    </td></tr>`
      : ''
  }
  ${
    gapRows
      ? `<tr><td style="padding:0 12px 10px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td colspan="2" style="font:700 10px ${FONT};color:${PALETTE.muted};padding:0 0 3px 0;text-transform:uppercase;letter-spacing:0.04em;">Nearby gaps</td></tr>
        ${gapRows}
      </table>
    </td></tr>`
      : ''
  }
</table>`
}

// ─── Commentary panel ──────────────────────────────────────────────
// infoSoft/infoInk — the same pair primitives.ts already reserves for the
// 'turnaround' signal state — reused here as the "this is generated, not
// editorial" tint. Spec §7 required that of AI copy; the copy is now
// composed from the picks' own figures instead (src/lib/market-read.ts),
// and the tint is kept for the same reason it was introduced: a reader
// should be able to tell generated prose from house commentary at a
// glance, whatever generates it. Body copy sits in
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
      <span style="font:700 ${headingSize} ${FONT};color:${PALETTE.infoInk};text-transform:uppercase;letter-spacing:0.04em;">📊 ${escapeHtml(opts.heading)}</span><br>
      <span style="font:400 ${textSize} ${FONT};color:${PALETTE.body};line-height:1.6;">${escapeHtml(opts.text)}</span>
    </td>
  </tr>
</table>`
}

// ─── News panel ─────────────────────────────────────────────────────
const NEWS_SNIPPET_MAX_CHARS = 220

/** Display ceiling, enforced HERE rather than trusted from the caller.
 *
 *  digest.ts fetches and stores up to NEWS_FETCH_LIMIT (5) items per pick —
 *  deliberately more than this, so a future template change has real items
 *  to draw from without a new fetch. Nothing capped the DISPLAY side to
 *  match: cardV2 passed the stored array straight through, so a pick with
 *  5 stored items rendered all 5, not the "up to 3" this panel's own
 *  earlier doc comment already claimed. Capping at the point that actually
 *  renders is the same reasoning src/lib/score.ts's gap table already
 *  follows ("already capped at 3 by deriveLevels — a name with a dozen
 *  unfilled gaps should not produce a dozen email rows") — the boundary
 *  that emits HTML is where a limit belongs, not left to every caller to
 *  remember. */
const NEWS_MAX_DISPLAY = 3

/** Truncates a news snippet at a SENTENCE boundary, never mid-clause — and
 *  returns null (meaning: don't show a snippet at all) when no safe
 *  boundary exists within the limit.
 *
 *  A word-boundary cut was tried first and was wrong in a way that matters
 *  here specifically: a real excerpt like "...raised guidance, which sounds
 *  bullish until you read the cash flow statement, where free cash flow
 *  fell 40%." cut at a word boundary near the limit renders as "...sounds
 *  bullish until you…" — grammatically clean, and reads as the OPPOSITE of
 *  what the source actually said. This sits inside a card recommending the
 *  stock; "exactly what the provider returned" is the entire premise of
 *  this feature, and a truncation that inverts the source's point is the
 *  one place that premise silently stopped being true. No heuristic can
 *  reliably detect a clause turning on a word like "but" or "despite", so
 *  this doesn't try — it only ever cuts where a sentence genuinely ends,
 *  and omits the snippet rather than guess when nothing in the limit does. */
function truncateSnippet(text: string, maxChars: number): string | null {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  let end = -1
  for (const stop of ['. ', '! ', '? ']) {
    end = Math.max(end, cut.lastIndexOf(stop))
  }
  if (/[.!?]$/.test(cut)) end = Math.max(end, cut.length - 1)
  return end > 0 ? cut.slice(0, end + 1).trim() : null
}

/** `publishedAt` as stored is FMP's own `'YYYY-MM-DD HH:MM:SS'` — the date
 *  portion is unambiguous and needs no Date parsing (this codebase avoids
 *  `new Date()` off provider strings wherever a plain slice/compare works
 *  instead). Shown so a reader can tell a headline is from today versus
 *  three weeks ago — the item is still the most recent one FMP has for a
 *  thin-coverage name, but omitting the date let it silently read as
 *  today's news whether or not it was. */
function newsDateLabel(publishedAt: string): string {
  return publishedAt.slice(0, 10)
}

/** Up to 3 real, attributed news items — title, a short excerpt, the
 *  outlet's name and date, a link to the original. Every field is exactly
 *  what src/market-data/provider.ts's NewsItem carries: nothing here is
 *  generated, paraphrased, or extracted — see NewsItem's own doc comment
 *  for why that's a hard constraint, not a style choice. Omitted entirely
 *  (returns '') when there is nothing to show — never a placeholder like
 *  "no news today", matching this template's degrade-not-fail rule
 *  everywhere else (the chart row, the market-read panel).
 *
 *  Deliberately styled to NOT look like TripleQ's own commentary: the title
 *  is ink, not brand indigo, and the header names the items as third-party.
 *  This panel sits between TripleQ's own "Read" panel and its own reason
 *  sentence — without that distinction a promotional headline like "3
 *  Reasons to Buy" (a genuinely common shape for this kind of feed) would
 *  read as house copy rather than a linked, unendorsed external article. */
export function newsPanel(
  items: Array<{ title: string; snippet: string; publisher: string; url: string; publishedAt: string }>,
): string {
  if (items.length === 0) return ''
  const rows = items
    .slice(0, NEWS_MAX_DISPLAY)
    .map((item) => {
      const snippet = item.snippet ? truncateSnippet(item.snippet, NEWS_SNIPPET_MAX_CHARS) : null
      return `
    <tr><td style="padding:6px 0;border-top:1px solid ${PALETTE.line};">
      <a href="${escapeHtml(item.url)}" style="font:700 12px ${FONT};color:${PALETTE.ink};text-decoration:underline;">${escapeHtml(item.title)}</a><br>
      ${snippet ? `<span style="font:400 12px ${FONT};color:${PALETTE.body};line-height:1.5;">${escapeHtml(snippet)}</span><br>` : ''}
      <span style="font:400 11px ${FONT};color:${PALETTE.muted};">— ${escapeHtml(item.publisher)} · ${escapeHtml(newsDateLabel(item.publishedAt))}</span>
    </td></tr>`
    })
    .join('')
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.surface};border:1px solid ${PALETTE.line};border-radius:8px;">
  <tr><td style="padding:10px 12px 0 12px;font:700 11px ${FONT};color:${PALETTE.ink};">📰 In the news</td></tr>
  <tr><td style="padding:0 12px 4px 12px;font:400 10px ${FONT};color:${PALETTE.muted};">From third-party publishers — not TripleQ, not an endorsement</td></tr>
  <tr><td style="padding:0 12px 8px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
  </td></tr>
</table>`
}
