// The v2 daily digest — professional-grade HTML for expert traders. Pure,
// same discipline as v1's render.ts: everything it needs arrives as an
// argument, no I/O, no Date math beyond formatting an already-computed label.
//
// `renderDigestV2` is dispatched to from `renderDigest()` in render.ts behind
// the DIGEST_TEMPLATE flag (Task 9's job, not this file's). It accepts the
// exact same `DigestData` v1 does, widened with an optional `indices` field
// this file defines locally (see `DigestDataV2` below) — the digest route
// does not thread IndexCardData through today, so that field is designed to
// be ABSENT on every real call right now, and the whole index strip degrades
// to nothing when it is. That is deliberate, not a placeholder: wiring
// `indices` through the route is a follow-on change to render.ts's caller,
// outside this file's brief, and nothing here breaks if it never happens.
//
// A handful of small pure helpers below (chipTone, valueTone, joinReasons,
// logoUrl, smaMarkerPct, DRAWDOWN_DOMAIN_MAX) duplicate private (unexported)
// helpers in render.ts. That file is owned by a concurrent task and none of
// these are exported from it, so there is no way to import them without
// editing render.ts — which this task is explicitly told not to touch. Kept
// byte-identical in logic to the v1 originals so the two templates cannot
// silently diverge on what a chip colour or a reason sentence means.

import type { PriceRange } from '@/lib/derive'
import { bigUsd, marginPct, num, pct, ratio, usd } from '@/lib/format'
import { deriveLevels, MAX_PICKS, MIN_MARKET_CAP, MIN_SCORE } from '@/lib/score'
import type { SignalState } from '@/lib/signals'
import type { Commentary } from '@/lib/ai/commentary'
import type { IndexCardData } from '@/market-data/indices'
import type { DigestData, DigestPick, DigestSelection } from './render'
import { chip, escapeHtml, FONT, meter, PALETTE, shell, type ChipTone } from './primitives'
import { commentaryPanel, indexStrip, metricsGrid, technicalLevels, type MetricBlock } from './primitives-v2'

/** `DigestData` plus the header index strip's data. Optional and additive —
 *  see the file banner. Structurally, a plain `DigestData` value (missing the
 *  key entirely) satisfies this type, so `renderDigest()`'s dispatcher in
 *  render.ts can call `renderDigestV2(data)` with the exact same `data` it
 *  passes to `renderDigestV1` without this file ever touching that file. */
export interface DigestDataV2 extends DigestData {
  indices?: IndexCardData[]
}

// ─── Duplicated-from-v1 pure helpers (see file banner) ─────────────
function chipTone(state: SignalState): ChipTone {
  if (state === 'pass') return 'positive'
  if (state === 'turnaround') return 'info'
  if (state === 'flag') return 'warning'
  return 'negative' // 'fail' | 'na'
}

function valueTone(pctVal: number | null): ChipTone {
  return (pctVal ?? 0) > 0 ? 'positive' : 'negative'
}

function joinReasons(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

function logoUrl(symbol: string): string {
  return `https://assets.parqet.com/logos/symbol/${encodeURIComponent(symbol)}?format=png`
}

/** 'neutral' (ink) unless the value is a genuine, nonzero signed reading —
 *  the metrics-grid rows this drives (momentum, EPS surprise) have no
 *  SignalState of their own, so like v1's CAGR chip they colour on sign, not
 *  on an app-side classification. Never applied to YoY/NTM, which stay on
 *  the chip's SignalState colouring exclusively (see the brief: colour those
 *  two from yoyState/ntmState, never from sign). */
function signTone(v: number | null | undefined): 'positive' | 'negative' | 'neutral' {
  if (v == null || !Number.isFinite(v) || v === 0) return 'neutral'
  return v > 0 ? 'positive' : 'negative'
}

// ─── Pick card ──────────────────────────────────────────────────────
function cardV2(p: DigestPick, rank: number, siteUrl: string, commentary: Commentary | null): string {
  // Same defensive `'x' in p` narrowing as v1's card(), for the same reason:
  // `picks` is a jsonb column and an old row can genuinely lack a key the TS
  // union type now claims is required. See render.ts's card() comment.
  const reasons = 'reasons' in p && p.reasons ? p.reasons : []
  const positionPct = 'positionPct' in p ? p.positionPct : null
  const retracement = 'retracement' in p ? p.retracement : null
  // The persisted (prep) path reads `levels` straight off the record; the
  // in-memory fallback path (a freshly-scored ScoredPick, never persisted)
  // still has the full `input.technicals` live, so it derives the same shape
  // on the fly with the identical helper `toDigestPickRecord` uses — the two
  // paths can't drift into different projections of the same Technicals.
  const levels = 'input' in p ? deriveLevels(p.input.technicals) : p.levels
  const yoyState: SignalState | undefined = 'input' in p ? p.input.yoyState : p.yoyState
  const ntmState: SignalState | undefined = 'input' in p ? p.input.ntmState : p.ntmState
  const yoyTone = yoyState ? chipTone(yoyState) : valueTone(p.yoyPct)
  const ntmTone = ntmState ? chipTone(ntmState) : valueTone(p.ntmPct)
  const href = `${siteUrl}/ticker/${encodeURIComponent(p.symbol)}`
  const reason = reasons.length
    ? (() => {
        const joined = joinReasons(reasons)
        return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`
      })()
    : 'Cleared every entry gate.'
  const stockRead = commentary?.perStock[p.symbol]
  const fullRange: PriceRange | null = p.fullRange ?? null

  // The chart image gets its own <tr>, omitted entirely when chartUrl is
  // absent or null — never a broken <img>. The technical-levels panel below
  // (which embeds v1's own `bar`/`goldenBand`) always renders regardless, so
  // a pick with no chart still gets the full v1 bar treatment, not a hole.
  const chartRow = p.chartUrl
    ? `
    <tr>
      <td style="padding:0 18px 12px 18px;">
        <img src="${escapeHtml(p.chartUrl)}" width="564" alt="${escapeHtml(p.symbol)} 126-day price chart" style="display:block;width:100%;max-width:564px;height:auto;border:0;border-radius:8px;">
      </td>
    </tr>`
    : ''

  const blocks: readonly [MetricBlock, MetricBlock, MetricBlock, MetricBlock] = [
    {
      title: 'Valuation',
      rows: [
        { label: 'Trailing P/E', value: num(p.trailingPe, 1) },
        { label: 'Forward P/E', value: num(p.forwardPe, 1) },
        { label: 'PEG (5yr)', value: ratio(p.peg5yr) },
        { label: 'EPS CAGR (5yr)', value: pct(p.epsCagr5yr, 1) },
      ],
    },
    {
      title: 'Margins',
      rows: [
        { label: 'Net margin', value: marginPct(p.netMarginTtm) },
        { label: 'Gross margin', value: marginPct(p.grossMarginTtm) },
        { label: 'Operating margin', value: marginPct(p.operatingMarginTtm) },
        { label: 'ROI (TTM)', value: marginPct(p.roiTtm) },
      ],
    },
    {
      title: 'Momentum',
      rows: [
        { label: '1-day', value: pct(p.change1dPct), tone: signTone(p.change1dPct) },
        { label: '1-week', value: pct(p.change1wPct), tone: signTone(p.change1wPct) },
        { label: '1-month', value: pct(p.change1mPct), tone: signTone(p.change1mPct) },
        { label: 'From all-time high', value: pct(p.pctFromAth), tone: signTone(p.pctFromAth) },
      ],
    },
    {
      title: 'Earnings',
      rows: [
        // Plain ink here, deliberately — the chip row above already carries
        // the SignalState colour for YoY/NTM. Colouring these too would show
        // the same figure in two colours if a display glitch ever let them
        // drift (e.g. a stale jsonb row), and it isn't this row's job to
        // repeat a signal a chip already gave.
        { label: 'YoY EPS growth', value: pct(p.yoyPct) },
        { label: 'NTM EPS growth', value: pct(p.ntmPct) },
        { label: 'Last EPS surprise', value: pct(p.epsSurprisePct), tone: signTone(p.epsSurprisePct) },
      ],
    },
  ]

  return `
<tr><td style="padding:0 0 14px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.surface};border:1px solid ${PALETTE.line};border-radius:12px;">
    <tr>
      <td style="padding:16px 18px 10px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="34" valign="middle" style="padding:0 10px 0 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="28" style="background:${PALETTE.brand};border-radius:8px;">
                <tr><td align="center" style="height:28px;font:700 13px ${FONT};color:#ffffff;">${rank}</td></tr>
              </table>
            </td>
            <td width="36" valign="middle" style="padding:0 10px 0 0;">
              <img src="${logoUrl(p.symbol)}" width="32" height="32" alt="${escapeHtml(p.symbol)}" style="width:32px;height:32px;border-radius:8px;display:block;border:0;">
            </td>
            <td valign="middle">
              <a href="${escapeHtml(href)}" style="text-decoration:none;">
                <span style="font:700 17px ${FONT};color:${PALETTE.ink};">${escapeHtml(p.symbol)}</span><br>
                <span style="font:400 12px ${FONT};color:${PALETTE.muted};">${escapeHtml(p.name ?? '')}</span>
              </a>
            </td>
            <td width="170" valign="middle">${meter({ score: p.score })}</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0 18px 10px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font:400 11px ${FONT};color:${PALETTE.muted};">💰 ${escapeHtml(usd(p.price))}</td>
            <td align="center" style="font:400 11px ${FONT};color:${PALETTE.muted};">🏦 ${escapeHtml(bigUsd(p.marketCap))}</td>
            <td align="right" style="font:400 11px ${FONT};color:${PALETTE.muted};">📊 P/E ${escapeHtml(num(p.trailingPe, 1))}</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0 18px 12px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            ${chip({ label: '📈 YoY EPS', value: pct(p.yoyPct, 0), tone: yoyTone })}
            ${chip({ label: '🔮 NTM EPS', value: pct(p.ntmPct, 0), tone: ntmTone })}
            ${chip({ label: '🚀 CAGR 5y', value: pct(p.epsCagr5yr, 0), tone: (p.epsCagr5yr ?? 0) > 0 ? 'positive' : 'negative' })}
          </tr>
        </table>
      </td>
    </tr>
    ${chartRow}
    <tr>
      <td style="padding:0 18px 10px 18px;">
        ${metricsGrid(blocks)}
      </td>
    </tr>
    <tr>
      <td style="padding:0 18px 10px 18px;">
        ${technicalLevels({
          price: p.price,
          vsSma150Pct: p.vsSma150Pct,
          positionPct,
          retracement,
          fullRange,
          levels,
        })}
      </td>
    </tr>
    ${
      stockRead
        ? `<tr><td style="padding:0 18px 10px 18px;">${commentaryPanel({ heading: 'AI read', text: stockRead, compact: true })}</td></tr>`
        : ''
    }
    <tr>
      <td style="padding:2px 18px 16px 18px;font:400 12px ${FONT};color:${PALETTE.body};line-height:1.6;">
        ${escapeHtml(reason)}
        <a href="${escapeHtml(href)}" style="color:${PALETTE.brand};text-decoration:none;font-weight:700;">See the chart →</a>
      </td>
    </tr>
  </table>
</td></tr>`
}

function emptyState(selection: DigestSelection): string {
  const intro =
    selection.considered != null
      ? `Of ${selection.considered} names on the watchlist, none both passed every entry gate`
      : `Nothing passed every entry gate`
  return `
<tr><td style="padding:0 0 14px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.surface};border:1px solid ${PALETTE.line};border-radius:12px;">
    <tr><td style="padding:28px 24px;font:400 14px ${FONT};color:${PALETTE.body};line-height:1.7;">
      <span style="font:700 16px ${FONT};color:${PALETTE.ink};">🫗 Nothing cleared the bar this morning.</span><br><br>
      ${intro}
      (market cap over $${(MIN_MARKET_CAP / 1e9).toFixed(0)}B, positive YoY EPS, positive NTM EPS growth,
      positive 5-year expected EPS CAGR, trading below its all-time high) and scored at least
      ${MIN_SCORE}/100.<br><br>
      We would rather send you a short email than a padded one.
    </td></tr>
  </table>
</td></tr>`
}

export function renderDigestV2(data: DigestDataV2): { subject: string; html: string; text: string } {
  const { picks } = data.selection
  const n = picks.length
  const first = data.recipient.firstName
  const unsubUrl = `${data.siteUrl}/api/subscribe/unsubscribe?token=${encodeURIComponent(data.recipient.unsubscribeToken)}`
  const commentary = data.commentary ?? null
  const indices = data.indices ?? []

  const subject =
    n === 0
      ? `TripleQ Daily Maily — no setups cleared the bar today`
      : `TripleQ Daily Maily — ${first}, ${n} setup${n === 1 ? '' : 's'} scored today (top: ${picks[0].symbol} ${picks[0].score.toFixed(0)}/100)`

  const preheader =
    n === 0
      ? data.selection.considered != null
        ? `None of ${data.selection.considered} watchlist names cleared the entry gate this morning.`
        : `Nothing cleared the entry gate this morning.`
      : `${picks.map((p) => p.symbol).join(', ')} — scored before the open.`

  const brandBar = `
<tr><td style="padding:0 0 12px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.brandDeep};border-radius:14px;">
    <tr><td style="padding:22px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td width="40" valign="middle" style="padding:0 12px 0 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="36" style="background:${PALETTE.brand};border-radius:10px;">
              <tr><td align="center" style="height:36px;font:700 18px ${FONT};color:#ffffff;">Q</td></tr>
            </table>
          </td>
          <td valign="middle">
            <span style="font:700 19px ${FONT};color:#ffffff;">TripleQ Daily Maily</span><br>
            <span style="font:400 12px ${FONT};color:#c7d2fe;">${escapeHtml(data.asOfLabel)} · scored before the open</span>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</td></tr>`

  // Absent on every call today — the digest route never threads IndexCardData
  // through DigestData (see the file banner) — so this degrades to nothing,
  // never a broken/empty-looking strip.
  const indexRow = indices.length ? `<tr><td style="padding:0 0 14px 0;">${indexStrip(indices)}</td></tr>` : ''

  const marketRead = commentary?.marketRead
    ? `<tr><td style="padding:0 0 16px 0;">${commentaryPanel({ heading: 'AI market read', text: commentary.marketRead })}</td></tr>`
    : ''

  const greeting = `
<tr><td style="padding:0 2px 16px 2px;font:400 14px ${FONT};color:${PALETTE.body};line-height:1.7;">
  <span style="font:700 16px ${FONT};color:${PALETTE.ink};">☀️ Good morning, ${escapeHtml(first)}.</span><br>
  ${
    n === 0
      ? data.selection.considered != null
        ? `None of ${data.selection.considered} watchlist names cleared this morning's entry gate.`
        : `Nothing cleared this morning's entry gate.`
      : data.selection.considered != null
        ? `${n} of ${data.selection.considered} watchlist names cleared the entry gate and scored ${MIN_SCORE} or better${(data.selection.belowCutoff ?? 0) > 0 ? `; ${data.selection.belowCutoff} more passed the gate but fell short on score` : ''}. Ranked best first, ${MAX_PICKS} maximum.`
        : `${n} setup${n === 1 ? '' : 's'} cleared the entry gate and scored ${MIN_SCORE} or better today. Ranked best first, ${MAX_PICKS} maximum.`
  }
</td></tr>`

  const body =
    brandBar +
    indexRow +
    marketRead +
    greeting +
    (n === 0 ? emptyState(data.selection) : picks.map((p, i) => cardV2(p, i + 1, data.siteUrl, commentary)).join(''))

  const footerLinks = `You are receiving this because you confirmed your subscription at ${escapeHtml(data.siteUrl)}.<br>
<a href="${escapeHtml(unsubUrl)}" style="color:${PALETTE.muted};">Unsubscribe</a>`

  const text = [
    `TripleQ Daily Maily — ${data.asOfLabel}`,
    ``,
    `Good morning, ${first}.`,
    ``,
    commentary?.marketRead ? `AI market read: ${commentary.marketRead}` : null,
    commentary?.marketRead ? `` : null,
    n === 0
      ? data.selection.considered != null
        ? `None of ${data.selection.considered} watchlist names cleared this morning's entry gate.`
        : `Nothing cleared this morning's entry gate.`
      : picks
          .map((p, i) => {
            const reasons = 'reasons' in p && p.reasons ? p.reasons : []
            const stockRead = commentary?.perStock[p.symbol]
            return (
              `${i + 1}. ${p.symbol} (${p.name ?? ''}) — ${p.score.toFixed(1)}/100\n` +
              `   Price ${usd(p.price)} · Market cap ${bigUsd(p.marketCap)} · P/E ${num(p.trailingPe, 1)} · Fwd P/E ${num(p.forwardPe, 1)}\n` +
              `   YoY EPS ${pct(p.yoyPct, 0)} · NTM ${pct(p.ntmPct, 0)} · CAGR 5y ${pct(p.epsCagr5yr, 0)} · EPS surprise ${pct(p.epsSurprisePct, 0)}\n` +
              `   Margins — net ${marginPct(p.netMarginTtm)} · gross ${marginPct(p.grossMarginTtm)} · operating ${marginPct(p.operatingMarginTtm)} · ROI ${marginPct(p.roiTtm)}\n` +
              `   Momentum — 1d ${pct(p.change1dPct)} · 1w ${pct(p.change1wPct)} · 1m ${pct(p.change1mPct)}\n` +
              `   vs 150-day avg ${pct(p.vsSma150Pct)} · ${p.pctFromAth == null ? '' : `${pct(p.pctFromAth)} from the high`}\n` +
              `   ${reasons.length ? reasons.join('; ') : 'Cleared every entry gate.'}\n` +
              (stockRead ? `   AI read: ${stockRead}\n` : '') +
              `   ${data.siteUrl}/ticker/${p.symbol}`
            )
          })
          .join('\n\n'),
    ``,
    `Fundamental signals only — not investment advice.`,
    `Unsubscribe: ${unsubUrl}`,
    ``,
    `TripleQ Group`,
  ]
    .filter((line): line is string => line != null)
    .join('\n')

  return {
    subject,
    html: shell({ title: subject, preheader, bodyHtml: body, footerLinksHtml: footerLinks }),
    text,
  }
}
