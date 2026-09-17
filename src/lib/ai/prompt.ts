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

You may name this system's own structural windows and ratios — a 150-day average, a 52-week range, a 21-day (one-month) window, a Fibonacci level such as the 61.8% retracement — without those counting as new figures, since they describe how we compute rather than a claim about the stock; every OTHER number must still trace back to the payload.

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

// Numbers are pulled ONLY from numeric payload fields — never from digits
// embedded in strings. An earlier version pooled digits found inside
// identifying strings (index names, symbols) into the grounded set, on the
// reasoning that "S&P 500" or "Nasdaq-100" are labels the payload already
// spells out. But that pool was global and unscoped: "S&P 500" grounded a
// fabricated "$500" price on an unrelated stock, "Nasdaq-100" and "Russell
// 2000" did the same for 100 and 2000, and worst of all `factors[].label`
// values like "SMA 150 proximity" are attached to every single pick, so
// "150" was grounded every day regardless of the actual data. Round prices
// and round percentages are exactly what a hallucinating model tends to
// produce, and that pool waved all of them through.
//
// The fix strips identifying phrases OUT of the prose before tokenizing it,
// instead of admitting their digits into the pool. "The S&P 500 is up 12.4%"
// has "S&P 500" removed first, leaving " is up 12.4%" — the remaining "12.4"
// is then checked against real numeric payload values, same as any other
// figure. A fabricated "$500" on an unrelated stock is no longer grounded by
// the mere existence of an index sharing that digit string.
function collectNumbers(value: unknown, out: number[]): void {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) out.push(value)
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

/** Every number derivable from the payload's NUMERIC fields only: full
 *  precision, rounded to 1 decimal, rounded to 0 decimals, and the absolute
 *  value of each of those — so a payload value of 12.43 legitimises the
 *  model writing "12.43", "12.4" or "12", and a negative reading like
 *  pctFromAth: -25 legitimises a prose description of the magnitude ("25%
 *  below the high") without the sign. Digits embedded in strings (an index
 *  name, a symbol, a factor label) are never included here — see
 *  `identifyingStrings` / `stripIdentifyingStrings` and
 *  `STRUCTURAL_PHRASE_PATTERNS` / `stripStructuralPhrases` for how those are
 *  handled instead. */
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

/** Identifying strings from the payload — index keys/names, pick
 *  symbols/names — that are legitimately reproducible verbatim because the
 *  payload already spells them out digit-for-digit. Digits inside these
 *  (an index name like "S&P 500", a symbol like "TA-35") are not figures the
 *  model computed, so rather than admitting them into the numeric grounding
 *  pool, `isGrounded` strips the phrase itself out of the prose before
 *  tokenizing — the digits are then simply never seen.
 *
 *  Deliberately excludes `factors[].label` and `factors[].key`: those are
 *  fixed model vocabulary repeated on every single pick (e.g. "SMA 150
 *  proximity"), not payload data. Treating them as identifying strings would
 *  strip "150" out of every pick's commentary regardless of whether that
 *  pick's data has anything to do with 150 — the same universal leak this
 *  fix exists to close, just moved from the number pool to the strip list. */
function identifyingStrings(payload: CommentaryPayload): string[] {
  const strings: string[] = []
  for (const i of payload.indices) {
    if (i.key) strings.push(i.key)
    if (i.name) strings.push(i.name)
  }
  for (const p of payload.picks) {
    if (p.symbol) strings.push(p.symbol)
    if (p.name) strings.push(p.name)
  }
  // Longest first, so e.g. "Nasdaq-100" is stripped whole before any shorter
  // string that might otherwise consume part of it first.
  return [...new Set(strings)].sort((a, b) => b.length - a.length)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Removes every identifying phrase from `text`, case-insensitively, so
 *  digits that are part of a label — not a figure — never reach the
 *  tokenizer. */
function stripIdentifyingStrings(text: string, strings: string[]): string {
  let out = text
  for (const s of strings) {
    out = out.replace(new RegExp(escapeRegExp(s), 'gi'), ' ')
  }
  return out
}

// ─── Structural phrases: period names and Fib ratios, IN CONTEXT ──────
// A first version of this admitted a fixed list of "structural" numbers
// (1/5/21/52/126/150/252, the Fib ratios) into the grounded pool
// UNCONDITIONALLY, on the reasoning that "holding above its 150-day
// average" shouldn't need a payload value of 150 to pass. It worked for
// that sentence, but a bare numeric-token check has no notion of context:
// admitting 150 as a VALUE, not as part of the phrase "150-day", also
// admitted a fabricated "$150 target", a fabricated "52% gain", a
// fabricated "operating margin reached 21%" — every one of those digits
// legitimised regardless of what word (if any) followed it. Round
// single-digit and round-50 percentages are exactly the shape a
// hallucinating model tends to produce, so that version surrendered a good
// deal of the guard's purpose to buy a handful of phrasings.
//
// Same fix shape as `identifyingStrings`/`stripIdentifyingStrings` above:
// strip the phrase, don't admit the value. Each pattern below only matches
// a structural number when it is ACTUALLY USED as a period or ratio name —
// "150-day", "52-week", "61.8% retracement" — not as a bare figure. A
// matched phrase is removed from the prose entirely before tokenizing, so
// its digits are never seen; a bare "$150" or "21%" with no structural word
// attached is left untouched and checked against the payload like any other
// number, same as before this feature existed.
const STRUCTURAL_PHRASE_PATTERNS: RegExp[] = [
  // "150-day", "52-week", "21-day", "5-bar", "1-session" — the window
  // constants (CHANGE_1D_LOOKBACK/1W/1M in digest.ts; VISIBLE_BARS,
  // SMA_PERIOD, and the ~252-trading-day year in technicals.ts) named as a
  // hyphenated period, singular or plural.
  /\b(1|5|21|52|126|150|252)-(day|week|bar|session)s?\b/gi,
  // "52 week" (space, not hyphen) — the one period name common enough to
  // admit both spellings.
  /\b52[- ]week\b/gi,
  // A Fib ratio (FIB_LEVELS, technicals.ts) ONLY when a Fib word sits
  // immediately after it — "61.8% retracement", "50 fib", "38.2%
  // level" — not a bare "50%" or "61.8" with no such word nearby.
  /\b(23\.6|38\.2|50|61\.8|78\.6)\s*%?\s*(fib|fibonacci|retracement|level|zone)/gi,
]

/** Removes every structural period-name/Fib phrase from `text` — see
 *  `STRUCTURAL_PHRASE_PATTERNS`' own comment for why this strips phrases
 *  rather than admitting bare values. */
function stripStructuralPhrases(text: string): string {
  let out = text
  for (const re of STRUCTURAL_PHRASE_PATTERNS) {
    out = out.replace(re, ' ')
  }
  return out
}

const GROUNDING_EPSILON = 1e-9

/** Coarse grounding guard: true only if every numeric literal in `text` —
 *  after identifying phrases (index/company names, symbols) and structural
 *  period-name/Fib phrases ("150-day", "52-week", "61.8% retracement") are
 *  stripped out — matches, at full precision or a supported rounding, some
 *  number actually present in the payload's numeric fields.
 *
 *  This catches an invented figure like "$412.50" when no payload number is
 *  anywhere near it. It does NOT catch a misdescribed trend — text that
 *  reuses real payload numbers but attaches them to the wrong claim (calling
 *  a decline a rally, or crediting the wrong stock with the right number)
 *  passes this check untouched. It is a net for fabricated numbers, not a
 *  fact-checker for the sentence around them. */
export function isGrounded(text: string, payload: CommentaryPayload): boolean {
  const grounded = groundedNumbers(payload)
  const stripped = stripStructuralPhrases(stripIdentifyingStrings(text, identifyingStrings(payload)))
  return numericTokens(stripped).every((tok) => {
    const n = Number.parseFloat(tok)
    return grounded.some((g) => Math.abs(g - n) < GROUNDING_EPSILON)
  })
}
