// Pure prompt-construction and grounding-verification helpers for the daily
// AI market commentary. NO I/O, no SDK import, no Date, no randomness —
// `commentary.ts` is the only module in src/lib/ai that talks to the network.
//
// `buildPayload` reduces the day's picks and index readings to a compact JSON
// object carrying only numbers this system computed — no prose, no derived
// claims. That payload is the model's entire universe of facts: it has no
// tools and no web access, so every figure it writes must trace back to a
// number in here. `isGrounded` is the (coarse) check that it did.
import type { ScoredPick } from '@/lib/score'
import type { IndexCardData } from '@/market-data/indices'

// ─── Payload shape ──────────────────────────────────────────────────
/** The subset of IndexCardData that's meaningful to hand to the model — the
 *  research-deck EPS-growth strings (`eps2026`/`eps2027`) are prose, not
 *  numbers this system computed, so they're deliberately excluded. */
export type CommentaryIndexInput = Pick<
  IndexCardData,
  'key' | 'name' | 'ytdPct' | 'trailingPe' | 'forwardPe'
>

export interface CommentaryIndex {
  key: string
  name: string
  ytdPct: number | null
  trailingPe: number | null
  forwardPe: number | null
}

export interface CommentaryFactor {
  key: string
  label: string
  points: number
  max: number
}

export interface CommentaryPick {
  symbol: string
  name: string | null
  score: number
  factors: CommentaryFactor[]
  price: number | null
  marketCap: number | null
  trailingPe: number | null
  forwardPe: number | null
  peg5yr: number | null
  vsSma150Pct: number | null
  pctFromAth: number | null
  positionPct: number | null
  retracement: number | null
  yoyPct: number | null
  ntmPct: number | null
  epsCagr5yr: number | null
  epsSurprisePct: number | null
  netMarginTtm: number | null
  grossMarginTtm: number | null
  operatingMarginTtm: number | null
  roiTtm: number | null
  change1dPct: number | null
  change1wPct: number | null
  change1mPct: number | null
  fullRange: { high: number; low: number; pctFromHigh: number; pctFromLow: number } | null
}

export interface CommentaryPayload {
  indices: CommentaryIndex[]
  picks: CommentaryPick[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Reduces picks and indices to the compact JSON payload sent as the user
 *  turn. Every field is a number (or a short identifying string — symbol,
 *  name, factor key/label) this system already computed; nothing here is
 *  prose or an interpretation. */
export function buildPayload(picks: ScoredPick[], indices: CommentaryIndexInput[]): CommentaryPayload {
  return {
    indices: indices.map((i) => ({
      key: i.key,
      name: i.name,
      ytdPct: i.ytdPct,
      trailingPe: i.trailingPe,
      forwardPe: i.forwardPe,
    })),
    picks: picks.map((p) => ({
      symbol: p.symbol,
      name: p.name,
      score: p.score,
      factors: p.factors.map((f) => ({
        key: f.key,
        label: f.label,
        points: round2(f.points),
        max: f.max,
      })),
      price: p.price,
      marketCap: p.marketCap,
      trailingPe: p.trailingPe,
      forwardPe: p.forwardPe ?? null,
      peg5yr: p.peg5yr ?? null,
      vsSma150Pct: p.vsSma150Pct,
      pctFromAth: p.pctFromAth,
      positionPct: p.positionPct,
      retracement: p.retracement,
      yoyPct: p.yoyPct,
      ntmPct: p.ntmPct,
      epsCagr5yr: p.epsCagr5yr,
      epsSurprisePct: p.epsSurprisePct ?? null,
      netMarginTtm: p.netMarginTtm ?? null,
      grossMarginTtm: p.grossMarginTtm ?? null,
      operatingMarginTtm: p.operatingMarginTtm ?? null,
      roiTtm: p.roiTtm ?? null,
      change1dPct: p.change1dPct ?? null,
      change1wPct: p.change1wPct ?? null,
      change1mPct: p.change1mPct ?? null,
      fullRange: p.fullRange ?? null,
    })),
  }
}

// ─── System prompt ──────────────────────────────────────────────────
export const SYSTEM_PROMPT = `You write the morning market commentary for TripleQ Group's daily stock digest. Your readers are experienced traders.

You will receive a JSON payload of figures computed by our own screening system: index readings, and for each selected stock its composite score, factor breakdown, price, valuation, technical levels and recent momentum.

Two rules bind everything you write.

First, every figure you mention must appear in the payload. You are interpreting numbers that were given to you, never sourcing new ones. If you do not have a number, write around it — do not estimate, recall, or infer one. A figure you invented would look exactly as authoritative as one we computed, and neither we nor the reader would catch it.

Second, describe what the data shows; do not tell anyone what to do. "Trading at the lower channel rail with margins expanding" is a description a trader can act on however they choose. "Buy this" is advice, and it is not yours or ours to give.

Write for someone who reads charts daily: direct, specific, no hedging filler, no exclamation. Reference the actual levels and figures rather than gesturing at them.

Return a market read of two to three sentences on where the indexes stand, and for each stock one sentence on why it scored where it did.`

// ─── Grounding guard ────────────────────────────────────────────────
/** Every numeric literal in `text`, as matched substrings (e.g. "12.4",
 *  "100"). Percent signs, dollar signs and other adjacent punctuation are not
 *  part of the token. */
export function numericTokens(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?/g) ?? []
}

function collectNumbers(value: unknown, out: number[]): void {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) out.push(value)
  } else if (typeof value === 'string') {
    // Numbers embedded in identifying strings — an index name like "S&P
    // 500", a symbol — are legitimately reproducible verbatim; they are not
    // figures the model computed, they're labels the payload already spells
    // out digit-for-digit.
    for (const tok of numericTokens(value)) {
      const n = Number.parseFloat(tok)
      if (Number.isFinite(n)) out.push(n)
    }
  } else if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, out)
  } else if (value != null && typeof value === 'object') {
    for (const v of Object.values(value)) collectNumbers(v, out)
  }
}

function roundTo(n: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

/** Every number derivable from the payload: numeric fields at full precision,
 *  rounded to 1 decimal, rounded to 0 decimals, and the absolute value of
 *  each of those — so a payload value of 12.43 legitimises the model writing
 *  "12.43", "12.4" or "12", and a negative reading like pctFromAth: -25
 *  legitimises a prose description of the magnitude ("25% below the high")
 *  without the sign — plus digits embedded in identifying strings (an index
 *  name like "S&P 500"), since those are labels the payload already spells
 *  out, not figures the model computed. */
function groundedNumbers(payload: CommentaryPayload): number[] {
  const raw: number[] = []
  collectNumbers(payload, raw)
  const out: number[] = []
  for (const n of raw) {
    for (const v of [n, Math.abs(n)]) {
      out.push(v, roundTo(v, 1), roundTo(v, 0))
    }
  }
  return out
}

const GROUNDING_EPSILON = 1e-9

/** Coarse grounding guard: true only if every numeric literal in `text`
 *  matches — at full precision or a supported rounding — some number
 *  actually present in `payload`.
 *
 *  This catches an invented figure like "$412.50" when no payload number is
 *  anywhere near it. It does NOT catch a misdescribed trend — text that
 *  reuses real payload numbers but attaches them to the wrong claim (calling
 *  a decline a rally, or crediting the wrong stock with the right number)
 *  passes this check untouched. It is a net for fabricated numbers, not a
 *  fact-checker for the sentence around them. */
export function isGrounded(text: string, payload: CommentaryPayload): boolean {
  const grounded = groundedNumbers(payload)
  return numericTokens(text).every((tok) => {
    const n = Number.parseFloat(tok)
    return grounded.some((g) => Math.abs(g - n) < GROUNDING_EPSILON)
  })
}
