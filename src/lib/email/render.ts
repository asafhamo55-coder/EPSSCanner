// The daily digest, as HTML and as plain text. Pure — everything it needs
// arrives as an argument, so scripts/preview-digest.ts renders it to a file
// without a network or a database.

import { bigUsd, num, pct, usd } from '@/lib/format'
import type { ScoredPick, Selection } from '@/lib/score'
import { DRAWDOWN_KNOTS, MAX_PICKS, MIN_MARKET_CAP, MIN_SCORE, SMA_ZERO_AT_PCT } from '@/lib/score'
import type { SignalState } from '@/lib/signals'
import {
  bar,
  chip,
  escapeHtml,
  FONT,
  goldenBand,
  markerBar,
  meter,
  PALETTE,
  type ChipTone,
  shell,
} from './primitives'

export interface DigestRecipient {
  firstName: string
  unsubscribeToken: string
}

export interface DigestData {
  recipient: DigestRecipient
  selection: Selection
  /** Already-formatted Eastern date, e.g. "Monday, 14 September 2026". */
  asOfLabel: string
  /** Absolute origin for ticker / unsubscribe links, no trailing slash. */
  siteUrl: string
}

/** The drawdown factor's domain is [0, last knot] — the same curve
 *  runFactors() scores against, so the bar's scale can't drift from what
 *  actually earns points. */
const DRAWDOWN_DOMAIN_MAX = DRAWDOWN_KNOTS[DRAWDOWN_KNOTS.length - 1][0]

/** Where the "% vs SMA" marker sits on its track. ±SMA_ZERO_AT_PCT maps to the
 *  full width, so the centre is the SMA itself and the scale matches the
 *  factor's own zero-credit domain in score.ts — not a restated literal. */
function smaMarkerPct(v: number | null): number {
  if (v == null) return 50
  return 50 + (Math.max(-SMA_ZERO_AT_PCT, Math.min(SMA_ZERO_AT_PCT, v)) / SMA_ZERO_AT_PCT) * 50
}

/** Colour a YoY/NTM chip from the underlying SignalState, not from the sign
 *  of the percentage — signals.ts sets 'pass' only at ≥20% YoY (≥15% NTM),
 *  and a 'flag' name (soft-positive, 0–20%/0–15%) must read amber here the
 *  same way SignalChip.tsx reads it amber on the dashboard, not green. */
function chipTone(state: SignalState): ChipTone {
  if (state === 'pass' || state === 'turnaround') return 'positive'
  if (state === 'flag') return 'warning'
  return 'negative' // 'fail' | 'na'
}

/** Join reasons as a proper list: "a.", "a and b.", or "a, b, and c." — not
 *  string-concatenated in a way that reads as "a, and b, c". */
function joinReasons(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

function logoUrl(symbol: string): string {
  return `https://assets.parqet.com/logos/symbol/${encodeURIComponent(symbol)}?format=png`
}

/** EPS CAGR has no SignalState of its own — score.ts derives it algebraically
 *  from PEG (see epsCagr5yr in derive.ts), not from signals.ts — so its chip
 *  below stays coloured on the sign of the value, unlike YoY/NTM. */
function card(p: ScoredPick, rank: number, siteUrl: string): string {
  const href = `${siteUrl}/ticker/${encodeURIComponent(p.symbol)}`
  const reason = p.reasons.length
    ? (() => {
        const joined = joinReasons(p.reasons)
        return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`
      })()
    : 'Cleared every entry gate.'
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
      <td style="padding:0 18px 4px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            ${chip({ label: '📈 YoY EPS', value: pct(p.yoyPct, 0), tone: chipTone(p.input.yoyState) })}
            ${chip({ label: '🔮 NTM EPS', value: pct(p.ntmPct, 0), tone: chipTone(p.input.ntmState) })}
            ${chip({ label: '🚀 CAGR 5y', value: pct(p.epsCagr5yr, 0), tone: (p.epsCagr5yr ?? 0) > 0 ? 'positive' : 'negative' })}
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:12px 18px 0 18px;">
        ${markerBar({
          label: '📉 Price vs 150-day average',
          value: pct(p.vsSma150Pct),
          markerPct: smaMarkerPct(p.vsSma150Pct),
          color: PALETTE.brand,
          leftCap: `−${SMA_ZERO_AT_PCT}%`,
          rightCap: `+${SMA_ZERO_AT_PCT}%`,
        })}
        ${bar({
          label: '🎯 Tunnel position (lower is better)',
          value:
            p.positionPct == null
              ? 'n/a'
              : `${Math.max(0, Math.min(100, p.positionPct)).toFixed(0)}% up the channel`,
          fillPct: p.positionPct == null ? 0 : 100 - Math.max(0, Math.min(100, p.positionPct)),
          color: PALETTE.positive,
        })}
        ${goldenBand({ ratio: p.retracement })}
        ${bar({
          label: '🏔️ Room below the all-time high',
          value: pct(p.pctFromAth),
          fillPct:
            p.pctFromAth == null
              ? 0
              : Math.min(100, (Math.abs(p.pctFromAth) / DRAWDOWN_DOMAIN_MAX) * 100),
          color: PALETTE.gold,
        })}
      </td>
    </tr>
    <tr>
      <td style="padding:2px 18px 16px 18px;font:400 12px ${FONT};color:${PALETTE.body};line-height:1.6;">
        ${escapeHtml(reason)}
        <a href="${escapeHtml(href)}" style="color:${PALETTE.brand};text-decoration:none;font-weight:700;">See the chart →</a>
      </td>
    </tr>
  </table>
</td></tr>`
}

function emptyState(selection: Selection): string {
  return `
<tr><td style="padding:0 0 14px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.surface};border:1px solid ${PALETTE.line};border-radius:12px;">
    <tr><td style="padding:28px 24px;font:400 14px ${FONT};color:${PALETTE.body};line-height:1.7;">
      <span style="font:700 16px ${FONT};color:${PALETTE.ink};">🫗 Nothing cleared the bar this morning.</span><br><br>
      Of ${selection.considered} names on the watchlist, none both passed every entry gate
      (market cap over $${(MIN_MARKET_CAP / 1e9).toFixed(0)}B, positive YoY EPS, positive NTM EPS growth,
      positive 5-year expected EPS CAGR, trading below its all-time high) and scored at least
      ${MIN_SCORE}/100.<br><br>
      We would rather send you a short email than a padded one.
    </td></tr>
  </table>
</td></tr>`
}

export function renderDigest(data: DigestData): { subject: string; html: string; text: string } {
  const { picks } = data.selection
  const n = picks.length
  const first = data.recipient.firstName
  const unsubUrl = `${data.siteUrl}/api/subscribe/unsubscribe?token=${encodeURIComponent(data.recipient.unsubscribeToken)}`

  const subject =
    n === 0
      ? `TripleQ Daily Maily — no setups cleared the bar today`
      : `TripleQ Daily Maily — ${first}, ${n} setup${n === 1 ? '' : 's'} scored today (top: ${picks[0].symbol} ${picks[0].score.toFixed(0)}/100)`

  const preheader =
    n === 0
      ? `None of ${data.selection.considered} watchlist names cleared the entry gate this morning.`
      : `${picks.map((p) => p.symbol).join(', ')} — scored before the open.`

  const header = `
<tr><td style="padding:0 0 18px 0;">
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
</td></tr>
<tr><td style="padding:0 2px 16px 2px;font:400 14px ${FONT};color:${PALETTE.body};line-height:1.7;">
  <span style="font:700 16px ${FONT};color:${PALETTE.ink};">☀️ Good morning, ${escapeHtml(first)}.</span><br>
  ${
    n === 0
      ? `None of ${data.selection.considered} watchlist names cleared this morning's entry gate.`
      : `${n} of ${data.selection.considered} watchlist names cleared the entry gate and scored ${MIN_SCORE} or better${data.selection.belowCutoff > 0 ? `; ${data.selection.belowCutoff} more passed the gate but fell short on score` : ''}. Ranked best first, ${MAX_PICKS} maximum.`
  }
</td></tr>`

  const body =
    header + (n === 0 ? emptyState(data.selection) : picks.map((p, i) => card(p, i + 1, data.siteUrl)).join(''))

  const footerLinks = `You are receiving this because you confirmed your subscription at ${escapeHtml(data.siteUrl)}.<br>
<a href="${escapeHtml(unsubUrl)}" style="color:${PALETTE.muted};">Unsubscribe</a>`

  const text = [
    `TripleQ Daily Maily — ${data.asOfLabel}`,
    ``,
    `Good morning, ${first}.`,
    ``,
    n === 0
      ? `None of ${data.selection.considered} watchlist names cleared this morning's entry gate.`
      : picks
          .map(
            (p, i) =>
              `${i + 1}. ${p.symbol} (${p.name ?? ''}) — ${p.score.toFixed(1)}/100\n` +
              `   Price ${usd(p.price)} · Market cap ${bigUsd(p.marketCap)} · P/E ${num(p.trailingPe, 1)}\n` +
              `   YoY EPS ${pct(p.yoyPct, 0)} · NTM ${pct(p.ntmPct, 0)} · CAGR 5y ${pct(p.epsCagr5yr, 0)}\n` +
              `   vs 150-day avg ${pct(p.vsSma150Pct)} · ${p.pctFromAth == null ? '' : `${pct(p.pctFromAth)} from the high`}\n` +
              `   ${p.reasons.join('; ')}\n` +
              `   ${data.siteUrl}/ticker/${p.symbol}`,
          )
          .join('\n\n'),
    ``,
    `Fundamental signals only — not investment advice.`,
    `Unsubscribe: ${unsubUrl}`,
    ``,
    `TripleQ Group`,
  ].join('\n')

  return {
    subject,
    html: shell({ title: subject, preheader, bodyHtml: body, footerLinksHtml: footerLinks }),
    text,
  }
}
