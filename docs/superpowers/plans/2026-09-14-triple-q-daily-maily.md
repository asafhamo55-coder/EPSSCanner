# TripleQ Daily Maily Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a personalized, richly-designed HTML email at 06:00 America/New_York every day listing the up-to-ten watchlist stocks that clear a hard entry gate and score highest on a composite 0–100 model, with a new sidebar tab where people subscribe with first name, last name and email.

**Architecture:** A pure scoring engine (`src/lib/score.ts`) consumes data the app already loads (Supabase snapshots + live Yahoo SMA/ATH/technicals) and returns ranked picks. A pure renderer turns picks plus a subscriber into table-based HTML. A cron-guarded route (`/api/digest`) fires twice in UTC, sends only when it is 06:00 Eastern, claims the day in a uniquely-indexed row for idempotency, and delivers through a thin Resend adapter. Signup is double opt-in through a server action and two token routes.

**Tech Stack:** Next.js 15 App Router (server components + server actions), TypeScript, Supabase (service-role, no RLS), Tailwind + the vendored `src/ui` design system, `zod`, Vercel Cron, Resend REST API via `fetch` (no new npm dependency), `tsx` test harness.

**Spec:** `docs/superpowers/specs/2026-09-14-triple-q-daily-maily-design.md` — read it before Task 1. Every task below implements a numbered section of it.

## Global Constraints

- **No new npm dependencies.** Resend is called with `fetch`. Email markup is hand-written. If you think you need a package, you have misread the plan.
- **Purity boundaries match the existing codebase.** `src/lib/score.ts`, `src/lib/derive.ts`, `src/lib/email/render.ts` and the new `technicals.ts` helper do zero I/O, import no React, and are verified in `scripts/test-signals.ts`. All I/O lives in routes, actions, `src/lib/subscribers.ts` and `src/lib/email/send.ts`.
- **Tests live in `scripts/test-signals.ts`** and use its existing `eq()` / `approx()` helpers and `failures` counter. There is no test framework in this project. `pnpm test` must exit 0.
- **A missing input never scores positively.** Every gate and every factor treats `null` / `undefined` / non-finite as a failure or zero, never as a pass. This mirrors `scoreSignals()` in `src/lib/technicals.ts`.
- **Migrations are idempotent** (`IF NOT EXISTS`, `CREATE OR REPLACE`), use uuid PKs, `timestamptz NOT NULL DEFAULT now()`, the shared `public.set_updated_at()` trigger, and **no RLS** — matching `supabase/migrations/0026_screener.sql`.
- **Sender identity is exactly** `TripleQ Group <daily@tripleqgroup.com>`. **Every email is signed `TripleQ Group`.**
- **Email markup rules, non-negotiable:** nested `<table>` layout, all CSS inline on elements, fixed 600px width, light palette only, no `<style>` block relied upon, no flexbox, no grid, no `<svg>`, no `<script>`, no web fonts. Gmail strips or ignores every one of those.
- **Every user-visible surface keeps the existing disclaimer:** `Fundamental signals only — not investment advice.`
- **Commit after every task** using the repo's existing message style (lowercase-ish imperative summary line, no Conventional Commits prefix — see `git log`).
- Run `pnpm typecheck` before every commit. Run `pnpm test` before every commit from Task 1 through Task 3.

---

## File Structure

**Create**

| File | Responsibility |
|---|---|
| `src/lib/derive.ts` | Two shared derivations (`epsCagr5yr`, `pctFromAth`, `vsSma150Pct`) used by the dashboard, the scorer and the email. Pure. |
| `src/lib/score.ts` | The TripleQ Score: gates, five weighted factors, selection. Pure. |
| `src/lib/publish.ts` | The cache-invalidation helper currently private to the ingest route. |
| `src/lib/subscribers.ts` | All subscriber DB reads/writes. |
| `src/lib/email/send.ts` | `EmailSender` interface + Resend implementation + no-op fallback. |
| `src/lib/email/render.ts` | `renderDigest()` → `{ subject, html, text }`. Pure. |
| `src/lib/email/primitives.ts` | Inline-CSS building blocks (bar, meter, band, chip, card shell) shared by both renderers. Pure. |
| `src/lib/email/confirm.ts` | `renderConfirm()` → `{ subject, html, text }`. Pure. |
| `src/lib/digest.ts` | Assembles `ScoreInput[]` from `getWatchlist()` + live technicals. I/O. |
| `src/app/api/digest/route.ts` | The 06:00 ET cron target. |
| `src/app/api/subscribe/confirm/route.ts` | Token → `confirmed`. |
| `src/app/api/subscribe/unsubscribe/route.ts` | Token → `unsubscribed` (GET and POST). |
| `src/app/daily/page.tsx` | The "Daily Maily" tab. |
| `src/components/SubscribeForm.tsx` | Signup form (client). |
| `src/components/DigestPreview.tsx` | Today's picks rendered with `src/ui` (server). |
| `scripts/preview-digest.ts` | Writes the rendered email to a file for visual review. |
| `supabase/migrations/0029_subscribers.sql` | `screener_subscribers` + `screener_digest_sends`. |

**Modify**

| File | Change |
|---|---|
| `src/lib/technicals.ts` | Add `retracementRatio()`; rewrite `inGoldenZone()` to call it. |
| `src/app/api/ingest/route.ts` | Import `publish` from `src/lib/publish.ts`; move the cron to 09:30 UTC (in `vercel.json`). |
| `src/app/page.tsx` | `toRow()` uses `src/lib/derive.ts`. |
| `src/app/actions.ts` | Add `subscribeAction`. |
| `src/components/ScreenerSidebar.tsx` | Add the `Daily Maily` nav item. |
| `scripts/test-signals.ts` | Add sections for Tasks 1, 2, 3. |
| `vercel.json` | Ingest → `30 9 * * *`; add `/api/digest` at `0 10,11 * * *`. |
| `package.json` | Add `preview:digest` script. |
| `.env.example`, `README.md` | New env vars, the digest section, the scoring model table. |

**Dependency order.** Tasks 1, 2, 4, 5, 7 are independent of each other and may run in parallel. Task 3 needs 1 and 2. Task 6 needs 4. Task 8 needs 3. Task 9 needs 6 and 7. Task 10 needs 3, 8, 9. Task 11 needs 3, 5, 6, 7, 8.

---

### Task 1: `retracementRatio()` in the technicals engine

The golden-zone factor needs the *continuous* position of the close on the swing, not the boolean `inGoldenZone()` already returns. Adding the ratio and making the boolean a caller of it means the two cannot disagree.

**Files:**
- Modify: `src/lib/technicals.ts` (the `inGoldenZone` function, around line 330)
- Test: `scripts/test-signals.ts`

**Interfaces:**
- Consumes: `Fib` (already exported from `src/lib/technicals.ts`).
- Produces: `export function retracementRatio(close: number, fib: Fib | null): number | null`

**Background you need.** A `Fib` has `high`, `low` and a `direction`. On a `'rally'` the retracement levels are measured **down from the high** (`price = high - span * ratio`), so ratio 0 is the high and ratio 1 is the low. On a `'decline'` they are measured **up from the low** (`price = low + span * ratio`). `retracementRatio` is the algebraic inverse of that, so it must branch on `direction` exactly the way `computeFib()` does.

- [ ] **Step 1: Write the failing tests**

Add this block to `scripts/test-signals.ts`, immediately before the `// ── Result ───` section at the end of `main()`:

```ts
  // ── Technicals: retracementRatio ─────────────────────────────────
  console.log('\nTechnicals — retracementRatio')
  const rallyFib: Fib = {
    high: 200,
    low: 100,
    direction: 'rally',
    anchor: 'swing',
    levels: [],
  }
  // Rally: measured down from the high, so 150 is a 50% retracement.
  approx(retracementRatio(150, rallyFib), 0.5, 1e-9, 'rally: midpoint is ratio 0.5')
  approx(retracementRatio(200, rallyFib), 0, 1e-9, 'rally: the high is ratio 0')
  approx(retracementRatio(100, rallyFib), 1, 1e-9, 'rally: the low is ratio 1')
  approx(retracementRatio(138.2, rallyFib), 0.618, 1e-9, 'rally: 138.2 is the 0.618 level')

  const declineFib: Fib = {
    high: 200,
    low: 100,
    direction: 'decline',
    anchor: 'swing',
    levels: [],
  }
  // Decline: measured up from the low, so 150 is still 0.5 but 161.8 is 0.618.
  approx(retracementRatio(150, declineFib), 0.5, 1e-9, 'decline: midpoint is ratio 0.5')
  approx(retracementRatio(161.8, declineFib), 0.618, 1e-9, 'decline: 161.8 is the 0.618 level')
  eq(retracementRatio(150, null), null, 'retracementRatio: null fib returns null')
  eq(
    retracementRatio(100, { high: 100, low: 100, direction: 'rally', anchor: 'swing', levels: [] }),
    null,
    'retracementRatio: zero-span swing returns null, not a divide-by-zero',
  )

  // inGoldenZone must still agree with its documented behaviour, now that it
  // delegates: on a rally the golden band is 138.2–150, on a decline 150–161.8.
  eq(inGoldenZone(145, rallyFib), true, 'inGoldenZone: rally, 145 is inside the band')
  eq(inGoldenZone(180, rallyFib), false, 'inGoldenZone: rally, 180 is above the band')
  eq(inGoldenZone(155, declineFib), true, 'inGoldenZone: decline, 155 is inside the band')
  eq(inGoldenZone(120, declineFib), false, 'inGoldenZone: decline, 120 is below the band')
  eq(inGoldenZone(145, null), false, 'inGoldenZone: null fib is false')
```

Extend the existing `technicals` import at the top of the file to include `retracementRatio`, and add the type import:

```ts
import type { Bar } from '../src/market-data/provider'
import type { Fib } from '../src/lib/technicals'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — TypeScript/tsx errors that `retracementRatio` is not exported from `../src/lib/technicals`.

- [ ] **Step 3: Implement**

In `src/lib/technicals.ts`, replace the whole existing `inGoldenZone` function (and its doc comment) with:

```ts
/** Where `close` sits on the Fib swing, as the same 0–1 ratio the levels use:
 *  on a rally, measured DOWN from the high (0 = the high, 1 = the low); on a
 *  decline, measured UP from the low. Values outside 0–1 are returned as-is —
 *  price can trade beyond either anchor — so callers clamp if they need to.
 *  Null when there is no swing to measure against, or the swing has no span. */
export function retracementRatio(close: number, fib: Fib | null): number | null {
  if (!fib) return null
  const span = fib.high - fib.low
  if (!Number.isFinite(span) || span <= 0) return null
  return fib.direction === 'rally' ? (fib.high - close) / span : (close - fib.low) / span
}

/** Is `close` inside the golden-zone retracement band?
 *
 *  Delegates to `retracementRatio` so the boolean and the continuous reading
 *  can never drift apart. The band is expressed in ratio space, which is
 *  direction-agnostic — on a rally the higher ratio is the LOWER price, and
 *  comparing ratios rather than prices makes that asymmetry disappear. */
export function inGoldenZone(close: number, fib: Fib | null): boolean {
  const r = retracementRatio(close, fib)
  if (r == null) return false
  return r >= GOLDEN_ZONE_LOW && r <= GOLDEN_ZONE_HIGH
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS — all assertions, including the pre-existing `scoreSignals` / `analyze` ones which exercise `inGoldenZone` indirectly.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add src/lib/technicals.ts scripts/test-signals.ts
git commit -m "Add retracementRatio; inGoldenZone now delegates to it"
```

---

### Task 2: Shared derivations in `src/lib/derive.ts`

`toRow()` in `src/app/page.tsx` computes `epsCagr5yr` and `pctFromAth` inline. The scorer and the email both need them. Move the formulas to one place before a third copy exists.

**Files:**
- Create: `src/lib/derive.ts`
- Modify: `src/app/page.tsx` (the `toRow` function, lines ~24–70)
- Test: `scripts/test-signals.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export function epsCagr5yr(trailingPe: number | null, peg5yr: number | null): number | null`
  - `export function pctFromAth(price: number | null, allTimeHigh: number | null): number | null`
  - `export function vsSma150Pct(price: number | null, sma150: number | null): number | null`

- [ ] **Step 1: Write the failing tests**

Add to `scripts/test-signals.ts` before the `// ── Result ───` section:

```ts
  // ── Derivations ──────────────────────────────────────────────────
  console.log('\nDerivations')
  approx(epsCagr5yr(30, 1.5), 20, 1e-9, 'epsCagr5yr: P/E 30 ÷ PEG 1.5 = 20%')
  eq(epsCagr5yr(30, 0), null, 'epsCagr5yr: PEG of 0 returns null, not Infinity')
  eq(epsCagr5yr(null, 1.5), null, 'epsCagr5yr: missing P/E returns null')
  eq(epsCagr5yr(30, null), null, 'epsCagr5yr: missing PEG returns null')

  approx(pctFromAth(80, 100), -20, 1e-9, 'pctFromAth: 80 vs ATH 100 is -20%')
  approx(pctFromAth(100, 100), 0, 1e-9, 'pctFromAth: at the ATH is 0%')
  eq(pctFromAth(80, 0), null, 'pctFromAth: ATH of 0 returns null')
  eq(pctFromAth(null, 100), null, 'pctFromAth: missing price returns null')

  approx(vsSma150Pct(110, 100), 10, 1e-9, 'vsSma150Pct: 10% above the SMA')
  approx(vsSma150Pct(90, 100), -10, 1e-9, 'vsSma150Pct: 10% below the SMA')
  eq(vsSma150Pct(110, 0), null, 'vsSma150Pct: SMA of 0 returns null')
  eq(vsSma150Pct(110, null), null, 'vsSma150Pct: missing SMA returns null')
```

Add the import at the top of the file:

```ts
import { epsCagr5yr, pctFromAth, vsSma150Pct } from '../src/lib/derive'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — cannot resolve `../src/lib/derive`.

- [ ] **Step 3: Create `src/lib/derive.ts`**

```ts
// Derived readings shared by the dashboard table, the TripleQ scorer and the
// daily email. Each formula lived inline in exactly one component before a
// second consumer appeared; they live here now so the three surfaces cannot
// disagree about what "EPS CAGR 5yr" or "% from ATH" means.
//
// Every function returns null rather than a misleading number when an input is
// missing or would produce a division by zero — the same contract the signals
// engine follows.

function isNum(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v)
}

/** Expected 5-year EPS CAGR, in percent. Trailing P/E ÷ PEG (5-yr expected) —
 *  the algebraic inverse of how PEG is defined, so it recovers the growth rate
 *  the PEG was built from. */
export function epsCagr5yr(
  trailingPe: number | null | undefined,
  peg5yr: number | null | undefined,
): number | null {
  if (!isNum(trailingPe) || !isNum(peg5yr) || peg5yr === 0) return null
  return trailingPe / peg5yr
}

/** Percent the current price sits below its all-time high. Zero means the
 *  stock is making new highs; the value is otherwise negative. */
export function pctFromAth(
  price: number | null | undefined,
  allTimeHigh: number | null | undefined,
): number | null {
  if (!isNum(price) || !isNum(allTimeHigh) || allTimeHigh === 0) return null
  return ((price - allTimeHigh) / allTimeHigh) * 100
}

/** Percent the current price sits above (+) or below (−) its 150-day SMA. */
export function vsSma150Pct(
  price: number | null | undefined,
  sma150: number | null | undefined,
): number | null {
  if (!isNum(price) || !isNum(sma150) || sma150 === 0) return null
  return ((price - sma150) / sma150) * 100
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Point `toRow()` at the shared helpers**

In `src/app/page.tsx`, add the import:

```ts
import { epsCagr5yr as deriveEpsCagr5yr, pctFromAth as derivePctFromAth } from '@/lib/derive'
```

Replace the inline `epsCagr5yr` computation:

```ts
  // EPS CAGR (5-yr expected) = trailing P/E ÷ PEG ratio (5-yr expected).
  const peg5yr = t.valuation.peg5yr
  const epsCagr5yr = deriveEpsCagr5yr(sc.pe.trailingPe, peg5yr)
```

and replace the inline `pctFromAth` computation:

```ts
  // % distance from the all-time high — price is at/below the ATH, so this is
  // ≤ 0 (0 = making new highs). Null when either input is missing.
  const ath = t.valuation.allTimeHigh
  const price = t.valuation.price
  const pctFromAth = derivePctFromAth(price, ath)
```

Nothing else in `toRow()` changes; the returned object already reads these two locals.

- [ ] **Step 6: Verify the dashboard still typechecks and renders identically**

Run: `pnpm typecheck && pnpm build`
Expected: both succeed. The formulas are byte-identical to what was inline, so no number on the dashboard moves.

- [ ] **Step 7: Commit**

```bash
git add src/lib/derive.ts src/app/page.tsx scripts/test-signals.ts
git commit -m "Extract epsCagr5yr / pctFromAth / vsSma150Pct into src/lib/derive"
```

---

### Task 3: The TripleQ Score engine

The heart of the feature. Spec §2. Pure, fully tested, no I/O.

**Files:**
- Create: `src/lib/score.ts`
- Test: `scripts/test-signals.ts`

**Interfaces:**
- Consumes: `Technicals`, `Fib`, `retracementRatio` (Task 1) from `@/lib/technicals`; `epsCagr5yr`, `pctFromAth`, `vsSma150Pct` (Task 2) from `@/lib/derive`; `SignalState` from `@/lib/signals`.
- Produces: `ScoreInput`, `GateResult`, `FactorScore`, `Evaluation`, `ScoredPick`, `Selection`, `evaluate()`, `selectPicks()`, and the exported constant block (`MIN_SCORE`, `MAX_PICKS`, `MIN_MARKET_CAP`, `WEIGHTS`, …). Exact signatures are in Step 3.

**Design notes you must not deviate from.**
- A `yoyState` of `'turnaround'` carries a `null` percentage (loss→profit has no defined growth rate), so it **fails** gate 2. That is deliberate: the model ranks on growth magnitude and cannot rank a name whose magnitude is undefined.
- `positionPct` from `buildChannel()` may fall **outside** 0–100 — price can trade beyond the ±2σ rails. Clamp before scoring.
- The drawdown and golden-zone curves are piecewise-linear through explicit knots. Implement one generic `piecewise()` helper and use it for both, so the two curves are tested the same way and neither grows a bespoke branch.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/test-signals.ts` before the `// ── Result ───` section. Add the imports at the top of the file first:

```ts
import {
  evaluate,
  selectPicks,
  MAX_PICKS,
  MIN_MARKET_CAP,
  MIN_SCORE,
  WEIGHTS,
  type ScoreInput,
} from '../src/lib/score'
import type { Technicals } from '../src/lib/technicals'
```

Then the test block:

```ts
  // ── TripleQ Score ────────────────────────────────────────────────
  console.log('\nTripleQ Score — gates')

  // A synthetic Technicals with dials for every technical factor. Only the
  // fields the scorer reads are populated; the rest are inert.
  function mkTech(positionPct: number, close: number, fib: Fib | null): Technicals {
    return {
      visible: [{ t: 0, o: close, h: close, l: close, c: close }],
      sma150: [null],
      channel: { upper: [], mid: [], lower: [], slopePerDay: 0, positionPct },
      fib,
      gaps: [],
      verdict: 'fair',
      positionPct,
      signals: null,
      windowBars: 126,
    }
  }

  // A ticker that passes every gate and scores near the top: mega cap, all
  // three growth readings green, price below the ATH, sitting on its SMA, at
  // the bottom of the channel, inside the golden zone, 15% off the high.
  const perfect: ScoreInput = {
    symbol: 'AAA',
    name: 'Alpha',
    price: 100,
    marketCap: 1e12,
    trailingPe: 30,
    sma150: 100,
    // -25% from the high is the drawdown curve's full-credit point. Getting
    // this wrong is why the "scores 100" assertion below is worth having.
    allTimeHigh: 400 / 3, // 100 / 0.75 → pctFromAth = -25%
    yoyPct: 40,
    yoyState: 'pass',
    ntmPct: 40,
    ntmState: 'pass',
    epsCagr5yr: 40,
    technicals: mkTech(0, 100, { high: 200, low: 0, direction: 'rally', anchor: 'swing', levels: [] }),
  }

  const perfectEval = evaluate(perfect)
  eq(perfectEval.passedGates, true, 'gates: the perfect input passes all five')
  eq(perfectEval.gates.length, 5, 'gates: five gates are reported')
  approx(perfectEval.score, 100, 0.05, 'score: the perfect input scores 100')

  // Each gate must reject on its own.
  eq(
    evaluate({ ...perfect, marketCap: MIN_MARKET_CAP - 1 }).passedGates,
    false,
    'gate 1: market cap below $500B is rejected',
  )
  eq(
    evaluate({ ...perfect, marketCap: MIN_MARKET_CAP }).passedGates,
    true,
    'gate 1: exactly $500B passes (inclusive)',
  )
  eq(evaluate({ ...perfect, marketCap: null }).passedGates, false, 'gate 1: unknown market cap is rejected')
  eq(evaluate({ ...perfect, yoyPct: -1 }).passedGates, false, 'gate 2: negative YoY EPS is rejected')
  eq(
    evaluate({ ...perfect, yoyPct: null, yoyState: 'turnaround' }).passedGates,
    false,
    'gate 2: a turnaround has no growth rate, so it is rejected',
  )
  eq(evaluate({ ...perfect, ntmPct: 0 }).passedGates, false, 'gate 3: zero NTM growth is rejected')
  eq(evaluate({ ...perfect, ntmState: 'na' }).passedGates, false, 'gate 3: an n/a NTM reading is rejected')
  eq(evaluate({ ...perfect, epsCagr5yr: -5 }).passedGates, false, 'gate 4: negative EPS CAGR is rejected')
  eq(evaluate({ ...perfect, epsCagr5yr: null }).passedGates, false, 'gate 4: unknown EPS CAGR is rejected')
  eq(
    evaluate({ ...perfect, price: 400 / 3 }).passedGates,
    false,
    'gate 5: price at the all-time high is rejected',
  )
  eq(
    evaluate({ ...perfect, price: 150 }).passedGates,
    false,
    'gate 5: price above the all-time high is rejected',
  )
  eq(evaluate({ ...perfect, allTimeHigh: null }).passedGates, false, 'gate 5: unknown ATH is rejected')

  console.log('\nTripleQ Score — factors')
  const pointsOf = (e: ReturnType<typeof evaluate>, key: string) =>
    e.factors.find((f) => f.key === key)?.points ?? -1

  // Growth: 10 points per metric, full credit at +30%, linear below, capped above.
  approx(pointsOf(perfectEval, 'growth'), WEIGHTS.growth, 1e-6, 'growth: +40% on all three earns the full 30')
  approx(
    pointsOf(evaluate({ ...perfect, yoyPct: 15, ntmPct: 15, epsCagr5yr: 15 }), 'growth'),
    WEIGHTS.growth / 2,
    1e-6,
    'growth: +15% on all three is half credit',
  )

  // SMA proximity: peaks on the SMA, zero at ±15%.
  approx(pointsOf(perfectEval, 'sma'), WEIGHTS.sma, 1e-6, 'sma: price on the SMA earns the full 20')
  approx(
    pointsOf(evaluate({ ...perfect, sma150: 100 / 1.075 }), 'sma'),
    WEIGHTS.sma / 2,
    0.01,
    'sma: 7.5% above the SMA is half credit',
  )
  approx(
    pointsOf(evaluate({ ...perfect, sma150: 100 / 1.3 }), 'sma'),
    0,
    1e-6,
    'sma: 30% above the SMA earns nothing (clamped, never negative)',
  )
  approx(
    pointsOf(evaluate({ ...perfect, sma150: null }), 'sma'),
    0,
    1e-6,
    'sma: a missing SMA scores zero, not a free pass',
  )

  // Tunnel: bottom of the channel is full credit, top is zero, clamped outside.
  approx(pointsOf(perfectEval, 'tunnel'), WEIGHTS.tunnel, 1e-6, 'tunnel: channel floor earns the full 20')
  approx(
    pointsOf(evaluate({ ...perfect, technicals: mkTech(50, 100, perfect.technicals!.fib) }), 'tunnel'),
    WEIGHTS.tunnel / 2,
    1e-6,
    'tunnel: mid-channel is half credit',
  )
  approx(
    pointsOf(evaluate({ ...perfect, technicals: mkTech(130, 100, perfect.technicals!.fib) }), 'tunnel'),
    0,
    1e-6,
    'tunnel: above the upper rail clamps to zero, never negative',
  )
  approx(
    pointsOf(evaluate({ ...perfect, technicals: null }), 'tunnel'),
    0,
    1e-6,
    'tunnel: absent technicals score zero',
  )

  // Golden zone: full inside 0.5–0.618, tapering to zero at 0.236 / 0.786.
  const goldenAt = (ratio: number) => {
    // rally fib high 200 low 0 → close = 200 - 200*ratio
    const close = 200 - 200 * ratio
    return pointsOf(
      evaluate({
        ...perfect,
        technicals: mkTech(0, close, { high: 200, low: 0, direction: 'rally', anchor: 'swing', levels: [] }),
      }),
      'golden',
    )
  }
  approx(goldenAt(0.55), WEIGHTS.golden, 1e-6, 'golden: 0.55 retracement is full credit')
  approx(goldenAt(0.5), WEIGHTS.golden, 1e-6, 'golden: the 0.5 edge is full credit')
  approx(goldenAt(0.618), WEIGHTS.golden, 1e-6, 'golden: the 0.618 edge is full credit')
  approx(goldenAt(0.368), WEIGHTS.golden / 2, 0.01, 'golden: halfway from 0.236 to 0.5 is half credit')
  approx(goldenAt(0.236), 0, 1e-6, 'golden: the 0.236 knot is zero')
  approx(goldenAt(0.1), 0, 1e-6, 'golden: shallower than 0.236 is zero')
  approx(goldenAt(0.9), 0, 1e-6, 'golden: deeper than 0.786 is zero')

  // Drawdown: rewards a real pullback, not a broken trend.
  const ddAt = (dd: number) =>
    pointsOf(evaluate({ ...perfect, price: 100, allTimeHigh: 100 / (1 - dd / 100) }), 'drawdown')
  approx(ddAt(25), WEIGHTS.drawdown, 0.01, 'drawdown: -25% is full credit')
  approx(ddAt(30), WEIGHTS.drawdown, 0.01, 'drawdown: -30% still full credit (plateau)')
  approx(ddAt(8), WEIGHTS.drawdown * 0.4, 0.01, 'drawdown: -8% is 40% credit')
  approx(ddAt(45), 0, 0.01, 'drawdown: -45% is a broken trend, zero credit')
  approx(ddAt(60), 0, 0.01, 'drawdown: beyond -45% stays zero')

  console.log('\nTripleQ Score — selection')
  const mk = (symbol: string, over: Partial<ScoreInput>): ScoreInput => ({ ...perfect, symbol, ...over })

  // A weak-but-passing name: all gates green, but every technical factor at
  // its worst, so the score lands under the 50 cutoff.
  const weak = mk('WEAK', {
    yoyPct: 1,
    ntmPct: 1,
    epsCagr5yr: 1,
    sma150: 100 / 1.3,
    allTimeHigh: 100 / (1 - 0.6),
    technicals: mkTech(100, 100, { high: 200, low: 0, direction: 'rally', anchor: 'swing', levels: [] }),
  })
  eq(evaluate(weak).passedGates, true, 'selection: the weak name passes every gate')
  eq(evaluate(weak).score < MIN_SCORE, true, 'selection: the weak name scores under the cutoff')

  const sel = selectPicks([weak, mk('BBB', {}), mk('CCC', { marketCap: 1 })])
  eq(sel.picks.length, 1, 'selection: only the qualifying, above-cutoff name is picked')
  eq(sel.picks[0].symbol, 'BBB', 'selection: the picked name is the one that qualified')
  eq(sel.considered, 3, 'selection: reports how many were considered')
  eq(sel.gated, 1, 'selection: reports how many cleared the gates but missed the cutoff')

  // Ordering and the cap.
  const many = Array.from({ length: 14 }, (_, i) =>
    mk(`T${String(i).padStart(2, '0')}`, { yoyPct: 30 - i, ntmPct: 30 - i, epsCagr5yr: 30 - i }),
  )
  const capped = selectPicks(many)
  eq(capped.picks.length, MAX_PICKS, 'selection: never returns more than MAX_PICKS')
  eq(capped.picks[0].symbol, 'T00', 'selection: the highest score ranks first')
  eq(
    capped.picks.every((p, i, a) => i === 0 || a[i - 1].score >= p.score),
    true,
    'selection: picks are ordered by score descending',
  )

  // Ties break on symbol so two runs of the same data produce the same email.
  const tied = selectPicks([mk('ZZZ', {}), mk('AAB', {})])
  eq(tied.picks[0].symbol, 'AAB', 'selection: equal scores tie-break on symbol ascending')

  eq(selectPicks([]).picks.length, 0, 'selection: an empty watchlist yields no picks')
  eq(
    selectPicks([mk('DDD', { marketCap: 1 })]).picks.length,
    0,
    'selection: a list where nothing qualifies yields no picks',
  )
  eq(
    evaluate(perfect).reasons.length > 0,
    true,
    'reasons: a high-scoring pick explains itself',
  )
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — cannot resolve `../src/lib/score`.

- [ ] **Step 3: Create `src/lib/score.ts`**

```ts
// The TripleQ Score — which watchlist names go in the daily email, and in what
// order.
//
// Two layers, and the distinction matters:
//
//   GATES are the entry criteria. They are binary and absolute: a name that
//   fails one is not in the running no matter how well it scores elsewhere.
//   They answer "is this the kind of company we buy at all?".
//
//   FACTORS answer "and is today a good day to buy it?". They are continuous,
//   weighted, and sum to 100. A name must clear MIN_SCORE to be emailed even
//   if the list would otherwise come up short — a thin list is honest, a
//   padded one is not.
//
// Pure: no I/O, no React, no dates. Verified in scripts/test-signals.ts.

// Note: `epsCagr5yr` is NOT imported here. It is derived by the caller (see
// src/lib/digest.ts) and arrives on ScoreInput already computed, because the
// scorer must not know that the CAGR happens to come from a PEG ratio.
import { pctFromAth, vsSma150Pct } from './derive'
import { retracementRatio, type Technicals } from './technicals'
import type { SignalState } from './signals'

// ─── Tuning block — every threshold in the model lives here ─────────
/** Entry gate: mega caps only. Inclusive. */
export const MIN_MARKET_CAP = 500e9
/** A pick must score at least this to be emailed, even if that shortens the list. */
export const MIN_SCORE = 50
/** Hard cap on the list length. */
export const MAX_PICKS = 10

/** Points available per factor. Must sum to 100. */
export const WEIGHTS = {
  growth: 30,
  sma: 20,
  tunnel: 20,
  golden: 15,
  drawdown: 15,
} as const

/** Growth percentage that earns a growth sub-factor its full share. */
export const GROWTH_FULL_PCT = 30
/** Distance from the 150-day SMA (percent, either side) at which proximity scores zero. */
export const SMA_ZERO_AT_PCT = 15

/** Golden-zone credit as a function of retracement ratio. Full inside the
 *  classic 0.5–0.618 buy-the-dip band, tapering to nothing at the shallow
 *  (0.236) and deep (0.786) ends. */
export const GOLDEN_KNOTS: ReadonlyArray<readonly [number, number]> = [
  [0.236, 0],
  [0.5, 1],
  [0.618, 1],
  [0.786, 0],
]

/** Drawdown credit as a function of percent below the all-time high. A name at
 *  its high has no room and earns nothing; a genuine -25% to -30% pullback is
 *  the sweet spot; past -45% the trend is broken rather than discounted. */
export const DRAWDOWN_KNOTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [8, 0.4],
  [25, 1],
  [30, 1],
  [45, 0],
]

// ─── Types ──────────────────────────────────────────────────────────
export interface ScoreInput {
  symbol: string
  name: string | null
  price: number | null
  marketCap: number | null
  trailingPe: number | null
  sma150: number | null
  allTimeHigh: number | null
  yoyPct: number | null
  yoyState: SignalState
  ntmPct: number | null
  ntmState: SignalState
  epsCagr5yr: number | null
  technicals: Technicals | null
}

export type GateKey = 'megacap' | 'yoy' | 'ntm' | 'cagr' | 'belowAth'
export type FactorKey = 'growth' | 'sma' | 'tunnel' | 'golden' | 'drawdown'

export interface GateResult {
  key: GateKey
  label: string
  passed: boolean
  /** Human-readable value that decided it, for the preview and any debug view. */
  detail: string
}

export interface FactorScore {
  key: FactorKey
  label: string
  points: number
  max: number
  detail: string
}

export interface Evaluation {
  input: ScoreInput
  gates: GateResult[]
  passedGates: boolean
  factors: FactorScore[]
  /** 0–100, rounded to one decimal. Only meaningful when passedGates is true. */
  score: number
  reasons: string[]
}

export interface ScoredPick extends Evaluation {
  symbol: string
  name: string | null
  price: number | null
  marketCap: number | null
  trailingPe: number | null
  vsSma150Pct: number | null
  pctFromAth: number | null
  positionPct: number | null
  retracement: number | null
  yoyPct: number | null
  ntmPct: number | null
  epsCagr5yr: number | null
}

export interface Selection {
  picks: ScoredPick[]
  /** How many tickers were fed in. */
  considered: number
  /** How many cleared every gate but fell below MIN_SCORE. */
  gated: number
}

// ─── Curve helpers ──────────────────────────────────────────────────
function isNum(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v)
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Piecewise-linear interpolation through `knots` (ascending x). Outside the
 *  first and last knot the result is 0 — every curve in this model is a band
 *  with a defined domain, and "outside the band" always means no credit. */
export function piecewise(x: number, knots: ReadonlyArray<readonly [number, number]>): number {
  if (!Number.isFinite(x) || knots.length === 0) return 0
  if (x < knots[0][0] || x > knots[knots.length - 1][0]) return 0
  for (let i = 1; i < knots.length; i++) {
    const [x0, y0] = knots[i - 1]
    const [x1, y1] = knots[i]
    if (x <= x1) {
      if (x1 === x0) return y1
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
  }
  return knots[knots.length - 1][1]
}

/** Linear 0→1 credit for a growth percentage, full at GROWTH_FULL_PCT. */
function growthUnit(pct: number | null): number {
  if (!isNum(pct) || pct <= 0) return 0
  return clamp(pct / GROWTH_FULL_PCT, 0, 1)
}

function fmtPct(v: number | null, digits = 1): string {
  return isNum(v) ? `${v > 0 ? '+' : ''}${v.toFixed(digits)}%` : 'n/a'
}

// ─── Gates ──────────────────────────────────────────────────────────
/** Green means a real, positive, measurable growth rate. A 'turnaround' state
 *  carries a null percentage — loss→profit has no defined growth rate — so it
 *  is not green here. The model ranks on magnitude and cannot rank an
 *  undefined one. */
function isGreen(pct: number | null, state: SignalState): boolean {
  return state !== 'na' && isNum(pct) && pct > 0
}

export function runGates(input: ScoreInput): GateResult[] {
  const dd = pctFromAth(input.price, input.allTimeHigh)
  return [
    {
      key: 'megacap',
      label: 'Market cap ≥ $500B',
      passed: isNum(input.marketCap) && input.marketCap >= MIN_MARKET_CAP,
      detail: isNum(input.marketCap) ? `$${(input.marketCap / 1e9).toFixed(0)}B` : 'unknown',
    },
    {
      key: 'yoy',
      label: 'YoY EPS growth positive',
      passed: isGreen(input.yoyPct, input.yoyState),
      detail: fmtPct(input.yoyPct),
    },
    {
      key: 'ntm',
      label: 'NTM EPS growth positive',
      passed: isGreen(input.ntmPct, input.ntmState),
      detail: fmtPct(input.ntmPct),
    },
    {
      key: 'cagr',
      label: 'EPS CAGR 5yr expected positive',
      passed: isNum(input.epsCagr5yr) && input.epsCagr5yr > 0,
      detail: fmtPct(input.epsCagr5yr),
    },
    {
      key: 'belowAth',
      label: 'Trading below the all-time high',
      passed: isNum(dd) && dd < 0,
      detail: isNum(dd) ? `${dd.toFixed(1)}% from high` : 'unknown',
    },
  ]
}

// ─── Factors ────────────────────────────────────────────────────────
export function runFactors(input: ScoreInput): FactorScore[] {
  const tech = input.technicals
  const positionPct = tech?.channel ? tech.channel.positionPct : null
  const lastClose =
    tech && tech.visible.length > 0 ? tech.visible[tech.visible.length - 1].c : null
  const r = lastClose != null ? retracementRatio(lastClose, tech?.fib ?? null) : null
  const vsSma = vsSma150Pct(input.price, input.sma150)
  const dd = pctFromAth(input.price, input.allTimeHigh)

  // Growth — three equal sub-scores. Averaging the units keeps a single strong
  // metric from carrying two weak ones.
  const growthUnits = [
    growthUnit(input.yoyPct),
    growthUnit(input.ntmPct),
    growthUnit(input.epsCagr5yr),
  ]
  const growthPoints = (WEIGHTS.growth / 3) * growthUnits.reduce((s, u) => s + u, 0)

  const smaPoints = isNum(vsSma)
    ? WEIGHTS.sma * clamp(1 - Math.abs(vsSma) / SMA_ZERO_AT_PCT, 0, 1)
    : 0

  const tunnelPoints = isNum(positionPct)
    ? WEIGHTS.tunnel * (1 - clamp(positionPct, 0, 100) / 100)
    : 0

  const goldenPoints = isNum(r) ? WEIGHTS.golden * piecewise(r, GOLDEN_KNOTS) : 0

  const drawdownPoints = isNum(dd) ? WEIGHTS.drawdown * piecewise(Math.abs(dd), DRAWDOWN_KNOTS) : 0

  return [
    {
      key: 'growth',
      label: 'Growth engine',
      points: growthPoints,
      max: WEIGHTS.growth,
      detail: `YoY ${fmtPct(input.yoyPct, 0)} · NTM ${fmtPct(input.ntmPct, 0)} · CAGR ${fmtPct(input.epsCagr5yr, 0)}`,
    },
    {
      key: 'sma',
      label: 'SMA 150 proximity',
      points: smaPoints,
      max: WEIGHTS.sma,
      detail: isNum(vsSma) ? `${fmtPct(vsSma)} vs the 150-day average` : 'no SMA available',
    },
    {
      key: 'tunnel',
      label: 'Tunnel position',
      points: tunnelPoints,
      max: WEIGHTS.tunnel,
      detail: isNum(positionPct)
        ? `${clamp(positionPct, 0, 100).toFixed(0)}% up the regression channel`
        : 'no channel available',
    },
    {
      key: 'golden',
      label: 'Golden zone',
      points: goldenPoints,
      max: WEIGHTS.golden,
      detail: isNum(r) ? `${(r * 100).toFixed(1)}% retracement` : 'no swing anchored',
    },
    {
      key: 'drawdown',
      label: 'Room below the high',
      points: drawdownPoints,
      max: WEIGHTS.drawdown,
      detail: isNum(dd) ? `${dd.toFixed(1)}% below the all-time high` : 'no all-time high',
    },
  ]
}

// ─── Reasons ────────────────────────────────────────────────────────
/** Plain-English phrases for the factors that actually carried the score —
 *  60% of a factor's weight or better. Ordered strongest first, capped at
 *  three so the email line stays a sentence, not a paragraph. */
const REASON_TEXT: Record<FactorKey, (f: FactorScore) => string> = {
  growth: (f) => `growth is compounding on all three horizons (${f.detail})`,
  sma: (f) => `price is hugging its 150-day average (${f.detail})`,
  tunnel: (f) => `it is sitting in the lower half of its regression channel (${f.detail})`,
  golden: (f) => `the pullback is holding the golden zone (${f.detail})`,
  drawdown: (f) => `there is real room back to the high (${f.detail})`,
}

export function buildReasons(factors: FactorScore[]): string[] {
  return factors
    .filter((f) => f.max > 0 && f.points / f.max >= 0.6)
    .sort((a, b) => b.points / b.max - a.points / a.max)
    .slice(0, 3)
    .map((f) => REASON_TEXT[f.key](f))
}

// ─── Entry points ───────────────────────────────────────────────────
export function evaluate(input: ScoreInput): Evaluation {
  const gates = runGates(input)
  const factors = runFactors(input)
  const raw = factors.reduce((s, f) => s + f.points, 0)
  return {
    input,
    gates,
    passedGates: gates.every((g) => g.passed),
    factors,
    score: Math.round(raw * 10) / 10,
    reasons: buildReasons(factors),
  }
}

function toPick(e: Evaluation): ScoredPick {
  const t = e.input.technicals
  const lastClose = t && t.visible.length > 0 ? t.visible[t.visible.length - 1].c : null
  return {
    ...e,
    symbol: e.input.symbol,
    name: e.input.name,
    price: e.input.price,
    marketCap: e.input.marketCap,
    trailingPe: e.input.trailingPe,
    vsSma150Pct: vsSma150Pct(e.input.price, e.input.sma150),
    pctFromAth: pctFromAth(e.input.price, e.input.allTimeHigh),
    positionPct: t?.channel ? t.channel.positionPct : null,
    retracement: lastClose != null ? retracementRatio(lastClose, t?.fib ?? null) : null,
    yoyPct: e.input.yoyPct,
    ntmPct: e.input.ntmPct,
    epsCagr5yr: e.input.epsCagr5yr,
  }
}

/** Gate, score, cut at MIN_SCORE, rank, cap at MAX_PICKS.
 *
 *  Ties break on symbol ascending so the same data always produces the same
 *  email — a digest whose order shuffles between the preview and the send
 *  would be impossible to trust. */
export function selectPicks(inputs: ScoreInput[]): Selection {
  const passed = inputs.map(evaluate).filter((e) => e.passedGates)
  const above = passed.filter((e) => e.score >= MIN_SCORE)
  const picks = above
    .sort((a, b) => b.score - a.score || a.input.symbol.localeCompare(b.input.symbol))
    .slice(0, MAX_PICKS)
    .map(toPick)
  return {
    picks,
    considered: inputs.length,
    gated: passed.length - above.length,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS, all assertions including the `score: the perfect input scores 100` check. If that one fails, the weights do not sum to 100 or a curve's full-credit point is wrong — fix the curve, do not loosen the tolerance.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add src/lib/score.ts scripts/test-signals.ts
git commit -m "Add the TripleQ Score engine: five gates, five weighted factors"
```

---

### Task 4: Subscriber schema

Spec §3.

**Files:**
- Create: `supabase/migrations/0029_subscribers.sql`

**Interfaces:**
- Produces: tables `public.screener_subscribers` and `public.screener_digest_sends` with exactly the columns Task 6 and Task 11 read.

- [ ] **Step 1: Write the migration**

```sql
-- ─── 0029: Daily Maily subscribers ──────────────────────────────────
-- Subscribers to the 06:00 ET daily digest, plus a per-day send ledger.
--
-- Double opt-in: a row is created 'pending' and only becomes 'confirmed' when
-- the recipient clicks the link, so an address someone else typed never
-- receives mail. No RLS — all access is server-side through the service-role
-- client, matching 0026. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.screener_subscribers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL,
  first_name         text NOT NULL,
  last_name          text NOT NULL,
  status             text NOT NULL DEFAULT 'pending',
  confirm_token      text,
  unsubscribe_token  text NOT NULL,
  confirmed_at       timestamptz,
  unsubscribed_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT screener_subscribers_email_key UNIQUE (email),
  CONSTRAINT screener_subscribers_unsub_key UNIQUE (unsubscribe_token),
  CONSTRAINT screener_subscribers_confirm_key UNIQUE (confirm_token),
  CONSTRAINT screener_subscribers_status_chk
    CHECK (status IN ('pending', 'confirmed', 'unsubscribed'))
);

-- The send query's only filter, so it gets a partial index rather than a
-- full one over a column that is 'confirmed' for nearly every row that matters.
CREATE INDEX IF NOT EXISTS screener_subscribers_confirmed_idx
  ON public.screener_subscribers(email)
  WHERE status = 'confirmed';

DROP TRIGGER IF EXISTS trg_screener_subscribers_updated ON public.screener_subscribers;
CREATE TRIGGER trg_screener_subscribers_updated
  BEFORE UPDATE ON public.screener_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── screener_digest_sends ──────────────────────────────────────────
-- One row per Eastern calendar day. The UNIQUE on sent_on is the whole point:
-- the digest route inserts this row BEFORE any mail goes out, so a retried,
-- delayed or double-fired cron hits a unique violation and exits instead of
-- mailing the list twice.
CREATE TABLE IF NOT EXISTS public.screener_digest_sends (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_on          date NOT NULL,
  recipient_count  integer NOT NULL DEFAULT 0,
  pick_count       integer NOT NULL DEFAULT 0,
  picks            jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT screener_digest_sends_day_key UNIQUE (sent_on)
);
```

- [ ] **Step 2: Verify it is syntactically valid and idempotent**

There is no local Postgres in this project, so verification is by inspection plus the same read-through the other migrations got:

Run: `grep -c "IF NOT EXISTS" supabase/migrations/0029_subscribers.sql`
Expected: `3` (two tables, one index).

Confirm by eye that every `CONSTRAINT` is named (so a re-run's error message identifies itself) and that `public.set_updated_at()` is referenced, not redefined — 0026 already defines it.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0029_subscribers.sql
git commit -m "Add screener_subscribers and screener_digest_sends"
```

- [ ] **Step 4: Apply it**

Paste the file into the Supabase SQL editor for project `oyhcchumlizmhwvjjlrl` and run it. Note in the task report that this manual step is done — Tasks 6, 9 and 11 cannot be exercised against a real database until it is.

---

### Task 5: Extract the revalidation helper

`publish()` is private to `src/app/api/ingest/route.ts`. The digest route needs the identical behaviour after a fallback ingest. One definition, two callers.

**Files:**
- Create: `src/lib/publish.ts`
- Modify: `src/app/api/ingest/route.ts` (remove the local `publish`, import it instead)

**Interfaces:**
- Produces: `export function publish(symbol?: string): void`

- [ ] **Step 1: Create `src/lib/publish.ts`**

```ts
import { revalidatePath, revalidateTag } from 'next/cache'

/** Drop every cache holding stale screener numbers.
 *
 *  The dashboard is served from the CDN (ISR) and the live Yahoo fields sit in
 *  the Data Cache for 6–24h, so a fresh ingest is invisible until both are
 *  invalidated. Called by the ingest route and by the digest route's
 *  fallback ingest — shared so the two cannot invalidate different things. */
export function publish(symbol?: string): void {
  revalidateTag('yahoo-live')
  revalidatePath('/')
  if (symbol) revalidatePath(`/ticker/${symbol}`)
}
```

- [ ] **Step 2: Point the ingest route at it**

In `src/app/api/ingest/route.ts`, delete the local `publish` function and its comment block, and add to the imports:

```ts
import { publish } from '@/lib/publish'
```

Remove the now-unused `revalidatePath` / `revalidateTag` import from that file. Every existing `publish()` and `publish(result.symbol)` call site stays exactly as it is.

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm build`
Expected: both succeed, no unused-import warnings.

- [ ] **Step 4: Commit**

```bash
git add src/lib/publish.ts src/app/api/ingest/route.ts
git commit -m "Extract publish() so the digest route shares the ingest invalidation"
```

---

### Task 6: The subscriber store

Spec §7. All subscriber I/O in one module, so routes and actions stay thin.

**Files:**
- Create: `src/lib/subscribers.ts`

**Interfaces:**
- Consumes: `db()` from `@/lib/db`; the tables from Task 4.
- Produces:
  - `export interface Subscriber { id, email, firstName, lastName, status, confirmToken, unsubscribeToken }`
  - `export type UpsertResult = { outcome: 'created' | 'resent' | 'reactivated' | 'already-confirmed'; subscriber: Subscriber }`
  - `export async function upsertSubscriber(input: { email: string; firstName: string; lastName: string }): Promise<UpsertResult>`
  - `export async function confirmSubscriber(token: string): Promise<boolean>`
  - `export async function unsubscribeByToken(token: string): Promise<boolean>`
  - `export async function listConfirmed(): Promise<Subscriber[]>`
  - `export async function claimDigestDay(sentOn: string): Promise<string | null>` — returns the new row id, or `null` when the day is already claimed
  - `export async function recordDigestSend(id: string, recipientCount: number, pickCount: number, picks: unknown): Promise<void>`

- [ ] **Step 1: Create `src/lib/subscribers.ts`**

```ts
// Every read and write against screener_subscribers / screener_digest_sends.
// Routes and server actions call these and hold no Supabase knowledge of their
// own, the way src/lib/queries.ts works for the watchlist.

import { db } from './db'

export type SubscriberStatus = 'pending' | 'confirmed' | 'unsubscribed'

export interface Subscriber {
  id: string
  email: string
  firstName: string
  lastName: string
  status: SubscriberStatus
  confirmToken: string | null
  unsubscribeToken: string
}

type Row = Record<string, unknown>

function toSubscriber(r: Row): Subscriber {
  return {
    id: r.id as string,
    email: r.email as string,
    firstName: r.first_name as string,
    lastName: r.last_name as string,
    status: r.status as SubscriberStatus,
    confirmToken: (r.confirm_token as string | null) ?? null,
    unsubscribeToken: r.unsubscribe_token as string,
  }
}

/** Postgres unique-violation. Surfaced by supabase-js in `error.code`. */
const UNIQUE_VIOLATION = '23505'

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export type UpsertOutcome = 'created' | 'resent' | 'reactivated' | 'already-confirmed'
export interface UpsertResult {
  outcome: UpsertOutcome
  subscriber: Subscriber
}

/**
 * Register or re-register an address.
 *
 *   no row          → created, pending, fresh confirm token
 *   pending row     → resent, fresh confirm token (the old link may be lost)
 *   unsubscribed    → reactivated back to pending, fresh confirm token
 *   confirmed row   → already-confirmed; the row is NOT touched. Re-confirming
 *                     someone who is already on the list would let a stranger
 *                     knock them off it by submitting their address.
 *
 * The name is refreshed on every path except already-confirmed, so a typo the
 * subscriber corrects on a second attempt takes effect.
 */
export async function upsertSubscriber(input: {
  email: string
  firstName: string
  lastName: string
}): Promise<UpsertResult> {
  const supabase = db()
  const email = normalizeEmail(input.email)

  const { data: existing, error: readErr } = await supabase
    .from('screener_subscribers')
    .select('*')
    .eq('email', email)
    .maybeSingle()
  if (readErr) throw new Error(readErr.message)

  if (existing) {
    const current = toSubscriber(existing as Row)
    if (current.status === 'confirmed') {
      return { outcome: 'already-confirmed', subscriber: current }
    }
    const confirmToken = crypto.randomUUID()
    const { data, error } = await supabase
      .from('screener_subscribers')
      .update({
        first_name: input.firstName,
        last_name: input.lastName,
        status: 'pending',
        confirm_token: confirmToken,
        unsubscribed_at: null,
      })
      .eq('id', current.id)
      .select('*')
      .single()
    if (error) throw new Error(error.message)
    return {
      outcome: current.status === 'unsubscribed' ? 'reactivated' : 'resent',
      subscriber: toSubscriber(data as Row),
    }
  }

  const { data, error } = await supabase
    .from('screener_subscribers')
    .insert({
      email,
      first_name: input.firstName,
      last_name: input.lastName,
      status: 'pending',
      confirm_token: crypto.randomUUID(),
      unsubscribe_token: crypto.randomUUID(),
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return { outcome: 'created', subscriber: toSubscriber(data as Row) }
}

/** Token → confirmed. Returns false for an unknown or already-used token; the
 *  caller shows a friendly page rather than an error either way. */
export async function confirmSubscriber(token: string): Promise<boolean> {
  const supabase = db()
  const { data, error } = await supabase
    .from('screener_subscribers')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      confirm_token: null,
    })
    .eq('confirm_token', token)
    .select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

/** Token → unsubscribed. The token stays valid so a second click (Gmail's
 *  native control posts as well as gets) is a harmless no-op that still
 *  reports success. */
export async function unsubscribeByToken(token: string): Promise<boolean> {
  const supabase = db()
  const { data, error } = await supabase
    .from('screener_subscribers')
    .update({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString() })
    .eq('unsubscribe_token', token)
    .select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

export async function listConfirmed(): Promise<Subscriber[]> {
  const supabase = db()
  const { data, error } = await supabase
    .from('screener_subscribers')
    .select('*')
    .eq('status', 'confirmed')
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => toSubscriber(r as Row))
}

/**
 * Claim today's send. Inserting BEFORE any mail goes out is what makes the
 * whole pipeline idempotent: the UNIQUE on sent_on means a second invocation
 * for the same Eastern day loses the race and gets null back, so a retried or
 * double-fired cron cannot mail the list twice.
 */
export async function claimDigestDay(sentOn: string): Promise<string | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('screener_digest_sends')
    .insert({ sent_on: sentOn })
    .select('id')
    .single()
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return null
    throw new Error(error.message)
  }
  return (data as Row).id as string
}

export async function recordDigestSend(
  id: string,
  recipientCount: number,
  pickCount: number,
  picks: unknown,
): Promise<void> {
  const supabase = db()
  const { error } = await supabase
    .from('screener_digest_sends')
    .update({ recipient_count: recipientCount, pick_count: pickCount, picks })
    .eq('id', id)
  if (error) throw new Error(error.message)
}
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/subscribers.ts
git commit -m "Add the subscriber store and the digest-day claim"
```

---

### Task 7: The Resend send adapter

Spec §5. A thin interface with one implementation, shaped like `src/market-data` so a different provider is a new file rather than a rewrite. **No npm package** — Resend's REST API is one `fetch`.

**Files:**
- Create: `src/lib/email/send.ts`

**Interfaces:**
- Produces:
  - `export interface EmailMessage { to: string; subject: string; html: string; text: string; headers?: Record<string, string> }`
  - `export interface SendReport { sent: number; failed: number; errors: string[] }`
  - `export async function sendEmails(messages: EmailMessage[]): Promise<SendReport>`
  - `export const DEFAULT_FROM = 'TripleQ Group <daily@tripleqgroup.com>'`

- [ ] **Step 1: Create `src/lib/email/send.ts`**

```ts
// Outbound email. One interface, one implementation (Resend's REST API via
// fetch — no SDK, no dependency), and a no-op fallback.
//
// The no-op is load-bearing, not a convenience: without RESEND_API_KEY set,
// `pnpm dev`, `pnpm build` and any mock-mode deploy would otherwise be one
// stray cron hit away from mailing real people. Absent credentials mean
// "log what you would have sent", never "send it".

export const DEFAULT_FROM = 'TripleQ Group <daily@tripleqgroup.com>'

/** Resend accepts at most 100 messages per batch call. */
const BATCH_SIZE = 100
/** Pause between batches. Resend's default account limit is 2 requests/second;
 *  600ms keeps us comfortably under it without serialising the whole send. */
const BATCH_PAUSE_MS = 600

const ENDPOINT = 'https://api.resend.com/emails/batch'

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
  headers?: Record<string, string>
}

export interface SendReport {
  sent: number
  failed: number
  errors: string[]
}

function from(): string {
  return process.env.DIGEST_FROM || DEFAULT_FROM
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Send every message. Batches are independent: one failing batch is recorded
 * and the rest still go out, because a partial digest reaching most of the
 * list beats none of it reaching any of it.
 */
export async function sendEmails(messages: EmailMessage[]): Promise<SendReport> {
  if (messages.length === 0) return { sent: 0, failed: 0, errors: [] }

  const key = process.env.RESEND_API_KEY
  if (!key) {
    console.warn(
      `[email] RESEND_API_KEY is not set — not sending ${messages.length} message(s). ` +
        `Recipients would have been: ${messages.map((m) => m.to).join(', ')}`,
    )
    return { sent: 0, failed: 0, errors: ['RESEND_API_KEY not set — send skipped'] }
  }

  const report: SendReport = { sent: 0, failed: 0, errors: [] }
  const batches = chunk(messages, BATCH_SIZE)

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          batch.map((m) => ({
            from: from(),
            to: [m.to],
            subject: m.subject,
            html: m.html,
            text: m.text,
            ...(m.headers ? { headers: m.headers } : {}),
          })),
        ),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        report.failed += batch.length
        report.errors.push(`batch ${i + 1}: HTTP ${res.status} ${body.slice(0, 300)}`)
      } else {
        report.sent += batch.length
      }
    } catch (e) {
      report.failed += batch.length
      report.errors.push(`batch ${i + 1}: ${(e as Error).message}`)
    }
    if (i < batches.length - 1) await sleep(BATCH_PAUSE_MS)
  }

  return report
}
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/email/send.ts
git commit -m "Add the Resend send adapter with a no-op fallback"
```

---

### Task 8: The email renderer

Spec §6. The design task. **Before writing any of the bar/meter markup, load the `dataviz` skill** — the mini-charts must use a consistent, accessible palette and honest scales, and that skill is the calibration for it.

**Files:**
- Create: `src/lib/email/primitives.ts`, `src/lib/email/render.ts`, `src/lib/email/confirm.ts`, `scripts/preview-digest.ts`
- Modify: `package.json` (add the `preview:digest` script)

**Interfaces:**
- Consumes: `ScoredPick`, `Selection` from `@/lib/score` (Task 3); `bigUsd`, `usd`, `pct`, `num` from `@/lib/format`.
- Produces:
  - `src/lib/email/primitives.ts`: `PALETTE`, `escapeHtml(s)`, `bar(opts)`, `meter(opts)`, `goldenBand(opts)`, `chip(opts)`, `shell(opts)`
  - `src/lib/email/render.ts`: `export interface DigestRecipient { firstName: string; unsubscribeToken: string }`, `export interface DigestData { recipient, selection, asOfLabel, siteUrl }`, `export function renderDigest(data: DigestData): { subject: string; html: string; text: string }`
  - `src/lib/email/confirm.ts`: `export function renderConfirm(data: { firstName: string; confirmUrl: string }): { subject: string; html: string; text: string }`

**Hard requirements.**
- Nested `<table>` layout only. Every style inline on the element. Fixed 600px content width inside a 100% outer table. No `<style>` block relied on for layout, no flexbox, no grid, no `<svg>`, no `<script>`, no web fonts. Font stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`.
- **Escape every interpolated string.** Company names come from a third-party API and land inside HTML.
- Icons are **emoji characters**, never images.
- Company logos use the two URLs `WatchlistTable.tsx` already uses, in the same order: `https://assets.parqet.com/logos/symbol/{SYMBOL}?format=png`, falling back in the email to nothing (email cannot run an `onerror` handler, so pick the Parqet URL and give the `<img>` an `alt` of the symbol so a blocked image still reads correctly).
- Every email ends with the signature **TripleQ Group** and the line `Fundamental signals only — not investment advice.`

- [ ] **Step 1: Load the dataviz skill**

Invoke the `dataviz` skill and read it before writing `primitives.ts`. Use its palette guidance for the bar fills, its rules on honest scales for the bar widths, and its accessibility guidance for the text-on-fill contrast.

- [ ] **Step 2: Create `src/lib/email/primitives.ts`**

```ts
// Inline-CSS building blocks for every email this app sends.
//
// Email clients are not browsers: Gmail strips <style> blocks in some contexts,
// Outlook renders through Word, none of them run JavaScript, and Gmail drops
// inline SVG entirely. So every "chart" here is a nested table whose cells have
// background colours and percentage widths — the only charting primitive that
// renders the same everywhere.

/** Light-only palette. Email has no reliable dark-mode signal, so the design
 *  commits to light and sets every background explicitly rather than inheriting
 *  a client's default. */
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
  negative: '#dc2626',
  negativeSoft: '#fee2e2',
  gold: '#d97706',
  goldSoft: '#fef3c7',
  track: '#e2e8f0',
} as const

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
  const LOW = 0.236
  const HIGH = 0.786
  const span = HIGH - LOW
  const goldStart = ((0.5 - LOW) / span) * 100
  const goldEnd = ((0.618 - LOW) / span) * 100
  const label =
    opts.ratio == null ? 'no swing anchored' : `${(opts.ratio * 100).toFixed(1)}% retracement`
  const marker =
    opts.ratio == null ? null : clampPct(((opts.ratio - LOW) / span) * 100)
  const inZone = opts.ratio != null && opts.ratio >= 0.5 && opts.ratio <= 0.618
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px 0;">
  <tr>
    <td style="font:400 11px ${FONT};color:${PALETTE.muted};padding:0 0 3px 0;">Golden zone</td>
    <td align="right" style="font:700 11px ${FONT};color:${inZone ? PALETTE.gold : PALETTE.muted};padding:0 0 3px 0;">${inZone ? '⭐ ' : ''}${escapeHtml(label)}</td>
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
    <td style="font:400 10px ${FONT};color:${PALETTE.muted};padding:2px 0 0 0;">0.236</td>
    <td align="right" style="font:400 10px ${FONT};color:${PALETTE.muted};padding:2px 0 0 0;">0.786</td>
  </tr>
</table>`
}

/** A small pill for a green/red reading. */
export function chip(opts: { label: string; value: string; positive: boolean }): string {
  const bg = opts.positive ? PALETTE.positiveSoft : PALETTE.negativeSoft
  const fg = opts.positive ? PALETTE.positive : PALETTE.negative
  return `<td align="center" style="padding:0 4px 0 0;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${bg};border-radius:6px;">
    <tr><td align="center" style="padding:6px 4px;font:400 10px ${FONT};color:${fg};">${escapeHtml(opts.label)}<br><span style="font:700 13px ${FONT};color:${fg};">${escapeHtml(opts.value)}</span></td></tr>
  </table>
</td>`
}

/** The score meter: a number and a proportional fill, coloured by band. */
export function meter(opts: { score: number }): string {
  const w = clampPct(opts.score)
  const color = opts.score >= 80 ? PALETTE.positive : opts.score >= 65 ? PALETTE.brand : PALETTE.gold
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td style="font:400 11px ${FONT};color:${PALETTE.muted};padding:0 0 3px 0;">TripleQ Score</td>
    <td align="right" style="font:700 18px ${FONT};color:${color};padding:0 0 3px 0;">${opts.score.toFixed(1)}<span style="font:400 11px ${FONT};color:${PALETTE.muted};">/100</span></td>
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
          <td style="padding:20px 24px 8px 24px;font:400 11px ${FONT};color:${PALETTE.muted};line-height:1.6;">
            Fundamental signals only — not investment advice.<br>
            ${opts.footerLinksHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px 28px 24px;font:700 13px ${FONT};color:${PALETTE.ink};">
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
```

- [ ] **Step 3: Create `src/lib/email/render.ts`**

```ts
// The daily digest, as HTML and as plain text. Pure — everything it needs
// arrives as an argument, so scripts/preview-digest.ts renders it to a file
// without a network or a database.

import { bigUsd, num, pct, usd } from '@/lib/format'
import type { ScoredPick, Selection } from '@/lib/score'
import { MAX_PICKS, MIN_MARKET_CAP, MIN_SCORE } from '@/lib/score'
import {
  bar,
  chip,
  escapeHtml,
  FONT,
  goldenBand,
  markerBar,
  meter,
  PALETTE,
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

/** Where the "% vs SMA" marker sits on its track. ±15% maps to the full width,
 *  so the centre is the SMA itself and the scale matches the factor's domain. */
function smaMarkerPct(v: number | null): number {
  if (v == null) return 50
  return 50 + (Math.max(-15, Math.min(15, v)) / 15) * 50
}

function logoUrl(symbol: string): string {
  return `https://assets.parqet.com/logos/symbol/${encodeURIComponent(symbol)}?format=png`
}

function card(p: ScoredPick, rank: number, siteUrl: string): string {
  const href = `${siteUrl}/ticker/${encodeURIComponent(p.symbol)}`
  const reason = p.reasons.length
    ? `${p.reasons[0].charAt(0).toUpperCase()}${p.reasons[0].slice(1)}${p.reasons.length > 1 ? `, and ${p.reasons.slice(1).join(', ')}` : ''}.`
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
              <a href="${href}" style="text-decoration:none;">
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
            ${chip({ label: '📈 YoY EPS', value: pct(p.yoyPct, 0), positive: (p.yoyPct ?? 0) > 0 })}
            ${chip({ label: '🔮 NTM EPS', value: pct(p.ntmPct, 0), positive: (p.ntmPct ?? 0) > 0 })}
            ${chip({ label: '🚀 CAGR 5y', value: pct(p.epsCagr5yr, 0), positive: (p.epsCagr5yr ?? 0) > 0 })}
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
          leftCap: '−15%',
          rightCap: '+15%',
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
          fillPct: p.pctFromAth == null ? 0 : Math.min(100, (Math.abs(p.pctFromAth) / 45) * 100),
          color: PALETTE.gold,
        })}
      </td>
    </tr>
    <tr>
      <td style="padding:2px 18px 16px 18px;font:400 12px ${FONT};color:${PALETTE.body};line-height:1.6;">
        ${escapeHtml(reason)}
        <a href="${href}" style="color:${PALETTE.brand};text-decoration:none;font-weight:700;">See the chart →</a>
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
      : `${n} of ${data.selection.considered} watchlist names cleared the entry gate and scored ${MIN_SCORE} or better${data.selection.gated > 0 ? `; ${data.selection.gated} more passed the gate but fell short on score` : ''}. Ranked best first, ${MAX_PICKS} maximum.`
  }
</td></tr>`

  const body =
    header + (n === 0 ? emptyState(data.selection) : picks.map((p, i) => card(p, i + 1, data.siteUrl)).join(''))

  const footerLinks = `You are receiving this because you confirmed your subscription at ${escapeHtml(data.siteUrl)}.<br>
<a href="${unsubUrl}" style="color:${PALETTE.muted};">Unsubscribe</a>`

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
```

- [ ] **Step 4: Create `src/lib/email/confirm.ts`**

```ts
// The double opt-in confirmation email. Deliberately plain: one sentence and
// one button. Nothing about the digest's content goes out before the address
// is confirmed.

import { escapeHtml, FONT, PALETTE, shell } from './primitives'

export function renderConfirm(data: { firstName: string; confirmUrl: string }): {
  subject: string
  html: string
  text: string
} {
  const subject = 'Confirm your TripleQ Daily Maily subscription'
  const body = `
<tr><td style="padding:0 0 18px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.brandDeep};border-radius:14px;">
    <tr><td style="padding:22px 24px;font:700 19px ${FONT};color:#ffffff;">✉️ One click to go</td></tr>
  </table>
</td></tr>
<tr><td style="padding:0 2px 18px 2px;font:400 14px ${FONT};color:${PALETTE.body};line-height:1.7;">
  Hi ${escapeHtml(data.firstName)}, confirm your address and the TripleQ Daily Maily will land in
  your inbox at 6:00 AM Eastern every morning — the watchlist names that cleared our entry gate,
  ranked by the TripleQ Score.<br><br>
  <a href="${data.confirmUrl}" style="display:inline-block;background:${PALETTE.brand};color:#ffffff;font:700 14px ${FONT};text-decoration:none;padding:12px 22px;border-radius:10px;">Confirm my subscription</a><br><br>
  <span style="font:400 12px ${FONT};color:${PALETTE.muted};">If you did not request this, ignore this email — nothing will be sent.</span>
</td></tr>`
  const text = [
    `Hi ${data.firstName},`,
    ``,
    `Confirm your TripleQ Daily Maily subscription:`,
    data.confirmUrl,
    ``,
    `If you did not request this, ignore this email — nothing will be sent.`,
    ``,
    `Fundamental signals only — not investment advice.`,
    ``,
    `TripleQ Group`,
  ].join('\n')
  return {
    subject,
    html: shell({
      title: subject,
      preheader: 'Confirm your address to start receiving the 6 AM digest.',
      bodyHtml: body,
      footerLinksHtml: 'You received this because someone entered this address on our signup form.',
    }),
    text,
  }
}
```

- [ ] **Step 5: Create `scripts/preview-digest.ts`**

```ts
/**
 * scripts/preview-digest.ts
 *
 * Renders the daily email to an HTML file so the design can be reviewed in a
 * browser without sending anything or touching the network.
 *
 * Usage:
 *   pnpm preview:digest            → writes .preview/digest.html
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { renderDigest } from '../src/lib/email/render'
import { evaluate, type ScoreInput, type Selection } from '../src/lib/score'
import type { Fib, Technicals } from '../src/lib/technicals'

function mkTech(positionPct: number, close: number, fib: Fib): Technicals {
  return {
    visible: [{ t: 0, o: close, h: close, l: close, c: close }],
    sma150: [null],
    channel: { upper: [], mid: [], lower: [], slopePerDay: 0, positionPct },
    fib,
    gaps: [],
    verdict: 'opportunity',
    positionPct,
    signals: null,
    windowBars: 126,
  }
}

const FIB: Fib = { high: 200, low: 0, direction: 'rally', anchor: 'swing', levels: [] }

const FIXTURES: Array<[string, string, number, number, number, number]> = [
  // symbol, name, yoy, ntm, cagr, tunnel position
  ['NVDA', 'NVIDIA Corporation', 62, 41, 35, 8],
  ['MSFT', 'Microsoft Corporation', 18, 14, 16, 22],
  ['AVGO', 'Broadcom Inc.', 44, 27, 24, 35],
  ['META', 'Meta Platforms, Inc.', 31, 12, 19, 47],
]

const picks = FIXTURES.map(([symbol, name, yoy, ntm, cagr, pos]) => {
  const input: ScoreInput = {
    symbol,
    name,
    price: 100,
    marketCap: 1.4e12,
    trailingPe: 34.2,
    sma150: 98,
    allTimeHigh: 118,
    yoyPct: yoy,
    yoyState: 'pass',
    ntmPct: ntm,
    ntmState: 'pass',
    epsCagr5yr: cagr,
    technicals: mkTech(pos, 112, FIB),
  }
  const e = evaluate(input)
  return {
    ...e,
    symbol,
    name,
    price: input.price,
    marketCap: input.marketCap,
    trailingPe: input.trailingPe,
    vsSma150Pct: 2.04,
    pctFromAth: -15.25,
    positionPct: pos,
    retracement: 0.56,
    yoyPct: yoy,
    ntmPct: ntm,
    epsCagr5yr: cagr,
  }
})

const selection: Selection = { picks, considered: 61, gated: 3 }

const { subject, html } = renderDigest({
  recipient: { firstName: 'Asaf', unsubscribeToken: 'preview-token' },
  selection,
  asOfLabel: 'Monday, 14 September 2026',
  siteUrl: 'https://tripleqgroup.vercel.app',
})

mkdirSync('.preview', { recursive: true })
writeFileSync('.preview/digest.html', html)
console.log(`subject: ${subject}`)
console.log('wrote .preview/digest.html — open it in a browser')

// Also render the empty state, which is the easiest variant to get wrong.
const empty = renderDigest({
  recipient: { firstName: 'Asaf', unsubscribeToken: 'preview-token' },
  selection: { picks: [], considered: 61, gated: 2 },
  asOfLabel: 'Monday, 14 September 2026',
  siteUrl: 'https://tripleqgroup.vercel.app',
})
writeFileSync('.preview/digest-empty.html', empty.html)
console.log('wrote .preview/digest-empty.html')
```

Add to `package.json` scripts:

```json
    "preview:digest": "tsx scripts/preview-digest.ts",
```

Add `.preview/` to `.gitignore`.

- [ ] **Step 6: Render and review**

Run: `pnpm preview:digest`
Expected: two files written. Open `.preview/digest.html` in a browser. Check: nothing overflows 600px, every bar is visible and proportional, the golden-zone marker lands inside the highlighted segment for a 0.56 retracement, the emoji render, the footer says `TripleQ Group`.

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm typecheck
git add src/lib/email package.json .gitignore scripts/preview-digest.ts
git commit -m "Render the daily digest and confirmation emails as inline-CSS tables"
```

---

### Task 9: Signup action and the token routes

Spec §7.

**Files:**
- Modify: `src/app/actions.ts` (append `subscribeAction`)
- Create: `src/app/api/subscribe/confirm/route.ts`, `src/app/api/subscribe/unsubscribe/route.ts`

**Interfaces:**
- Consumes: `upsertSubscriber`, `confirmSubscriber`, `unsubscribeByToken` (Task 6); `sendEmails` (Task 7); `renderConfirm` (Task 8); the existing `ActionResult` in `src/app/actions.ts`.
- Produces: `export async function subscribeAction(input: { firstName: string; lastName: string; email: string }): Promise<ActionResult>`

- [ ] **Step 1: Append `subscribeAction` to `src/app/actions.ts`**

Add these imports at the top of the file:

```ts
import { z } from 'zod'
import { renderConfirm } from '@/lib/email/confirm'
import { sendEmails } from '@/lib/email/send'
import { upsertSubscriber } from '@/lib/subscribers'
import { siteUrl } from '@/lib/site'
```

and this at the end of the file:

```ts
const SubscribeInput = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name.').max(60),
  lastName: z.string().trim().min(1, 'Enter your last name.').max(60),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
})

/** Register for the daily digest. Double opt-in: this only ever creates a
 *  pending row and mails a confirmation link — nothing is added to the send
 *  list until that link is clicked.
 *
 *  The success message is identical whether the address was new or already
 *  confirmed. Differentiating them would turn this public form into an oracle
 *  that reports whether a given address is on the list. */
export async function subscribeAction(input: {
  firstName: string
  lastName: string
  email: string
}): Promise<ActionResult> {
  const parsed = SubscribeInput.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' }
  }
  try {
    const { outcome, subscriber } = await upsertSubscriber(parsed.data)
    if (outcome !== 'already-confirmed' && subscriber.confirmToken) {
      const confirmUrl = `${siteUrl()}/api/subscribe/confirm?token=${encodeURIComponent(subscriber.confirmToken)}`
      const mail = renderConfirm({ firstName: subscriber.firstName, confirmUrl })
      await sendEmails([
        { to: subscriber.email, subject: mail.subject, html: mail.html, text: mail.text },
      ])
    }
    return { ok: true, message: 'Check your inbox — confirm the link and your first digest arrives at 6 AM ET.' }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
```

- [ ] **Step 2: Create `src/lib/site.ts`**

Every absolute URL in an email needs the deployment's origin, and three call sites need it. One helper:

```ts
/** Absolute origin for links that leave the app (emails). Never has a trailing
 *  slash. `NEXT_PUBLIC_SITE_URL` is the explicit setting; `VERCEL_PROJECT_
 *  PRODUCTION_URL` is Vercel's stable production hostname, which beats
 *  `VERCEL_URL` because that one changes with every deployment and a link in a
 *  sent email must outlive the deploy that sent it. */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/+$/, '')
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (vercel) return `https://${vercel}`
  return 'http://localhost:3000'
}
```

- [ ] **Step 3: Create `src/app/api/subscribe/confirm/route.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { confirmSubscriber } from '@/lib/subscribers'
import { siteUrl } from '@/lib/site'

// Double opt-in landing. An unknown or already-used token is not an error the
// recipient can act on, so it redirects to the same page with a different flag
// rather than rendering a stack trace at someone who clicked a link twice.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.redirect(`${siteUrl()}/daily?confirmed=0`)
  try {
    const ok = await confirmSubscriber(token)
    return NextResponse.redirect(`${siteUrl()}/daily?confirmed=${ok ? '1' : '0'}`)
  } catch {
    return NextResponse.redirect(`${siteUrl()}/daily?confirmed=0`)
  }
}
```

- [ ] **Step 4: Create `src/app/api/subscribe/unsubscribe/route.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { unsubscribeByToken } from '@/lib/subscribers'
import { siteUrl } from '@/lib/site'

async function run(token: string | null): Promise<boolean> {
  if (!token) return false
  try {
    return await unsubscribeByToken(token)
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  const ok = await run(req.nextUrl.searchParams.get('token'))
  return NextResponse.redirect(`${siteUrl()}/daily?unsubscribed=${ok ? '1' : '0'}`)
}

// Gmail's native unsubscribe control POSTs rather than following the link
// (RFC 8058), and expects a plain 200 — not a redirect it cannot follow.
export async function POST(req: NextRequest) {
  await run(req.nextUrl.searchParams.get('token'))
  return new NextResponse(null, { status: 200 })
}
```

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm build`
Expected: both succeed, and the build output lists the two new routes.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions.ts src/lib/site.ts src/app/api/subscribe
git commit -m "Add double opt-in signup, confirm and unsubscribe routes"
```

---

### Task 10: The Daily Maily tab

Spec §7.

**Files:**
- Create: `src/app/daily/page.tsx`, `src/components/SubscribeForm.tsx`, `src/components/DigestPreview.tsx`, `src/lib/digest.ts`
- Modify: `src/components/ScreenerSidebar.tsx`

**Interfaces:**
- Consumes: `subscribeAction` (Task 9); `selectPicks`, `ScoreInput`, `Selection` (Task 3); `getWatchlist`, `liveTechnicals` (existing `src/lib/queries.ts`); `epsCagr5yr` (Task 2).
- Produces: `src/lib/digest.ts` → `export async function buildSelection(): Promise<Selection>`

- [ ] **Step 1: Create `src/lib/digest.ts`**

```ts
// Turns the watchlist into scored picks. The one place that knows how the
// screener's stored data maps onto ScoreInput, so the email and the preview
// page cannot rank different stocks.

import { epsCagr5yr } from './derive'
import { getWatchlist, liveTechnicals } from './queries'
import { selectPicks, type ScoreInput, type Selection } from './score'

/** Matches LIVE_FETCH_CONCURRENCY in queries.ts — same Yahoo endpoint, same
 *  ceiling, so the digest cannot be the thing that gets us rate-limited. */
const TECHNICALS_CONCURRENCY = 8

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export async function buildSelection(): Promise<Selection> {
  const watchlist = await getWatchlist()
  const inputs: ScoreInput[] = await mapLimit(watchlist, TECHNICALS_CONCURRENCY, async (t) => {
    const sc = t.scorecard
    return {
      symbol: t.symbol,
      name: t.name,
      price: t.valuation.price,
      marketCap: t.valuation.marketCap,
      trailingPe: sc.pe.trailingPe,
      sma150: t.valuation.sma150,
      allTimeHigh: t.valuation.allTimeHigh,
      yoyPct: sc.yoy.pct,
      yoyState: sc.yoy.state,
      ntmPct: sc.fwd.pct,
      ntmState: sc.fwd.state,
      epsCagr5yr: epsCagr5yr(sc.pe.trailingPe, t.valuation.peg5yr),
      technicals: await liveTechnicals(t.symbol),
    }
  })
  return selectPicks(inputs)
}
```

- [ ] **Step 2: Create `src/components/SubscribeForm.tsx`**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { Mail } from 'lucide-react'
import { Button, Input, useToast } from '@/ui'
import { subscribeAction } from '@/app/actions'

// Signup for the 6 AM ET digest. Double opt-in, so a successful submit means
// "we sent you a link", never "you are subscribed".
export function SubscribeForm() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [pending, startTransition] = useTransition()
  const toast = useToast()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const res = await subscribeAction({ firstName, lastName, email })
      if (res.ok) {
        toast({ message: res.message ?? 'Check your inbox.', tone: 'success' })
        setFirstName('')
        setLastName('')
        setEmail('')
      } else {
        toast({ message: res.error ?? 'Could not subscribe.', tone: 'error' })
      }
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder="First name"
          aria-label="First name"
          maxLength={60}
          required
          disabled={pending}
        />
        <Input
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder="Last name"
          aria-label="Last name"
          maxLength={60}
          required
          disabled={pending}
        />
      </div>
      <Input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        aria-label="Email address"
        maxLength={254}
        required
        disabled={pending}
      />
      <Button type="submit" loading={pending} className="w-full sm:w-auto">
        <Mail className="h-4 w-4" />
        Send me the Daily Maily
      </Button>
      <p className="text-xs text-muted">
        We send one email a day at 6:00 AM Eastern and nothing else. Unsubscribe from any of them.
      </p>
    </form>
  )
}
```

- [ ] **Step 3: Create `src/components/DigestPreview.tsx`**

A server component rendering today's picks with `src/ui` primitives — not the email HTML. Each pick gets a `Card` with the symbol, name, score, the five factor rows (label, detail, and a Tailwind progress bar of `points / max`), and the growth chips. Use `Badge` for the chips, `bigUsd` / `usd` / `pct` / `num` from `@/lib/format`, and `EmptyState` (icon `Inbox`) when `picks.length === 0`, with copy matching the email's empty state. Render `selection.considered` and `selection.gated` in a one-line summary above the cards. Mark the module `export const revalidate = 300` is **not** needed here — the parent page sets it.

```tsx
import { Inbox } from 'lucide-react'
import { Badge, Card, CardContent, EmptyState } from '@/ui'
import { bigUsd, num, pct, usd } from '@/lib/format'
import { MIN_SCORE, type ScoredPick, type Selection } from '@/lib/score'

function FactorBar({ label, detail, points, max }: { label: string; detail: string; points: number; max: number }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (points / max) * 100)) : 0
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="text-xs tabular-nums text-muted">
          {points.toFixed(1)}/{max}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted/20">
        <div className="h-1.5 rounded-full bg-gradient-brand" style={{ width: `${w}%` }} />
      </div>
      <p className="text-[11px] text-muted">{detail}</p>
    </div>
  )
}

function PickCard({ pick, rank }: { pick: ScoredPick; rank: number }) {
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-brand text-xs font-bold text-white">
                {rank}
              </span>
              <span className="truncate text-base font-bold text-foreground">{pick.symbol}</span>
            </div>
            <p className="mt-1 truncate text-xs text-muted">{pick.name}</p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-2xl font-bold tabular-nums text-gradient-brand">
              {pick.score.toFixed(1)}
            </div>
            <div className="text-[11px] text-muted">/ 100</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant={(pick.yoyPct ?? 0) > 0 ? 'success' : 'destructive'}>
            YoY {pct(pick.yoyPct, 0)}
          </Badge>
          <Badge variant={(pick.ntmPct ?? 0) > 0 ? 'success' : 'destructive'}>
            NTM {pct(pick.ntmPct, 0)}
          </Badge>
          <Badge variant={(pick.epsCagr5yr ?? 0) > 0 ? 'success' : 'destructive'}>
            CAGR 5y {pct(pick.epsCagr5yr, 0)}
          </Badge>
          <Badge variant="secondary">{bigUsd(pick.marketCap)}</Badge>
          <Badge variant="secondary">{usd(pick.price)}</Badge>
          <Badge variant="secondary">P/E {num(pick.trailingPe, 1)}</Badge>
        </div>

        <div className="space-y-3">
          {pick.factors.map((f) => (
            <FactorBar key={f.key} label={f.label} detail={f.detail} points={f.points} max={f.max} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function DigestPreview({ selection }: { selection: Selection }) {
  if (selection.picks.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-8 w-8" />}
        title="Nothing cleared the bar today"
        description={`Of ${selection.considered} watchlist names, none both passed every entry gate and scored at least ${MIN_SCORE}/100. A short list is honest; a padded one is not.`}
      />
    )
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {selection.picks.length} of {selection.considered} watchlist names cleared the entry gate and
        scored {MIN_SCORE} or better
        {selection.gated > 0 ? `; ${selection.gated} more passed the gate but fell short on score` : ''}.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {selection.picks.map((p, i) => (
          <PickCard key={p.symbol} pick={p} rank={i + 1} />
        ))}
      </div>
    </div>
  )
}
```

Before wiring this up, check the actual `variant` names `Badge` accepts in `src/ui/components/Badge.tsx` and use those — the names above assume `success` / `destructive` / `secondary`. If they differ, use the real ones rather than adding variants.

- [ ] **Step 4: Create `src/app/daily/page.tsx`**

```tsx
import { Suspense } from 'react'
import { Mail } from 'lucide-react'
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from '@/ui'
import { buildSelection } from '@/lib/digest'
import { MAX_PICKS, MIN_MARKET_CAP, MIN_SCORE } from '@/lib/score'
import { SubscribeForm } from '@/components/SubscribeForm'
import { DigestPreview } from '@/components/DigestPreview'
import { WatchlistSkeleton } from '@/components/DashboardSkeletons'

// Same ISR window as the dashboard — the preview runs the identical fan-out.
export const revalidate = 300

async function TodaysPicks() {
  const selection = await buildSelection()
  return <DigestPreview selection={selection} />
}

export default async function DailyPage({
  searchParams,
}: {
  searchParams: Promise<{ confirmed?: string; unsubscribed?: string }>
}) {
  const sp = await searchParams

  return (
    <div className="space-y-6">
      <PageHeader
        title="TripleQ Daily Maily"
        description="One email at 6:00 AM Eastern, every morning, before the open — the watchlist names that cleared the entry gate, ranked by the TripleQ Score."
      />

      {sp.confirmed === '1' ? (
        <Alert tone="success" title="You're in.">
          Your first Daily Maily arrives at 6:00 AM Eastern.
        </Alert>
      ) : null}
      {sp.confirmed === '0' ? (
        <Alert tone="warning" title="That link has expired.">
          Sign up again below and we'll send a fresh confirmation.
        </Alert>
      ) : null}
      {sp.unsubscribed === '1' ? (
        <Alert tone="info" title="Unsubscribed.">
          You will not receive the Daily Maily again. Sign up below any time.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Subscribe
            </CardTitle>
            <CardDescription>
              Confirm the link we email you and you're on the list.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <SubscribeForm />
            <div className="space-y-1.5 border-t border-border pt-4 text-xs text-muted">
              <p className="font-semibold text-foreground">To make the list, a stock must:</p>
              <ul className="list-disc space-y-1 pl-4">
                <li>be worth at least ${(MIN_MARKET_CAP / 1e9).toFixed(0)}B</li>
                <li>show positive YoY EPS growth</li>
                <li>show positive NTM EPS growth</li>
                <li>show a positive 5-year expected EPS CAGR</li>
                <li>trade below its all-time high</li>
                <li>score at least {MIN_SCORE}/100 — top {MAX_PICKS} only</li>
              </ul>
              <p className="pt-2">Fundamental signals only — not investment advice.</p>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Today&apos;s picks</h2>
          <Suspense fallback={<WatchlistSkeleton />}>
            <TodaysPicks />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
```

Check the `tone` prop values `Alert` actually accepts in `src/ui/components/Alert.tsx` and use the real ones.

- [ ] **Step 5: Add the sidebar entry**

In `src/components/ScreenerSidebar.tsx`, extend the import and the `NAV` array:

```tsx
import { Calculator, LineChart, Mail } from 'lucide-react'

const NAV = [
  { href: '/', label: 'Dashboard', icon: <LineChart className="h-4 w-4" /> },
  { href: '/evaluation', label: 'Company evaluation', icon: <Calculator className="h-4 w-4" /> },
  { href: '/daily', label: 'Daily Maily', icon: <Mail className="h-4 w-4" /> },
]
```

- [ ] **Step 6: Verify in the browser**

Run: `pnpm typecheck && pnpm build && pnpm dev`
Open `http://localhost:3000/daily`. Expected: the sidebar shows three items with Daily Maily active; the form renders and validates; today's picks render (or the empty state does). Submitting the form with `RESEND_API_KEY` unset must still succeed and log the skipped send — that proves the no-op fallback.

- [ ] **Step 7: Commit**

```bash
git add src/app/daily src/components/SubscribeForm.tsx src/components/DigestPreview.tsx src/lib/digest.ts src/components/ScreenerSidebar.tsx
git commit -m "Add the Daily Maily tab: signup form and today's scored picks"
```

---

### Task 11: The 6 AM ET digest route

Spec §4. The last piece — everything else is already tested.

**Files:**
- Create: `src/app/api/digest/route.ts`
- Modify: `vercel.json`, `.env.example`, `README.md`

**Interfaces:**
- Consumes: `buildSelection` (Task 10), `listConfirmed` / `claimDigestDay` / `recordDigestSend` (Task 6), `renderDigest` (Task 8), `sendEmails` (Task 7), `publish` (Task 5), `ingestAllActive` (existing), `siteUrl` (Task 9), `db` (existing).

- [ ] **Step 1: Create `src/app/api/digest/route.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { ingestAllActive } from '@/lib/ingest'
import { publish } from '@/lib/publish'
import { buildSelection } from '@/lib/digest'
import { renderDigest } from '@/lib/email/render'
import { sendEmails, type EmailMessage } from '@/lib/email/send'
import { claimDigestDay, listConfirmed, recordDigestSend } from '@/lib/subscribers'
import { siteUrl } from '@/lib/site'
import { db } from '@/lib/db'

// The TripleQ Daily Maily.
//
//   GET            → the Vercel Cron target. Sends once per Eastern day, at 6 AM ET.
//   GET ?force=1   → bypasses the clock and the once-a-day guard, and sends ONLY
//                    to DIGEST_TEST_EMAIL. For verifying a real send.
//
// Scheduled at "0 10,11 * * *" UTC because Eastern moves: 10:00 UTC is 06:00 ET
// in summer and 11:00 UTC is 06:00 ET in winter. Both fire every day and the
// hour guard below discards the wrong one, which is how this hits 6 AM ET
// year-round from a UTC-only scheduler.
export const maxDuration = 60

const TZ = 'America/New_York'

/** The current hour (0–23) in Eastern. */
function easternHour(now: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(now),
  )
}

/** Today's Eastern calendar date as 'YYYY-MM-DD' — the idempotency key. Must be
 *  Eastern, not UTC: at 06:00 ET the UTC date is the same day, but deriving it
 *  from UTC would drift the moment the schedule or the timezone rules change. */
function easternDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return parts
}

function easternLabel(now: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now)
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

/** Is the newest valuation snapshot from today (Eastern)? The email must never
 *  be built from yesterday's numbers because the ingest cron failed.
 *
 *  `as_of` is a Postgres `date` (see 0026), so supabase-js hands back a bare
 *  'YYYY-MM-DD' string — the same shape `easternDate()` produces. Compare the
 *  strings directly. Do NOT round-trip through `new Date()`: that parses a
 *  date-only string as UTC midnight, which formats back as the PREVIOUS day in
 *  Eastern and would make today's fresh snapshot look stale every morning. */
async function snapshotIsFresh(today: string): Promise<boolean> {
  const supabase = db()
  const { data } = await supabase
    .from('screener_valuation_snapshots')
    .select('as_of')
    .order('as_of', { ascending: false })
    .limit(1)
  const asOf = (data ?? [])[0]?.as_of as string | undefined
  return asOf === today
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const force = req.nextUrl.searchParams.get('force') === '1'
  const now = new Date()
  const today = easternDate(now)

  // 1. Hour guard. Hour 7 is the late-fire recovery path: on a summer day the
  //    10:00 UTC run already sent at 06:00 ET and the day-claim below stops
  //    this one; on a winter day 10:00 UTC landed at 05:00 ET and was skipped
  //    here, so 11:00 UTC at 06:00 ET is the one that sends.
  if (!force) {
    const hour = easternHour(now)
    if (hour !== 6 && hour !== 7) {
      return NextResponse.json({ ok: true, skipped: 'off-hour', easternHour: hour })
    }
  }

  try {
    // 2. Freshness. Refresh ourselves if the ingest cron did not run or failed.
    let refreshed = 0
    if (!(await snapshotIsFresh(today))) {
      const results = await ingestAllActive()
      refreshed = results.length
      publish()
    }

    // 3. Claim the day BEFORE sending anything, so a retry cannot double-mail.
    let claimId: string | null = null
    if (!force) {
      claimId = await claimDigestDay(today)
      if (!claimId) return NextResponse.json({ ok: true, skipped: 'already-sent', sentOn: today })
    }

    // 4. Build.
    const selection = await buildSelection()
    const origin = siteUrl()
    const asOfLabel = easternLabel(now)

    // 5. Send.
    const recipients = force
      ? (() => {
          const test = process.env.DIGEST_TEST_EMAIL
          return test
            ? [{ email: test, firstName: 'there', unsubscribeToken: 'force-preview' }]
            : []
        })()
      : (await listConfirmed()).map((s) => ({
          email: s.email,
          firstName: s.firstName,
          unsubscribeToken: s.unsubscribeToken,
        }))

    const messages: EmailMessage[] = recipients.map((r) => {
      const mail = renderDigest({
        recipient: { firstName: r.firstName, unsubscribeToken: r.unsubscribeToken },
        selection,
        asOfLabel,
        siteUrl: origin,
      })
      const unsub = `${origin}/api/subscribe/unsubscribe?token=${encodeURIComponent(r.unsubscribeToken)}`
      return {
        to: r.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        headers: {
          'List-Unsubscribe': `<${unsub}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }
    })

    const report = await sendEmails(messages)

    // 6. Record.
    if (claimId) {
      await recordDigestSend(claimId, report.sent, selection.picks.length, selection.picks)
    }

    return NextResponse.json({
      ok: true,
      force,
      sentOn: today,
      refreshed,
      considered: selection.considered,
      picks: selection.picks.length,
      recipients: recipients.length,
      sent: report.sent,
      failed: report.failed,
      errors: report.errors,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 })
  }
}
```

- [ ] **Step 2: Update `vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/ingest",
      "schedule": "30 9 * * *"
    },
    {
      "path": "/api/digest",
      "schedule": "0 10,11 * * *"
    }
  ]
}
```

- [ ] **Step 3: Update `.env.example`**

Append:

```
# ── Daily Maily (the 6 AM ET digest) ────────────────────────────────
# Resend API key. UNSET = the send layer no-ops and logs instead, which is
# what keeps local runs and mock deploys from mailing real people.
RESEND_API_KEY=
# Sender identity. Requires the domain verified in Resend (DNS records).
DIGEST_FROM=TripleQ Group <daily@tripleqgroup.com>
# Absolute origin for links inside emails. No trailing slash.
NEXT_PUBLIC_SITE_URL=https://tripleqgroup.vercel.app
# Sole recipient of GET /api/digest?force=1 — for verifying a real send.
DIGEST_TEST_EMAIL=
```

- [ ] **Step 4: Update `README.md`**

Add a `## TripleQ Daily Maily` section after `## The 5 signals` covering: what it sends and when; the gate table and the factor-weight table from spec §2 (copied, not summarised); the two crons and why there are two; the double opt-in flow; the four new env vars; and the note that `supabase/migrations/0029_subscribers.sql` must be applied. Update the Vercel env-var table with the four new rows, and the `### 3. Weekly auto-refresh` heading — it says "weekly" but the cron has been daily since `0ff8417`; make it `### 3. Daily auto-refresh and the 6 AM ET digest`.

- [ ] **Step 5: Verify the whole pipeline locally**

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm dev
```

Then, in another shell:

```bash
curl -s "http://localhost:3000/api/digest" | head -c 400
```

Expected (outside 06:00–07:59 ET): `{"ok":true,"skipped":"off-hour","easternHour":N}` — proof the clock guard works without sending anything.

```bash
curl -s "http://localhost:3000/api/digest?force=1" | head -c 600
```

Expected: a JSON summary with `considered` equal to your watchlist size, a `picks` count, and — with `RESEND_API_KEY` unset — `sent: 0` plus the `RESEND_API_KEY not set — send skipped` error string. Nothing is mailed. If `picks` is 0, that is a legitimate result; confirm it by checking `/daily` shows the same empty state.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/digest vercel.json .env.example README.md
git commit -m "Send the TripleQ Daily Maily at 6 AM ET, idempotently"
```

- [ ] **Step 7: Report the manual deployment steps**

These cannot be done from the repo. List them in the task report:

1. Verify `tripleqgroup.com` in Resend and add the DNS records it gives you.
2. Set `RESEND_API_KEY`, `DIGEST_FROM`, `NEXT_PUBLIC_SITE_URL`, `DIGEST_TEST_EMAIL` in Vercel (all environments).
3. Apply `supabase/migrations/0029_subscribers.sql` if Task 4 step 4 was not done.
4. After deploying, hit `GET /api/digest?force=1` with the `CRON_SECRET` bearer token to prove a real send lands in `DIGEST_TEST_EMAIL`.
5. Insert the seed subscribers as pre-confirmed once the addresses are supplied:

```sql
INSERT INTO public.screener_subscribers (email, first_name, last_name, status, confirmed_at, unsubscribe_token)
VALUES ('someone@example.com', 'First', 'Last', 'confirmed', now(), gen_random_uuid())
ON CONFLICT (email) DO NOTHING;
```

---

## Self-Review

**Spec coverage.** §1 scope → all tasks. §2.1–2.3 model → Task 3 (§2.3's `retracementRatio` → Task 1). §2.4 selection → Task 3. §2.5 shared derivations → Task 2. §3 data model → Task 4. §4 timing and route → Task 11 (`publish` extraction → Task 5). §5 sending → Task 7. §6 email → Task 8. §7 signup surface → Tasks 9 and 10. §8 file list → the File Structure table, plus `src/lib/site.ts` which the spec did not name; it is introduced in Task 9 Step 2 with its rationale. §9 environment → Task 11 Step 3. §10 testing → Tasks 1, 2, 3 (harness), 8 (preview script), 11 (force send). §11 open items → Task 11 Step 7 item 5.

**Placeholders.** None. Every code step carries complete, runnable code. Three steps ask the implementer to check an existing prop's real variant names (`Badge`, `Alert`) before using them rather than inventing values — that is verification against the codebase, not a deferred decision.

**Type consistency.** `ScoredPick` extends `Evaluation`, so `reasons` and `factors` are available on picks in Tasks 8 and 10 — checked against every use. `Selection` carries `picks` / `considered` / `gated` and all three are read in Tasks 8, 10, 11. `Subscriber` uses camelCase (`firstName`, `unsubscribeToken`) everywhere outside `src/lib/subscribers.ts`, which is the only module touching snake_case columns. `EmailMessage.headers` is optional and supplied only by the digest route. `siteUrl()` is a function, called as `siteUrl()` at all four call sites.


**Post-review corrections applied.** Three defects were found by walking the
arithmetic of the Task 3 fixtures and the Task 11 date handling, and are fixed
above rather than left for the implementer:

1. `score.ts` no longer imports `epsCagr5yr` — the caller derives it, and the
   scorer must not know it comes from a PEG ratio.
2. The Task 3 "perfect" fixture's all-time high was 15% above price, which is
   only ~65% of the drawdown factor's credit — the `scores 100` assertion would
   have failed. It is now -25%, the curve's full-credit point.
3. `snapshotIsFresh()` compared a Postgres `date` by round-tripping through
   `new Date()`, which parses 'YYYY-MM-DD' as UTC midnight and formats back as
   the *previous* day in Eastern — today's fresh snapshot would have looked
   stale every single morning, triggering a redundant full ingest inside the
   6 AM window. It now compares the strings directly.
