# Daily Maily v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the daily digest into a professional-grade email for expert traders — real price charts, grounded AI market and per-stock commentary, far more data per pick — shipped behind a feature flag so live subscribers are never exposed to work in progress.

**Architecture:** Vercel Hobby allows 2 crons and 60s per function, and both cron slots are used. So the work splits across the two existing crons: the 09:30 UTC ingest run *prepares* the expensive artifacts (scores, chart PNGs, one Claude call) and persists them to a new table; the 11:00 UTC digest run reads that row and sends. Every artifact is optional — missing charts fall back to the v1 CSS bars, missing commentary is omitted, a missing prep row falls back to scoring inline. The email degrades in richness, never in correctness.

**Tech Stack:** Next.js 15, TypeScript, Supabase (Postgres + Storage), `@napi-rs/canvas` for PNG rendering, `@anthropic-ai/sdk` with `claude-opus-5`, Zod, `tsx` test harness.

**Spec:** `docs/superpowers/specs/2026-09-17-daily-maily-v2-design.md` — read it before Task 1.

## Global Constraints

- **Two new dependencies only:** `@napi-rs/canvas` and `@anthropic-ai/sdk`. Nothing else. The email markup stays hand-written.
- **Email markup rules are unchanged from v1** and non-negotiable: nested tables, inline CSS on every element, fixed 600px, light palette, no flexbox, no grid, no `<svg>`, no `<script>`, no web fonts. Escape every interpolated string. Emoji icons, never image sprites.
- **`src/lib/derive.ts`, `src/lib/technicals.ts`, `src/lib/score.ts`, `src/lib/ai/prompt.ts` and both email renderers stay PURE** — no I/O, no React, no `next/*`, no `Date`, no randomness.
- **The scoring model must not move.** Widening `ScoreInput` adds carried context only. The existing "perfect input scores exactly 100" assertion plus a new invariance assertion are the guards.
- **Nothing throws into the cron.** Chart rendering, storage, and the Claude call all return `null` on failure. `sendEmails` already cannot throw; keep it that way.
- **`DIGEST_TEMPLATE` defaults to v1.** Unset must mean current behaviour, so a deploy that forgets the flag cannot change what subscribers receive.
- **Claude API rules:** model `claude-opus-5`; never send `temperature`, `top_p` or `top_k` (400 on Opus 5); use `output_config` for effort and format; use `client.messages.parse()` with a Zod schema.
- Tests live in `scripts/test-signals.ts` using its existing `eq()`/`approx()` helpers. `pnpm typecheck`, `pnpm test` and `pnpm build` gate every commit.
- Commit messages: plain imperative sentence case, no Conventional Commits prefix.

---

## File Structure

**Create:** `src/lib/chart/render.ts` (PNG drawing, pure given bars), `src/lib/chart/store.ts` (Storage I/O), `src/lib/ai/prompt.ts` (payload + system prompt, pure), `src/lib/ai/commentary.ts` (the Claude call), `src/lib/email/primitives-v2.ts`, `src/lib/email/render-v2.ts`, `scripts/preview-digest-v2.ts`, `supabase/migrations/0030_digest_prep.sql`.

**Modify:** `src/lib/derive.ts`, `src/lib/technicals.ts`, `src/lib/score.ts`, `src/lib/digest.ts`, `src/app/api/ingest/route.ts`, `src/app/api/digest/route.ts`, `src/lib/email/render.ts`, `scripts/test-signals.ts`, `package.json`, `.env.example`, `README.md`.

**Dependency order.** Task 1 and Task 4 are independent and may be batched. Task 2 needs 1. Task 3 is independent (dispatch early — it carries the deployment risk). Task 5 needs 2. Task 6 needs 3, 4, 5. Task 7 needs 6. Tasks 8–9 need 2 and 5. Task 10 needs everything.

---

### Task 1: Derived momentum, range and earnings readings

**Files:** Modify `src/lib/derive.ts`, `src/lib/technicals.ts`; Test `scripts/test-signals.ts`

**Interfaces produced:**
- `export function priceChangePct(bars: Bar[], lookback: number): number | null`
- `export function fiftyTwoWeekRange(bars: Bar[]): { high: number; low: number; pctFromHigh: number; pctFromLow: number } | null`
- `export function epsSurprisePct(actual: number | null, estimate: number | null): number | null`
- `Technicals.fullRange: { high: number; low: number; pctFromHigh: number; pctFromLow: number } | null`

- [ ] **Step 1: Write the failing tests**

Add to `scripts/test-signals.ts` before the `// ── Result ───` section, and extend the existing `../src/lib/derive` import:

```ts
  // ── Derivations: momentum, range, surprise ───────────────────────
  console.log('\nDerivations — momentum and range')
  // closes 100..109 over 10 bars
  const mBars = Array.from({ length: 10 }, (_, i) => ({ t: i, o: 0, h: 0, l: 0, c: 100 + i }))
  approx(priceChangePct(mBars, 1), 100 / 108 * 1, 0.01, 'priceChangePct(1): 109 vs 108 ≈ +0.93%')
  approx(priceChangePct(mBars, 5), (109 / 104 - 1) * 100, 1e-9, 'priceChangePct(5): 109 vs 104')
  eq(priceChangePct(mBars, 20), null, 'priceChangePct: lookback beyond history returns null')
  eq(priceChangePct([], 1), null, 'priceChangePct: empty series returns null')

  const rBars = [
    { t: 0, o: 0, h: 120, l: 80, c: 100 },
    { t: 1, o: 0, h: 150, l: 95, c: 140 },
    { t: 2, o: 0, h: 130, l: 60, c: 75 },
  ]
  const r52 = fiftyTwoWeekRange(rBars)
  approx(r52?.high ?? null, 150, 1e-9, 'fiftyTwoWeekRange: high is the max of highs')
  approx(r52?.low ?? null, 60, 1e-9, 'fiftyTwoWeekRange: low is the min of lows')
  approx(r52?.pctFromHigh ?? null, (75 / 150 - 1) * 100, 1e-9, 'fiftyTwoWeekRange: last close vs high')
  approx(r52?.pctFromLow ?? null, (75 / 60 - 1) * 100, 1e-9, 'fiftyTwoWeekRange: last close vs low')
  eq(fiftyTwoWeekRange([]), null, 'fiftyTwoWeekRange: empty series returns null')

  approx(epsSurprisePct(1.2, 1.0), 20, 1e-9, 'epsSurprisePct: 1.20 actual vs 1.00 estimate = +20%')
  approx(epsSurprisePct(0.8, 1.0), -20, 1e-9, 'epsSurprisePct: a miss is negative')
  eq(epsSurprisePct(1.2, 0), null, 'epsSurprisePct: zero estimate returns null, not Infinity')
  eq(epsSurprisePct(null, 1.0), null, 'epsSurprisePct: missing actual returns null')

  // analyze() surfaces the full-series range so nothing re-walks the bars
  const rangeTech = analyze(rBars)
  approx(rangeTech.fullRange?.high ?? null, 150, 1e-9, 'analyze: fullRange.high')
  eq(analyze([]).fullRange, null, 'analyze([]): fullRange is null')
```

- [ ] **Step 2: Run to verify failure** — `pnpm test`. Expected: unresolved imports.

- [ ] **Step 3: Add the helpers to `src/lib/derive.ts`**

```ts
import type { Bar } from '@/market-data/provider'

/** Percent change of the close over `lookback` trading days. Null when the
 *  series is too short — a shorter-than-requested window would silently
 *  report a different period than the label claims. */
export function priceChangePct(bars: Bar[], lookback: number): number | null {
  if (bars.length <= lookback || lookback < 1) return null
  const now = bars[bars.length - 1].c
  const then = bars[bars.length - 1 - lookback].c
  if (!isNum(now) || !isNum(then) || then === 0) return null
  return ((now - then) / then) * 100
}

export interface PriceRange {
  high: number
  low: number
  /** Last close vs the range high, percent (≤ 0). */
  pctFromHigh: number
  /** Last close vs the range low, percent (≥ 0). */
  pctFromLow: number
}

/** High/low across the whole supplied series, with the last close's distance
 *  from each. Callers pass the FULL fetched window (276 bars ≈ 13 months),
 *  not the 126-bar visible one — a "52-week range" computed over six months
 *  would be a different statistic wearing the same label. */
export function fiftyTwoWeekRange(bars: Bar[]): PriceRange | null {
  if (bars.length === 0) return null
  let high = -Infinity
  let low = Infinity
  for (const b of bars) {
    if (b.h > high) high = b.h
    if (b.l < low) low = b.l
  }
  const close = bars[bars.length - 1].c
  if (!isNum(high) || !isNum(low) || high === 0 || low === 0) return null
  return {
    high,
    low,
    pctFromHigh: ((close - high) / high) * 100,
    pctFromLow: ((close - low) / low) * 100,
  }
}

/** Latest reported EPS against consensus, in percent. Uses the absolute
 *  estimate as the denominator so a negative-estimate quarter still reports a
 *  correctly-signed surprise rather than an inverted one. */
export function epsSurprisePct(
  actual: number | null | undefined,
  estimate: number | null | undefined,
): number | null {
  if (!isNum(actual) || !isNum(estimate) || estimate === 0) return null
  return ((actual - estimate) / Math.abs(estimate)) * 100
}
```

- [ ] **Step 4: Surface `fullRange` on `Technicals`**

In `src/lib/technicals.ts`, add to the `Technicals` interface:

```ts
  /** High/low across the FULL fetched series (not the visible window), with
   *  the last close's distance from each. Computed here so the email and the
   *  chart never re-walk 276 bars to answer the same question. */
  fullRange: PriceRange | null
```

Import `fiftyTwoWeekRange` and `type PriceRange` from `./derive`, and in `analyze()` add `fullRange: fiftyTwoWeekRange(bars)` to the returned object — note it takes `bars`, the full series, not `visible`.

- [ ] **Step 5: Verify and commit**

```bash
pnpm typecheck && pnpm test
git add src/lib/derive.ts src/lib/technicals.ts scripts/test-signals.ts
git commit -m "Add momentum, 52-week range and EPS surprise derivations"
```

---

### Task 2: Widen ScoreInput and ScoredPick without moving any score

**Files:** Modify `src/lib/score.ts`, `src/lib/digest.ts`; Test `scripts/test-signals.ts`

**Interfaces produced:** `ScoreInput` and `ScoredPick` gain the optional context fields listed below; `toDigestPickRecord` unchanged in shape.

**The one rule:** these fields are **carried, never scored**. `runGates` and `runFactors` must not read them. If a score moves, the change is wrong.

- [ ] **Step 1: Write the invariance test first**

```ts
  // ── Score invariance across the widened input ────────────────────
  console.log('\nTripleQ Score — invariance under added context')
  const widened: ScoreInput = {
    ...perfect,
    forwardPe: 22.4,
    peg5yr: 1.8,
    netMarginTtm: 0.31,
    grossMarginTtm: 0.62,
    operatingMarginTtm: 0.4,
    roiTtm: 0.27,
    epsSurprisePct: 6.2,
    change1dPct: -1.4,
    change1wPct: 2.9,
    change1mPct: 8.1,
    fullRange: { high: 150, low: 60, pctFromHigh: -12, pctFromLow: 25 },
  }
  approx(
    evaluate(widened).score,
    evaluate(perfect).score,
    1e-9,
    'invariance: adding context fields moves the score by exactly zero',
  )
  eq(
    JSON.stringify(evaluate(widened).factors.map((f) => f.points)),
    JSON.stringify(evaluate(perfect).factors.map((f) => f.points)),
    'invariance: every individual factor is unchanged',
  )
  eq(
    JSON.stringify(evaluate(widened).gates.map((g) => g.passed)),
    JSON.stringify(evaluate(perfect).gates.map((g) => g.passed)),
    'invariance: every gate verdict is unchanged',
  )
```

- [ ] **Step 2: Run to verify failure** — `pnpm test`. Expected: the new fields are not on `ScoreInput`.

- [ ] **Step 3: Widen the types**

In `src/lib/score.ts`, append to `ScoreInput`:

```ts
  // ── Carried context ───────────────────────────────────────────────
  // Everything below is passed through to the renderer and the AI payload and
  // is deliberately NOT read by runGates or runFactors. Scoring on these would
  // silently change every historical ranking, so the invariance assertions in
  // scripts/test-signals.ts exist to catch exactly that.
  forwardPe?: number | null
  peg5yr?: number | null
  netMarginTtm?: number | null
  grossMarginTtm?: number | null
  operatingMarginTtm?: number | null
  roiTtm?: number | null
  epsSurprisePct?: number | null
  /** Public URL of this pick's rendered chart, attached during preparation
   *  (Task 6). Absent means the email falls back to the v1 CSS bars. */
  chartUrl?: string | null
  change1dPct?: number | null
  change1wPct?: number | null
  change1mPct?: number | null
  fullRange?: PriceRange | null
```

Add the same fields to `ScoredPick`, and copy them through in `toPick()`. Import `type PriceRange` from `./derive`.

- [ ] **Step 4: Populate them in `src/lib/digest.ts`**

`buildSelection()` already loads `TickerData` and calls `liveTechnicals`. Extend the `ScoreInput` it builds with the carried fields: margins and ROI from `t.valuation`, `forwardPe` from `sc.fwd.forwardPe`, `peg5yr` from `t.valuation.peg5yr`, `epsSurprisePct` from the newest non-forecast EPS row's actual vs estimate, the three change percentages from `tech.visible` via `priceChangePct`, and `fullRange` from `tech.fullRange`. Guard every one — `technicals` can be null.

- [ ] **Step 5: Verify and commit**

```bash
pnpm typecheck && pnpm test && pnpm build
git add src/lib/score.ts src/lib/digest.ts scripts/test-signals.ts
git commit -m "Carry valuation, momentum and earnings context on scored picks"
```

---

### Task 3: Chart rendering and storage

**This task carries the deployment risk.** A native dependency on Vercel's serverless runtime is the least certain part of the design. Structure everything so failure is survivable, then prove it on a real deployment.

**Files:** Create `src/lib/chart/render.ts`, `src/lib/chart/store.ts`; Modify `package.json`

**Interfaces produced:**
- `export async function renderChart(input: ChartInput): Promise<Buffer | null>`
- `export async function uploadChart(date: string, symbol: string, png: Buffer): Promise<string | null>`
- `export async function pruneCharts(keepDays: number): Promise<number>`

- [ ] **Step 1: Install the dependency**

```bash
pnpm add @napi-rs/canvas
```

- [ ] **Step 2: Create `src/lib/chart/render.ts`**

Draw at 2× and let the email display at 1×, so the image is sharp on retina. Canvas is 1128×440, displayed at 564px — the usable width inside a 600px email card with 18px padding.

```ts
// Chart PNG for one pick: 126-day closes, the 150-day SMA, the regression
// channel rails, and the golden-zone band.
//
// Email clients run no JavaScript and Gmail strips inline SVG, so a real chart
// has to arrive as a raster image at a URL. This is the only module in the
// email path with a native dependency, which is why every failure mode here
// returns null instead of throwing: a chart that cannot be drawn degrades the
// email to the v1 CSS bars, and the digest still goes out.

import type { Technicals } from '@/lib/technicals'
import { GOLDEN_ZONE_HIGH, GOLDEN_ZONE_LOW } from '@/lib/technicals'

/** 2× the displayed size so the PNG is sharp on retina displays. */
const W = 1128
const H = 440
const PAD = { top: 20, right: 74, bottom: 34, left: 20 }

const COLORS = {
  bg: '#ffffff',
  grid: '#eef2f7',
  axis: '#94a3b8',
  price: '#0f172a',
  sma: '#4f46e5',
  rail: '#cbd5e1',
  golden: 'rgba(217, 119, 6, 0.13)',
  last: '#059669',
}

export interface ChartInput {
  symbol: string
  technicals: Technicals
}

export async function renderChart(input: ChartInput): Promise<Buffer | null> {
  const { technicals: t } = input
  const bars = t.visible
  if (bars.length < 2) return null

  try {
    // Imported lazily so a missing or incompatible native binary fails HERE,
    // where it is caught, rather than at module load — which would take down
    // the whole ingest route rather than just the chart.
    const { createCanvas } = await import('@napi-rs/canvas')
    const canvas = createCanvas(W, H)
    const ctx = canvas.getContext('2d')

    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, W, H)

    // ── Scales ────────────────────────────────────────────────────
    const series: number[] = bars.map((b) => b.c)
    const smas = t.sma150.filter((v): v is number => v != null)
    const rails = t.channel ? [...t.channel.upper, ...t.channel.lower] : []
    const all = [...series, ...smas, ...rails]
    let lo = Math.min(...all)
    let hi = Math.max(...all)
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) return null
    const padY = (hi - lo) * 0.08
    lo -= padY
    hi += padY

    const plotW = W - PAD.left - PAD.right
    const plotH = H - PAD.top - PAD.bottom
    const x = (i: number) => PAD.left + (i / (bars.length - 1)) * plotW
    const y = (p: number) => PAD.top + (1 - (p - lo) / (hi - lo)) * plotH

    // ── Golden-zone band ──────────────────────────────────────────
    if (t.fib) {
      const span = t.fib.high - t.fib.low
      const at = (ratio: number) =>
        t.fib!.direction === 'rally' ? t.fib!.high - span * ratio : t.fib!.low + span * ratio
      const a = y(at(GOLDEN_ZONE_LOW))
      const b = y(at(GOLDEN_ZONE_HIGH))
      ctx.fillStyle = COLORS.golden
      ctx.fillRect(PAD.left, Math.min(a, b), plotW, Math.abs(b - a))
    }

    // ── Horizontal gridlines + right-hand price axis ──────────────
    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 2
    ctx.font = '20px sans-serif'
    ctx.fillStyle = COLORS.axis
    ctx.textBaseline = 'middle'
    for (let g = 0; g <= 4; g++) {
      const price = lo + ((hi - lo) * g) / 4
      const py = y(price)
      ctx.beginPath()
      ctx.moveTo(PAD.left, py)
      ctx.lineTo(PAD.left + plotW, py)
      ctx.stroke()
      ctx.fillText(`$${price.toFixed(0)}`, PAD.left + plotW + 10, py)
    }

    // ── Channel rails ─────────────────────────────────────────────
    if (t.channel) {
      ctx.strokeStyle = COLORS.rail
      ctx.lineWidth = 2
      ctx.setLineDash([8, 8])
      for (const rail of [t.channel.upper, t.channel.lower]) {
        ctx.beginPath()
        rail.forEach((p, i) => (i === 0 ? ctx.moveTo(x(i), y(p)) : ctx.lineTo(x(i), y(p))))
        ctx.stroke()
      }
      ctx.setLineDash([])
    }

    // ── SMA 150 ───────────────────────────────────────────────────
    ctx.strokeStyle = COLORS.sma
    ctx.lineWidth = 3
    ctx.beginPath()
    let started = false
    t.sma150.forEach((v, i) => {
      if (v == null) return
      if (!started) { ctx.moveTo(x(i), y(v)); started = true } else ctx.lineTo(x(i), y(v))
    })
    if (started) ctx.stroke()

    // ── Price ─────────────────────────────────────────────────────
    ctx.strokeStyle = COLORS.price
    ctx.lineWidth = 4
    ctx.beginPath()
    series.forEach((p, i) => (i === 0 ? ctx.moveTo(x(i), y(p)) : ctx.lineTo(x(i), y(p))))
    ctx.stroke()

    // ── Last close marker ─────────────────────────────────────────
    const lastX = x(bars.length - 1)
    const lastY = y(series[series.length - 1])
    ctx.fillStyle = COLORS.last
    ctx.beginPath()
    ctx.arc(lastX, lastY, 7, 0, Math.PI * 2)
    ctx.fill()

    return canvas.toBuffer('image/png')
  } catch (e) {
    console.error(`[chart] render failed for ${input.symbol}: ${(e as Error).message}`)
    return null
  }
}
```

- [ ] **Step 3: Create `src/lib/chart/store.ts`**

```ts
// Chart PNGs live in a PUBLIC Supabase Storage bucket because mail clients
// fetch images unauthenticated — there is no way to pass a token from an
// email, and the content is a chart of public market data.

import { db } from '@/lib/db'

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'digest-charts'

/** Upload one chart and return its public URL, or null on any failure.
 *  Never throws: a chart that cannot be stored degrades the email, it does not
 *  fail the run that produced it. `upsert` is on because re-running
 *  preparation for the same day is a legitimate retry. */
export async function uploadChart(
  date: string,
  symbol: string,
  png: Buffer,
): Promise<string | null> {
  try {
    const path = `${date}/${symbol}.png`
    const supabase = db()
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, png, { contentType: 'image/png', upsert: true })
    if (error) {
      console.error(`[chart] upload failed for ${symbol}: ${error.message}`)
      return null
    }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    return data.publicUrl ?? null
  } catch (e) {
    console.error(`[chart] upload threw for ${symbol}: ${(e as Error).message}`)
    return null
  }
}

/** Delete chart folders older than `keepDays`. Returns how many objects were
 *  removed. Storage is finite and this runs daily, so without pruning the
 *  bucket grows without bound. Best-effort — a prune failure is logged. */
export async function pruneCharts(keepDays: number): Promise<number> {
  try {
    const supabase = db()
    const { data: folders, error } = await supabase.storage.from(BUCKET).list('')
    if (error || !folders) return 0
    const cutoff = new Date(Date.now() - keepDays * 86_400_000)
      .toISOString()
      .slice(0, 10)
    let removed = 0
    for (const folder of folders) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(folder.name) || folder.name >= cutoff) continue
      const { data: files } = await supabase.storage.from(BUCKET).list(folder.name)
      if (!files?.length) continue
      const paths = files.map((f) => `${folder.name}/${f.name}`)
      const { error: delErr } = await supabase.storage.from(BUCKET).remove(paths)
      if (!delErr) removed += paths.length
    }
    return removed
  } catch (e) {
    console.error(`[chart] prune failed: ${(e as Error).message}`)
    return 0
  }
}
```

- [ ] **Step 4: Prove it renders locally**

Write a throwaway script that builds a synthetic `Technicals` (150 bars of a sine-wave-plus-drift close series, an `analyze()` result over it), calls `renderChart`, and writes the PNG to `.preview/chart-test.png`. Open it and confirm: the price line, the SMA, dashed rails, and the shaded golden band are all visible and correctly scaled. Delete the script afterwards. Report what you saw — do not claim a visual check you did not perform.

- [ ] **Step 5: Verify the bundle still builds**

```bash
pnpm typecheck && pnpm build
```

Report the build output's function-size line if one appears. A native binary can push a serverless function over Vercel's size limit; catching that here is cheaper than catching it on deploy.

- [ ] **Step 6: Commit**

```bash
git add src/lib/chart package.json pnpm-lock.yaml
git commit -m "Render pick charts to PNG and store them in Supabase Storage"
```

---

### Task 4: Preparation table

**Files:** Create `supabase/migrations/0030_digest_prep.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ─── 0030: digest preparation artifacts ─────────────────────────────
-- Vercel Hobby allows 2 cron jobs and 60s per function, and both slots are
-- taken. So the expensive half of the digest — scoring, chart rendering, and
-- the one Claude call — runs in the 09:30 UTC ingest cron and lands here; the
-- 11:00 UTC digest cron reads this row and only renders and sends.
--
-- UNLIKE screener_digest_sends, this table UPSERTS on its date key. That row
-- is a send ledger where a second write would mean a second email; this one is
-- a cache of work, and re-running preparation before anything is mailed is a
-- legitimate retry that should overwrite. Idempotent, no RLS, conventions
-- follow 0026.

CREATE TABLE IF NOT EXISTS public.screener_digest_prep (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prep_on      date NOT NULL,
  picks        jsonb,
  market_read  text,
  per_stock    jsonb,
  chart_count  integer NOT NULL DEFAULT 0,
  ai_ok        boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT screener_digest_prep_day_key UNIQUE (prep_on)
);

DROP TRIGGER IF EXISTS trg_screener_digest_prep_updated ON public.screener_digest_prep;
CREATE TRIGGER trg_screener_digest_prep_updated
  BEFORE UPDATE ON public.screener_digest_prep
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

- [ ] **Step 2: Verify** — `grep -c "IF NOT EXISTS" supabase/migrations/0030_digest_prep.sql` returns `1`; every constraint is named; `set_updated_at` is referenced, not redefined.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0030_digest_prep.sql
git commit -m "Add the digest preparation table"
```

---

### Task 5: Grounded AI commentary

**Files:** Create `src/lib/ai/prompt.ts`, `src/lib/ai/commentary.ts`; Modify `package.json`; Test `scripts/test-signals.ts`

**Interfaces produced:**
- `buildPayload(picks, indices): CommentaryPayload` (pure)
- `SYSTEM_PROMPT: string`
- `numericTokens(text): string[]` and `isGrounded(text, payload): boolean` (pure)
- `generateCommentary(picks, indices): Promise<Commentary | null>`

**Read `shared/prompt-caching.md` guidance is not needed here** — this is one call a day with no shared prefix to cache.

- [ ] **Step 1: Install**

```bash
pnpm add @anthropic-ai/sdk
```

- [ ] **Step 2: Write the failing tests**

```ts
  // ── AI grounding guard ───────────────────────────────────────────
  console.log('\nAI commentary — grounding guard')
  const gPayload = buildPayload(
    [{ ...perfectPickForPrompt }],
    [{ key: 'sp500', name: 'S&P 500', ytdPct: 12.4, trailingPe: 24.1, forwardPe: 21.0 }],
  )
  eq(
    isGrounded('AAA sits at 100.0 with the S&P 500 up 12.4% this year.', gPayload),
    true,
    'grounding: prose using only supplied figures passes',
  )
  eq(
    isGrounded('AAA rallied to $412.50 on heavy volume.', gPayload),
    false,
    'grounding: an invented figure is rejected',
  )
  eq(
    isGrounded('Momentum is constructive and breadth is improving.', gPayload),
    true,
    'grounding: prose with no figures passes',
  )
  eq(
    numericTokens('up 12.4% from $100 to 109').length,
    4,
    'numericTokens: extracts every numeric token',
  )
```

Build `perfectPickForPrompt` from the existing `perfect` fixture through `evaluate()` then `toPick()`.

- [ ] **Step 3: Create `src/lib/ai/prompt.ts`**

Pure. Exports `CommentaryPayload`, `buildPayload`, `SYSTEM_PROMPT`, `numericTokens`, `isGrounded`.

`buildPayload` reduces picks and indices to a compact JSON object carrying only numbers this system computed — no prose, no derived claims. `SYSTEM_PROMPT` states the two binding rules:

```ts
export const SYSTEM_PROMPT = `You write the morning market commentary for TripleQ Group's daily stock digest. Your readers are experienced traders.

You will receive a JSON payload of figures computed by our own screening system: index readings, and for each selected stock its composite score, factor breakdown, price, valuation, technical levels and recent momentum.

Two rules bind everything you write.

First, every figure you mention must appear in the payload. You are interpreting numbers that were given to you, never sourcing new ones. If you do not have a number, write around it — do not estimate, recall, or infer one. A figure you invented would look exactly as authoritative as one we computed, and neither we nor the reader would catch it.

Second, describe what the data shows; do not tell anyone what to do. "Trading at the lower channel rail with margins expanding" is a description a trader can act on however they choose. "Buy this" is advice, and it is not yours or ours to give.

Write for someone who reads charts daily: direct, specific, no hedging filler, no exclamation. Reference the actual levels and figures rather than gesturing at them.

Return a market read of two to three sentences on where the indexes stand, and for each stock one sentence on why it scored where it did.`
```

`numericTokens(text)` extracts every numeric literal via `/\d+(?:\.\d+)?/g`. `isGrounded(text, payload)` returns false if any token in the prose is absent from the set of tokens derivable from the payload — with rounding tolerance: a payload value of `12.43` legitimises `12.4` and `12`. Document plainly in a comment that this catches an invented `$412.50`, not a misdescribed trend, and is a coarse guard rather than a proof.

- [ ] **Step 4: Create `src/lib/ai/commentary.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { buildPayload, isGrounded, SYSTEM_PROMPT } from './prompt'
import type { ScoredPick } from '@/lib/score'
import type { IndexCardData } from '@/market-data/indices'

const CommentarySchema = z.object({
  marketRead: z.string(),
  perStock: z.array(z.object({ symbol: z.string(), read: z.string() })),
})

export interface Commentary {
  marketRead: string
  perStock: Record<string, string>
}

/** One grounded Claude call per day.
 *
 *  Returns null on ANY failure — missing key, API error, schema mismatch, or a
 *  grounding violation. The digest omits the commentary blocks and still goes
 *  out; nothing here may fail the email.
 *
 *  effort is 'low' deliberately: this is interpretation over numbers we have
 *  already computed, not a reasoning problem, and the call has to fit inside
 *  the ingest route's preparation budget. Sampling parameters are not sent —
 *  Opus 5 rejects temperature, top_p and top_k with a 400. */
export async function generateCommentary(
  picks: ScoredPick[],
  indices: IndexCardData[],
): Promise<Commentary | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[ai] ANTHROPIC_API_KEY not set — skipping commentary')
    return null
  }
  if (picks.length === 0) return null

  try {
    const payload = buildPayload(picks, indices)
    const client = new Anthropic()
    const response = await client.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: 'low',
        format: zodOutputFormat(CommentarySchema),
      },
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    })

    if (response.stop_reason === 'refusal') {
      console.error('[ai] commentary refused')
      return null
    }
    const parsed = response.parsed_output
    if (!parsed) return null

    // Grounding check across every string the model produced. One violation
    // drops the whole commentary rather than shipping a mix — a reader cannot
    // tell which sentences were checked.
    const all = [parsed.marketRead, ...parsed.perStock.map((p) => p.read)]
    for (const text of all) {
      if (!isGrounded(text, payload)) {
        console.error('[ai] commentary rejected: ungrounded figure')
        return null
      }
    }

    return {
      marketRead: parsed.marketRead,
      perStock: Object.fromEntries(parsed.perStock.map((p) => [p.symbol, p.read])),
    }
  } catch (e) {
    console.error(`[ai] commentary failed: ${(e as Error).message}`)
    return null
  }
}
```

- [ ] **Step 5: Verify and commit**

```bash
pnpm typecheck && pnpm test && pnpm build
git add src/lib/ai package.json pnpm-lock.yaml scripts/test-signals.ts
git commit -m "Generate grounded market commentary with one daily Claude call"
```

---

### Task 6: Preparation phase on the ingest route

**Files:** Modify `src/lib/digest.ts`, `src/app/api/ingest/route.ts`

**Interfaces produced:**
- `prepareDigest(easternDate): Promise<PrepResult>`
- `readPrep(easternDate): Promise<Prep | null>`

- [ ] **Step 1: Add `prepareDigest` and `readPrep` to `src/lib/digest.ts`**

`prepareDigest` runs in order: `buildSelection()` → render and upload a chart per pick, attaching `chartUrl` to each → `generateCommentary()` → upsert the row on `prep_on`. Each stage is independently guarded so a later failure still persists earlier success. Charts render with a concurrency ceiling of 4 (rendering is CPU-bound, unlike the I/O-bound Yahoo fan-out) and an overall deadline passed by the caller.

`readPrep` selects by `prep_on` and returns the row mapped to camelCase, or null.

- [ ] **Step 2: Call it from the ingest route**

In `src/app/api/ingest/route.ts`'s `GET`, after the existing `warmTechnicals` call:

```ts
    // Preparation runs last and is the least important part of the cron: the
    // data is already ingested and published by this point. Bounded and
    // best-effort for the same reason warming is — a preparation failure must
    // never fail an ingest that already succeeded, and the digest route falls
    // back to scoring inline when the row is absent.
    const prep = await prepareDigest(easternDate(new Date())).catch((e) => {
      console.error(`[prep] failed: ${(e as Error).message}`)
      return null
    })
```

Add `easternDate` as a shared helper — it currently lives privately in the digest route. Extract it to `src/lib/eastern.ts` and have both routes import it, so the two cannot disagree about what "today" means. Report `prep` counts in the route's JSON response.

Give preparation its own budget constant (`PREP_BUDGET_MS = 25_000`) and reduce `WARM_BUDGET_MS` to `12_000` so the two plus ingest stay inside `maxDuration`.

- [ ] **Step 3: Verify and commit**

```bash
pnpm typecheck && pnpm test && pnpm build
git add src/lib/digest.ts src/lib/eastern.ts src/app/api/ingest/route.ts src/app/api/digest/route.ts
git commit -m "Prepare digest artifacts during the ingest cron"
```

---

### Task 7: Digest route reads the prepared row

**Files:** Modify `src/app/api/digest/route.ts`

- [ ] **Step 1: Read prep, fall back inline**

After the day claim and before rendering:

```ts
    // Normal path: the ingest cron prepared everything 90 minutes ago.
    // Fallback: preparation never ran or is stale, so score inline exactly as
    // v1 did — no charts, no commentary, but the digest still goes out.
    const prep = await readPrep(today).catch(() => null)
    const selection = prep?.picks
      ? { picks: prep.picks, considered: prep.considered, belowCutoff: prep.belowCutoff }
      : await buildSelection()
    const commentary = prep?.marketRead
      ? { marketRead: prep.marketRead, perStock: prep.perStock ?? {} }
      : null
```

Pass `commentary` through to `renderDigest`. Log which path was taken — a silent permanent fallback would mean charts and commentary never appear and nobody would know why.

Everything else in the route — clock guard, `RESEND_API_KEY` check, claim, release-on-failure, `?now=1`, `?status=1`, `?force=1` — is unchanged. Extend `?status=1` to report whether a prep row exists for today and what it contains.

- [ ] **Step 2: Verify and commit**

```bash
pnpm typecheck && pnpm test && pnpm build
git add src/app/api/digest/route.ts
git commit -m "Send from prepared artifacts, falling back to inline scoring"
```

---

### Task 8: The v2 email template

**Before writing any markup, load the `dataviz` skill** for the metrics grid and meter treatment.

**Files:** Create `src/lib/email/primitives-v2.ts`, `src/lib/email/render-v2.ts`

Every v1 markup constraint applies unchanged. Reuse `escapeHtml`, `PALETTE`, `FONT` and `shell` from `primitives.ts` rather than duplicating them; `primitives-v2.ts` adds only what is new: the index strip, the four-block metrics grid, the technical-levels table, and the commentary panel.

`renderDigestV2(data)` takes the same `DigestData` as v1 plus `commentary: Commentary | null`, and returns `{ subject, html, text }`. Structure follows spec §7. The chart is `<img src="{chartUrl}" width="564" alt="{symbol} 126-day price chart">` inside its own table row, and the whole `<tr>` is omitted when `chartUrl` is absent — falling back to the v1 bars rather than leaving a broken image.

Every colour pair must clear WCAG AA 4.5:1. Compute each ratio and report it.

- [ ] **Verify and commit**

```bash
pnpm typecheck && pnpm build
git add src/lib/email/primitives-v2.ts src/lib/email/render-v2.ts
git commit -m "Add the v2 email template"
```

---

### Task 9: Feature flag, preview script and renderer tests

**Files:** Modify `src/lib/email/render.ts`, `package.json`, `scripts/test-signals.ts`; Create `scripts/preview-digest-v2.ts`

- [ ] **Step 1: Dispatch on the flag**

`renderDigest()` keeps its signature and dispatches internally:

```ts
/** v1 unless DIGEST_TEMPLATE is exactly 'v2'. The default is deliberate: a
 *  deploy that forgets the flag must not change what subscribers receive. */
export function renderDigest(data: DigestData): RenderedEmail {
  return (process.env.DIGEST_TEMPLATE || 'v1').trim().toLowerCase() === 'v2'
    ? renderDigestV2(data)
    : renderDigestV1(data)
}
```

Rename the existing body to `renderDigestV1`. No caller changes.

- [ ] **Step 2: Preview script and tests**

`scripts/preview-digest-v2.ts` renders v2 to `.preview/digest-v2.html` with fixture picks, a real rendered chart written alongside and referenced by relative path, and fixture commentary — plus a second file with `commentary: null` and no chart URLs, proving the degraded path.

Extend the renderer tests to cover v2: an XSS payload through `renderDigestV2` produces no `<script`; a pick with no `chartUrl` emits no `<img`; ungrounded commentary never reaches the template because `generateCommentary` returns null; and the v2 output contains no `<svg`, `display:flex` or `display:grid`.

- [ ] **Step 3: Verify and commit**

```bash
pnpm typecheck && pnpm test && pnpm preview:digest:v2
git add src/lib/email/render.ts scripts/preview-digest-v2.ts package.json scripts/test-signals.ts
git commit -m "Select the email template by flag, defaulting to v1"
```

---

### Task 10: Environment, docs and deployment verification

**Files:** Modify `.env.example`, `README.md`

- [ ] **Step 1: Document the new vars** — `ANTHROPIC_API_KEY`, `DIGEST_TEMPLATE`, `SUPABASE_STORAGE_BUCKET`, each with what happens when unset.

- [ ] **Step 2: README** — a `## Daily Maily v2` section covering the two-phase pipeline and *why* it is two-phase (the Hobby 2-cron and 60s limits), the degradation ladder, the public bucket and how to create it, the AI grounding rules, and the rollout sequence from spec §12.

- [ ] **Step 3: Report the manual steps** — apply `0030_digest_prep.sql`; create the public `digest-charts` bucket; set `ANTHROPIC_API_KEY` in Vercel; leave `DIGEST_TEMPLATE` unset until review passes.

- [ ] **Step 4: Commit**

```bash
git add .env.example README.md
git commit -m "Document the v2 pipeline, bucket setup and rollout"
```

---

## Self-Review

**Spec coverage.** §1 two-phase architecture → Tasks 6, 7. §3.1 derivations → Task 1. §3.2 widened input → Task 2. §4 charts → Task 3. §5 AI → Task 5. §6 prep table and phase → Tasks 4, 6. §7 email → Task 8. §8 flag → Task 9. §9 file list → the File Structure section, plus `src/lib/eastern.ts` which the spec did not name; it is introduced in Task 6 Step 2 with its rationale (both routes must agree on "today"). §10 env → Task 10. §11 testing → Tasks 1, 2, 5, 9. §12 rollout → Task 10 Step 3.

**Placeholders.** None. Tasks 8 and 10 describe structure rather than pasting complete markup, because the v2 template is design work that must follow the `dataviz` skill and reuse v1 primitives — the constraints, structure and verification are fully specified.

**Type consistency.** `PriceRange` is defined in `derive.ts` (Task 1) and imported by `technicals.ts` and `score.ts`. `Commentary` is defined in `ai/commentary.ts` (Task 5) and consumed by Tasks 7 and 8. `ScoredPick.chartUrl` is attached in Task 6 and read in Task 8 — it must be added to the type in Task 2, so Task 2's field list includes `chartUrl?: string | null`. `easternDate` moves to `src/lib/eastern.ts` in Task 6 and both routes import it from there.
