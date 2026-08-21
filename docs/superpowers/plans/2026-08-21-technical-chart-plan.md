# Technical Chart — Implementation Plan

Adds a per-stock daily technical chart, opened from a graph icon in each
watchlist row. Overlays: candlesticks, SMA 150, a linear-regression "tunnel"
(channel), swing-anchored Fibonacci retracements, and unclosed price gaps.
The tunnel position alone produces a buy / don't-buy verdict.

Approved design decisions (binding):
- Tunnel = linear regression channel, +/- 2 sigma rails.
- Visible window = 6 months (126 daily bars); channel is fitted on it.
- Fibonacci anchored to the last major swing high -> swing low.
- Gaps: both directions, >= 2%, unclosed only.
- Verdict from tunnel position ALONE. SMA/gaps/fib are context, never scored.
- Server computes (pure module), client renders.
- Opens in a modal over the watchlist.

## Global Constraints

These bind every task. Exact values, use verbatim:

- `WARMUP_BARS = 150`, `VISIBLE_BARS = 126`, `FETCH_BARS = 276`
- `SMA_PERIOD = 150`
- `CHANNEL_SIGMA = 2`
- `DONT_BUY_PCT = 70` (position >= 70 -> 'dont-buy')
- `OPPORTUNITY_PCT = 30` (position <= 30 -> 'opportunity')
- between the two, exclusive -> 'fair'
- `PIVOT_K = 5` (bars each side for fractal pivot confirmation)
- `MIN_SWING_PCT = 5` (a swing smaller than this is not "major")
- `FIB_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786]`
- `GAP_MIN_PCT = 2`
- `MIN_CHANNEL_BARS = 30` (fewer visible bars -> verdict 'insufficient-history')

Project rules:
- TypeScript strict. `pnpm typecheck` must pass at the end of every task.
- No new npm dependencies. `echarts`, `echarts-for-react`,
  `@radix-ui/react-dialog` and `lucide-react` are already installed.
- Follow existing file conventions: comment style explains WHY, matching
  the existing files (see `src/market-data/providers/yahoo.ts` header).
- Money/percent formatting goes through `src/lib/format.ts` helpers.
- Do not modify `src/lib/signals.ts` or any `supabase/migrations/*`.
- No new database tables or migrations. All data is fetched live.

## Task 1: Daily bars from Yahoo

Add the daily OHLC fetch. This is the only I/O in the feature.

**File: `src/market-data/provider.ts`**

Add and export:

```ts
/** One daily OHLC bar. `t` is a unix-seconds timestamp (Yahoo's native form). */
export interface Bar {
  t: number
  o: number
  h: number
  l: number
  c: number
}
```

Do NOT add `getDailyBars` to the `DataProvider` interface. It is Yahoo-specific,
exactly like the existing `getSma` / `getAllTimeHigh`, which are methods on
`YahooProvider` only. `providers/mock.ts` and `providers/fmp.ts` must not change.

**File: `src/market-data/providers/yahoo.ts`**

Add a method to `YahooProvider`, placed directly after `getSma`:

```ts
async getDailyBars(symbol: string, count: number): Promise<Bar[]>
```

Implementation requirements:
- Use `CHART_BASE` (already defined in the file), `range=2y`, `interval=1d`.
  `range=1y` returns only ~252 bars and we need 276 — do not use `1y`.
- Same headers as `getSma`: `{ 'User-Agent': UA, accept: 'application/json' }`.
  No cookie/crumb handshake is needed for this endpoint (`getSma` proves it).
- Non-ok response -> `throw new ProviderError(\`Yahoo chart → ${res.status}\`, symbol, res.status)`,
  matching `getSma` verbatim.
- Yahoo returns parallel arrays under
  `chart.result[0].indicators.quote[0]` (`open`/`high`/`low`/`close`) and
  timestamps under `chart.result[0].timestamp`. Any index where a timestamp or
  ANY of the four OHLC values is null/non-finite must be dropped entirely — Yahoo
  emits null rows for halted sessions, and a null in one leg corrupts every
  downstream calc.
- Return the LAST `count` bars, ascending by time. If fewer valid bars exist,
  return all of them (the calc layer degrades; it is not this method's job).
- Return `[]` (not a throw) when the response has no `chart.result[0]`.

**Testing:** no unit test for this task — it is a network adapter, and the
repo has no HTTP mocking harness. Verify with `pnpm typecheck` only.

## Task 2: The technicals module

The whole feature's math. Pure functions, zero I/O, zero React.

**File: `src/lib/technicals.ts`** (new)

Export these types and one entry point:

```ts
import type { Bar } from '@/market-data/provider'

export type Verdict = 'dont-buy' | 'fair' | 'opportunity' | 'insufficient-history'

export interface Channel {
  upper: number[]      // per visible bar
  mid: number[]
  lower: number[]
  slopePerDay: number
  positionPct: number  // raw; MAY fall outside 0..100
}

export interface FibLevel { ratio: number; price: number }

export interface Fib {
  high: number
  low: number
  direction: 'rally' | 'decline'
  levels: FibLevel[]
  anchor: 'swing' | 'window'   // 'window' = fallback, UI must label it
}

export interface Gap {
  fromT: number
  toT: number
  top: number
  bottom: number
  pct: number
  direction: 'up' | 'down'
  side: 'above' | 'below'      // vs the latest close
}

export interface Technicals {
  visible: Bar[]
  sma150: (number | null)[]    // aligned to visible; null until warmup satisfied
  channel: Channel | null
  fib: Fib | null
  gaps: Gap[]
  verdict: Verdict
  positionPct: number | null
}

export function analyze(bars: Bar[]): Technicals
```

Algorithms — implement each as its own small exported function so it can be
tested directly (`linreg`, `findPivots`, `computeFib`, `findGaps`,
`smaSeries`, `verdictFor`):

1. **Split.** `visible = bars.slice(-VISIBLE_BARS)`. Warmup bars are those
   before it. If `bars.length < VISIBLE_BARS`, visible is all of them.

2. **`smaSeries(bars, period, visibleCount)`** -> `(number|null)[]` of length
   `visibleCount`. For visible index `i` (absolute index `a = bars.length - visibleCount + i`),
   the value is the mean of `bars[a-period+1 .. a].c`. Null when `a - period + 1 < 0`.

3. **`linreg(ys)`** -> `{ slope, intercept, sigma }`. Least squares with
   `x = 0..n-1`. `sigma` = population standard deviation of the residuals
   (`sqrt(sum(r^2)/n)`, divide by `n`, NOT `n-1`).

4. **Channel.** Fit `linreg` on the visible closes. For each visible index i:
   `mid[i] = intercept + slope*i`, `upper[i] = mid[i] + CHANNEL_SIGMA*sigma`,
   `lower[i] = mid[i] - CHANNEL_SIGMA*sigma`.
   `positionPct = (lastClose - lower[n-1]) / (upper[n-1] - lower[n-1]) * 100`.
   Return raw — do NOT clamp; ~5% of bars sit outside +/-2 sigma by construction
   and the UI clamps for display. If `upper[n-1] - lower[n-1] === 0` (a flat
   series, sigma 0), return `positionPct = 50`.
   Channel is `null` when `visible.length < MIN_CHANNEL_BARS`.

5. **`findPivots(bars, k)`** -> `{ highs: number[]; lows: number[] }` of indices.
   Index `i` is a pivot high when `k <= i < bars.length - k` and `bars[i].h` is
   the strict maximum of `bars[i-k .. i+k].h` (ties disqualify). Pivot low is the
   symmetric strict minimum on `.l`. The last `k` bars can never be pivots —
   that is inherent to confirmation, not a bug.

6. **`computeFib(visible)`** -> `Fib | null`.
   Take the most recent pivot high `H` and most recent pivot low `L`.
   - If both exist and `|high - low| / low * 100 >= MIN_SWING_PCT`:
     `direction = H > L ? 'rally' : 'decline'` (comparing INDEX, i.e. recency),
     `anchor = 'swing'`.
   - Otherwise fall back: `high` = max `.h` over visible, `low` = min `.l`,
     `direction` = 'rally' if the max occurs at a later index than the min else
     'decline', `anchor = 'window'`.
   - Levels: for a rally, `price = high - (high - low) * ratio` (retracing down
     from the high). For a decline, `price = low + (high - low) * ratio`.
   - Return `null` only when `visible.length < 2`.

7. **`findGaps(visible)`** -> `Gap[]`. For each adjacent pair `(i-1, i)`:
   - gap up when `visible[i].l > visible[i-1].h`:
     `bottom = visible[i-1].h`, `top = visible[i].l`, `direction = 'up'`
   - gap down when `visible[i].h < visible[i-1].l`:
     `bottom = visible[i].h`, `top = visible[i-1].l`, `direction = 'down'`
   - `pct = (top - bottom) / bottom * 100`; drop when `pct < GAP_MIN_PCT`.
   - **Filled** (drop it) when any LATER bar `j > i` trades through the far edge:
     for a gap up, `visible[j].l <= bottom`; for a gap down, `visible[j].h >= top`.
   - `side` = 'above' when `bottom > lastClose`, else 'below'.
   - Return unclosed gaps only, ascending by `fromT`.

8. **`verdictFor(positionPct)`** -> `Verdict`. `>= DONT_BUY_PCT` -> 'dont-buy';
   `<= OPPORTUNITY_PCT` -> 'opportunity'; else 'fair'. `analyze` returns
   'insufficient-history' when the channel is null.

**File: `scripts/test-signals.ts`** — append a technicals section following the
EXACT existing style of that file (read it first; do not invent a new harness
or add a test framework). Required cases:

- `linreg` on a known-slope series: `y = 2x + 1` -> slope 2, intercept 1, sigma 0.
- `linreg` sigma: a series with known residuals, asserting population (÷n) not
  sample (÷n-1) — these differ, and getting it wrong silently widens the rails.
- `verdictFor` at the exact boundaries: 70 -> 'dont-buy', 69.99 -> 'fair',
  30 -> 'opportunity', 30.01 -> 'fair'.
- `positionPct` on a synthetic series where the last close sits on the upper
  rail -> 100, on the lower rail -> 0, on the mid -> 50.
- Flat series (sigma 0) -> positionPct 50, not NaN or Infinity.
- `findPivots` on a hand-built series with one obvious peak and trough at known
  indices; assert the last `k` bars produce no pivot.
- `computeFib` fallback: a series with no qualifying swing returns
  `anchor: 'window'`.
- `findGaps`: a 3% unclosed gap up is returned; a 1% gap is dropped (below
  threshold); a 3% gap later traded through is dropped (filled).

Run `pnpm test` and `pnpm typecheck`; both must pass.

## Task 3: Cache + server action wiring

**File: `src/lib/queries.ts`**

Follow the EXISTING `cachedSma150` / `liveSma150` pattern verbatim
(same file, around line 32) — same `unstable_cache` shape, same
`tags: ['yahoo-live']` so the existing `revalidateTag('yahoo-live')` in
`src/app/actions.ts` already invalidates it. Reuse the existing `SMA_TTL_S`
constant; do not invent a new TTL.

```ts
const cachedTechnicals = unstable_cache(
  (symbol: string) =>
    new YahooProvider().getDailyBars(symbol, FETCH_BARS).then(analyze),
  ['yahoo-technicals-v1'],
  { revalidate: SMA_TTL_S, tags: ['yahoo-live'] },
)
export const liveTechnicals = (symbol: string) =>
  cachedTechnicals(symbol).catch(() => null)
```

**File: `src/app/actions.ts`**

Add a server action `getTechnicals(symbol: string): Promise<Technicals | null>`
that calls `liveTechnicals`. Match the existing action style in that file
(read it first). It must never throw to the client — null is the failure signal.

Do not call it from any server component; the modal fetches on demand.

`pnpm typecheck` must pass.

## Task 4: Chart UI, modal, and the row icon

**File: `src/components/charts/TechnicalChart.tsx`** (new, `'use client'`)

Props: `{ data: Technicals; symbol: string }`. Renders one `ReactECharts`.
Follow the conventions in `src/components/charts/EpsTrendChart.tsx` — read it
first: `useMemo` for the option object, colors from `tokens` (`@/ui`), no
hardcoded hex.

Series:
- `candlestick` from `data.visible` (`[o, c, l, h]` is ECharts' order — not OHLC).
- `line` for `data.sma150`, no symbols, thin.
- two `line` series for `channel.upper` / `channel.lower`, dashed; shade between
  them (an `areaStyle` on a stacked band or a `markArea`) at low opacity.
- `markLine` per fib level, labelled `"61.8% · $184.20"` (use `usd` from
  `@/lib/format`).
- `markArea` per gap, spanning its `bottom`..`top`, tinted by direction.
- x axis: dates from `Bar.t` (unix SECONDS — multiply by 1000).

Above the chart, a verdict banner:
- 'dont-buy' -> destructive styling, text `DON'T BUY`
- 'opportunity' -> success styling, text `OPPORTUNITY`
- 'fair' -> neutral, text `FAIR`
- 'insufficient-history' -> neutral, text `NOT ENOUGH HISTORY`, no percentage
Show `positionPct` rounded to 0 decimals as "N% of tunnel height", with the
displayed meter clamped to 0..100 even when the raw value is outside.
Below it, a context line (NOT scored, and it must not look like part of the
verdict): % vs SMA 150, count of unclosed gaps split above/below, and the
nearest fib level. When `fib.anchor === 'window'`, label it
"window extremes (no major swing)" so a fallback never reads as a real swing.

**File: `src/components/charts/LazyCharts.tsx`**

Add a `TechnicalChart` export following the two existing `dynamic(...)` entries
exactly (`ssr: false`, `Skeleton` loading state). This is what keeps the ~1.1MB
echarts chunk out of the watchlist's initial payload — do not import
`TechnicalChart` directly anywhere else.

**File: `src/components/TechnicalChartModal.tsx`** (new, `'use client'`)

Props: `{ symbol: string; open: boolean; onOpenChange: (o: boolean) => void }`.
Uses `@radix-ui/react-dialog` (installed, currently unused in `src/` — you are
its first consumer). On open, calls the `getTechnicals` action, shows a
`Skeleton` while pending, the lazy `TechnicalChart` on success, and an
`Alert`/`EmptyState` from `@/ui` when it resolves null. Fetch once per open;
do not refetch on every render. Esc and overlay click close it.

**File: `src/components/WatchlistTable.tsx`**

Add a graph icon button per row — `LineChart` from `lucide-react` — in BOTH
layouts: the desktop table (a new cell beside the existing
`RemoveTickerButton` cell, with a matching `<th>` in the header row) and the
mobile card. Clicking it opens the modal and MUST NOT trigger the row's
existing row-click navigation: wrap in `onClick={(e) => e.stopPropagation()}`,
the same guard the `RemoveTickerButton` cell already uses. Give it an
`aria-label` of `` `Open technical chart for ${symbol}` ``. Only one modal
instance for the table, driven by a `chartSymbol: string | null` state — do
not render a modal per row.

`pnpm typecheck` must pass. Verify the mobile layout is not broken.
