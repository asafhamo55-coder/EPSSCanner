// The daily digest, as HTML and as plain text. Pure — everything it needs
// arrives as an argument, so scripts/preview-digest.ts renders it to a file
// without a network or a database.

import { bigUsd, num, pct, usd } from '@/lib/format'
import type { ScoredPick } from '@/lib/score'
import { DRAWDOWN_KNOTS, MAX_PICKS, MIN_MARKET_CAP, MIN_SCORE, SMA_ZERO_AT_PCT } from '@/lib/score'
import type { SignalState } from '@/lib/signals'
// `PrepPickRecord` is the shape screener_digest_prep actually persists per
// pick (see src/lib/digest.ts): a `toDigestPickRecord` projection of a
// ScoredPick plus `chartUrl`. It is NOT a ScoredPick — it carries none of
// `gates`/`passedGates`/`reasons`/`input`/`positionPct`/`retracement`, which
// only exist on the in-memory object scoring produces. The digest route's
// prepared-row path (Task 7) reads this shape back from the database, so
// this renderer has to accept it as an alternative to a full ScoredPick
// rather than assume every pick it receives was just computed.
import type { PrepPickRecord } from '@/lib/digest'
import type { Commentary } from '@/lib/ai/commentary'
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

/** A pick as this renderer can receive it: either a freshly-scored
 *  `ScoredPick` (the fallback path, or v1 today) or a `PrepPickRecord` read
 *  back from screener_digest_prep (the prepared path). See the import note
 *  above for exactly which fields the latter is missing. */
export type DigestPick = ScoredPick | PrepPickRecord

export interface DigestSelection {
  picks: DigestPick[]
  /** How many tickers were fed in. Null on the prepared path: the prep row
   *  does not persist this count (it is not part of the audit projection),
   *  so the copy below degrades to a less specific sentence rather than
   *  showing a number that isn't there. */
  considered: number | null
  /** How many passed every gate but fell below MIN_SCORE. Same nullability
   *  reason as `considered`. */
  belowCutoff: number | null
}

export interface DigestData {
  recipient: DigestRecipient
  selection: DigestSelection
  /** Already-formatted Eastern date, e.g. "Monday, 14 September 2026". */
  asOfLabel: string
  /** Absolute origin for ticker / unsubscribe links, no trailing slash. */
  siteUrl: string
  /** AI market commentary from the prepared row, or null on the fallback
   *  path (no prep) or when the AI stage was skipped/timed out. Unused by
   *  v1's markup today — threaded through so it reaches the template without
   *  route.ts needing to know which template is active (see Task 8/9). */
  commentary?: Commentary | null
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
 *  same way SignalChip.tsx reads it amber on the dashboard, not green.
 *  'turnaround' (a genuine loss→profit sign change, with no defined growth
 *  %) is info/blue here too, matching SignalChip.tsx's 'info' tone — not
 *  green, which would repeat the same email-vs-app mismatch for a rarer
 *  state. */
function chipTone(state: SignalState): ChipTone {
  if (state === 'pass') return 'positive'
  if (state === 'turnaround') return 'info'
  if (state === 'flag') return 'warning'
  return 'negative' // 'fail' | 'na'
}

/** Chip tone for a `PrepPickRecord`, which carries the raw YoY/NTM percentage
 *  but not the `SignalState` `chipTone` above reads (that lives only on the
 *  in-memory `ScoreInput`, never persisted to screener_digest_prep). Colours
 *  on the sign of the value instead — the same convention the CAGR chip
 *  below already uses, since CAGR has no SignalState of its own either. This
 *  loses the 'flag' (soft-positive) amber and 'turnaround' blue nuance, but
 *  never colours a positive value as negative or vice versa. */
function valueTone(pct: number | null): ChipTone {
  return (pct ?? 0) > 0 ? 'positive' : 'negative'
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
function card(p: DigestPick, rank: number, siteUrl: string): string {
  // `reasons`, `positionPct`, `retracement`, `yoyState` and `ntmState` are
  // part of `DigestPickRecord` since Task 7's fix round 1 (see score.ts), so
  // a `PrepPickRecord` read back from screener_digest_prep carries all five
  // — a ScoredPick carries the state pair nested under `input` instead. The
  // `'x' in p` checks below are NOT type-narrowing noise: `picks` is a jsonb
  // column, and a row written before that fix round genuinely lacks these
  // keys at runtime even though the TS type now claims they're required, so
  // this is real defence against old data, not just satisfying the
  // compiler. Falling back to a neutral/absent rendering for each on such a
  // row is a richness degradation, never a wrong one: the reason text falls
  // back to the same generic sentence already used when a ScoredPick happens
  // to have no reasons, the bars render "n/a"/empty for a null
  // positionPct/retracement, and the chip tone falls back to colouring by
  // the sign of the value (see valueTone) rather than by SignalState.
  const reasons = 'reasons' in p && p.reasons ? p.reasons : []
  const positionPct = 'positionPct' in p ? p.positionPct : null
  const retracement = 'retracement' in p ? p.retracement : null
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
            ${chip({ label: '📈 YoY EPS', value: pct(p.yoyPct, 0), tone: yoyTone })}
            ${chip({ label: '🔮 NTM EPS', value: pct(p.ntmPct, 0), tone: ntmTone })}
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
            positionPct == null
              ? 'n/a'
              : `${Math.max(0, Math.min(100, positionPct)).toFixed(0)}% up the channel`,
          fillPct: positionPct == null ? 0 : 100 - Math.max(0, Math.min(100, positionPct)),
          color: PALETTE.positive,
        })}
        ${goldenBand({ ratio: retracement })}
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

function emptyState(selection: DigestSelection): string {
  // `selection.considered` is null on a prepared row written before
  // migration 0031 added the column — degrade to a sentence that doesn't
  // name a watchlist size rather than print "Of null names". (Note: "No
  // name both passed..." doesn't parse — "no name" is singular, "both"
  // wants a plural subject — so the null branch drops "both" entirely
  // rather than trying to force it in.)
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
      ? data.selection.considered != null
        ? `None of ${data.selection.considered} watchlist names cleared the entry gate this morning.`
        : `Nothing cleared the entry gate this morning.`
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
      ? data.selection.considered != null
        ? `None of ${data.selection.considered} watchlist names cleared this morning's entry gate.`
        : `Nothing cleared this morning's entry gate.`
      : data.selection.considered != null
        ? `${n} of ${data.selection.considered} watchlist names cleared the entry gate and scored ${MIN_SCORE} or better${(data.selection.belowCutoff ?? 0) > 0 ? `; ${data.selection.belowCutoff} more passed the gate but fell short on score` : ''}. Ranked best first, ${MAX_PICKS} maximum.`
        : `${n} setup${n === 1 ? '' : 's'} cleared the entry gate and scored ${MIN_SCORE} or better today. Ranked best first, ${MAX_PICKS} maximum.`
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
      ? data.selection.considered != null
        ? `None of ${data.selection.considered} watchlist names cleared this morning's entry gate.`
        : `Nothing cleared this morning's entry gate.`
      : picks
          .map((p, i) => {
            const reasons = 'reasons' in p && p.reasons ? p.reasons : []
            return (
              `${i + 1}. ${p.symbol} (${p.name ?? ''}) — ${p.score.toFixed(1)}/100\n` +
              `   Price ${usd(p.price)} · Market cap ${bigUsd(p.marketCap)} · P/E ${num(p.trailingPe, 1)}\n` +
              `   YoY EPS ${pct(p.yoyPct, 0)} · NTM ${pct(p.ntmPct, 0)} · CAGR 5y ${pct(p.epsCagr5yr, 0)}\n` +
              `   vs 150-day avg ${pct(p.vsSma150Pct)} · ${p.pctFromAth == null ? '' : `${pct(p.pctFromAth)} from the high`}\n` +
              `   ${reasons.length ? reasons.join('; ') : 'Cleared every entry gate.'}\n` +
              `   ${data.siteUrl}/ticker/${p.symbol}`
            )
          })
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
