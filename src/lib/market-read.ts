import type { ScoredPick } from './score'
import type { IndexCardData } from '@/market-data/indices'

/** Prose blocks carried into the email: one market-wide read, plus one line
 *  per symbol keyed by ticker.
 *
 *  This shape predates the module — it was previously produced by a Claude
 *  call and validated by a grounding guard that checked every figure in the
 *  generated prose against the scored payload. That call has been removed.
 *  Everything below composes the same two fields directly from the numbers
 *  already on `ScoredPick` and `IndexCardData`, which makes the grounding
 *  problem structural rather than checked: a figure that is never generated
 *  cannot be fabricated. Keeping the interface identical is deliberate —
 *  storage (`screener_digest_prep.market_read` / `.per_stock`), the digest
 *  route, and both email templates consume it unchanged. */
export interface Commentary {
  marketRead: string
  perStock: Record<string, string>
}

const isNum = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v)

/** Signed, for figures whose direction is the point (index performance). */
function signed(pct: number, dp = 1): string {
  return `${pct >= 0 ? '+' : '-'}${Math.abs(pct).toFixed(dp)}%`
}

/** Unsigned, for figures whose direction is carried by the surrounding words
 *  ("4.2% below its 150-day average") — a signed value there would read as a
 *  double negative. */
function mag(pct: number, dp = 1): string {
  return `${Math.abs(pct).toFixed(dp)}%`
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

/** "a", "a and b", "a, b and c" — no serial comma, matching the rest of the
 *  email copy. */
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** The same 0.5–0.618 band the `golden` factor scores at full weight. Read
 *  from `retracement`, which is a 0–1 ratio (the factor's own detail string
 *  multiplies it by 100 for display). */
const GOLDEN_LOW = 0.5
const GOLDEN_HIGH = 0.618

function inGoldenZone(p: ScoredPick): boolean {
  return isNum(p.retracement) && p.retracement >= GOLDEN_LOW && p.retracement <= GOLDEN_HIGH
}

/** `positionPct` is 0–100 up the regression channel — 0 is the lower rail.
 *  Thirds rather than a raw percentage: the channel is a rough read, and
 *  "31% up the channel" implies a precision the fit does not carry. The
 *  metrics grid still shows the exact figure. */
function channelBand(positionPct: number): string {
  if (positionPct <= 33) return 'the lower third'
  if (positionPct <= 66) return 'the middle'
  return 'the upper third'
}

/** Index performance. `IndexCardData` carries YTD, not a daily change, so
 *  this says year to date — labelling it anything else would misdescribe the
 *  number. Indices whose YTD never resolved are dropped rather than shown as
 *  flat. */
function indexSentence(indices: IndexCardData[]): string | null {
  const live = indices.filter((i) => isNum(i.ytdPct))
  if (live.length === 0) return null
  return `${joinList(live.map((i) => `${i.name} ${signed(i.ytdPct as number)}`))} year to date.`
}

function cohortSentence(picks: ScoredPick[]): string {
  const scores = picks.map((p) => p.score)
  const lo = Math.round(Math.min(...scores))
  const hi = Math.round(Math.max(...scores))
  if (picks.length === 1) return `One name cleared every gate today, scoring ${hi}.`
  const range = lo === hi ? `all scoring ${hi}` : `scoring ${lo} to ${hi}`
  return `${picks.length} names cleared every gate today, ${range}.`
}

/** Where the cohort is standing, as counts rather than adjectives. Each
 *  clause is emitted only when the field backing it is present on at least
 *  one pick, so a day with no channel fits simply says less. */
function postureSentence(picks: ScoredPick[]): string | null {
  const clauses: string[] = []

  const withSma = picks.filter((p) => isNum(p.vsSma150Pct))
  if (withSma.length > 0) {
    const below = withSma.filter((p) => (p.vsSma150Pct as number) < 0).length
    clauses.push(
      below === withSma.length
        ? `all ${below} trade below their 150-day average`
        : `${below} of ${withSma.length} trade below their 150-day average`,
    )
  }

  const golden = picks.filter(inGoldenZone).length
  if (golden > 0) clauses.push(`${golden} ${golden === 1 ? 'sits' : 'sit'} in the golden zone`)

  const drawdowns = picks.map((p) => p.pctFromAth).filter(isNum)
  if (drawdowns.length > 0) {
    clauses.push(`the median drawdown from the high is ${mag(median(drawdowns))}`)
  }

  if (clauses.length === 0) return null
  const s = joinList(clauses)
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`
}

/** Growth, stated in the three figures the growth factor actually scores. */
function growthSentence(p: ScoredPick): string | null {
  const parts: string[] = []
  if (isNum(p.yoyPct)) parts.push(`${signed(p.yoyPct)} YoY`)
  if (isNum(p.ntmPct)) parts.push(`${signed(p.ntmPct)} next twelve months`)
  if (isNum(p.epsCagr5yr)) parts.push(`${signed(p.epsCagr5yr)} five-year CAGR`)
  if (parts.length === 0) return null
  return `EPS ${joinList(parts)}.`
}

/** Technical posture for one pick, composed from that pick's own readings. */
function positionSentence(p: ScoredPick): string | null {
  const parts: string[] = []

  if (isNum(p.vsSma150Pct)) {
    // A price sitting exactly on the average is the `sma` factor's
    // full-credit point, so it is a real state worth naming rather than a
    // rounding artefact — and "0.0% above its 150-day average" reads as a
    // formatting bug.
    parts.push(
      p.vsSma150Pct === 0
        ? 'in line with its 150-day average'
        : p.vsSma150Pct < 0
          ? `${mag(p.vsSma150Pct)} below its 150-day average`
          : `${mag(p.vsSma150Pct)} above its 150-day average`,
    )
  }
  if (isNum(p.positionPct)) {
    parts.push(`${channelBand(p.positionPct)} of its regression channel`)
  }
  if (isNum(p.pctFromAth)) {
    parts.push(`${mag(p.pctFromAth)} off its high`)
  }

  if (parts.length === 0) return null
  const s = joinList(parts)
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`
}

function stockLine(p: ScoredPick): string | null {
  const sentences = [positionSentence(p), growthSentence(p)].filter(
    (s): s is string => s != null,
  )
  if (inGoldenZone(p) && isNum(p.retracement)) {
    sentences.push(`Holding the golden zone at ${(p.retracement * 100).toFixed(1)}% retracement.`)
  }
  if (sentences.length === 0) return null
  return sentences.join(' ')
}

/** Composes the day's market read and per-stock lines from data already
 *  computed. Synchronous and total: no network, no key, no failure path —
 *  the only null it returns is for an empty pick list, which is the same
 *  signal the caller already handles (nothing scored today means there is
 *  nothing to read).
 *
 *  A pick contributes no per-stock entry when every field its line would be
 *  built from is null; the templates already treat a missing entry as "no
 *  line for this symbol", so a partial map is a supported state, not a gap. */
export function buildMarketRead(
  picks: ScoredPick[],
  indices: IndexCardData[],
): Commentary | null {
  if (picks.length === 0) return null

  const marketRead = [indexSentence(indices), cohortSentence(picks), postureSentence(picks)]
    .filter((s): s is string => s != null)
    .join(' ')

  const perStock: Record<string, string> = {}
  for (const p of picks) {
    const line = stockLine(p)
    if (line) perStock[p.symbol] = line
  }

  return { marketRead, perStock }
}
