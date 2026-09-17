# TripleQ Daily Maily v2 — professional-grade digest

> **Superseded in part, 2026-09-17.** Section 5 (AI commentary) no longer
> describes the shipped system. The single `claude-opus-5` call and its
> grounding guard were removed at the user's request; the market read and
> per-stock lines are now composed deterministically from the picks' own
> figures by `src/lib/market-read.ts`. The `Commentary` interface, the
> `market_read` / `per_stock` storage columns, the panel in the template and
> every degradation path described below are unchanged — only the producer
> is different. See README → "The market read". The rest of this document
> still describes the shipped system.

A redesign of the daily email for expert traders: real price charts, AI-written
market and per-stock commentary, substantially more data per pick, and deeper
personalization. Ships behind a feature flag so the live list is never exposed
to work in progress.

Status: approved 2026-09-17. Supersedes the email-rendering sections of
`2026-09-14-triple-q-daily-maily-design.md`; the scoring model, subscriber
flow, and cron scheme from that spec are unchanged.

---

## 1. The constraint that shapes the architecture

Vercel Hobby allows **2 cron jobs** and **60 seconds per function**. Both cron
slots are already used (`/api/ingest` 09:30 UTC, `/api/digest` 11:00 UTC), so a
third scheduled job is not available.

A single Claude call with adaptive thinking can take 30–60s by itself. Adding
chart rendering, storage uploads and the send fan-out to one 60-second function
would exceed the limit, and a timeout mid-send is the worst failure this system
has — the day is claimed, some subscribers are mailed, and nothing is recorded.

**Therefore the pipeline splits across the two existing crons:**

```
09:30 UTC  /api/ingest   ingest → publish → PREPARE  (score, render charts, AI commentary) → persist
11:00 UTC  /api/digest   read prepared row → render per-subscriber HTML → send
```

Preparation is a new phase appended to the ingest route. The digest route no
longer scores or calls anything expensive — it reads one row and sends. Ninety
minutes of slack sit between them.

**Degradation is the design's backbone, not an afterthought.** Every expensive
artifact is optional: if preparation never ran, or ran partially, or is stale,
the digest still sends using whatever exists. Missing charts render the v1 CSS
bars. Missing commentary omits those blocks. A missing prep row entirely falls
back to scoring inline exactly as v1 does. The email a subscriber receives
degrades in richness, never in correctness, and never fails to arrive.

---

## 2. Scope

In scope:

- A chart renderer producing a PNG per pick, stored in Supabase Storage.
- One grounded Claude call per day producing market commentary and a per-stock
  read, via structured outputs.
- A richer `ScoreInput`/`ScoredPick` carrying momentum, valuation depth and
  earnings context.
- A v2 email template behind `DIGEST_TEMPLATE`, defaulting to v1.
- A preparation phase on the ingest route and a persisted artifact row.

Out of scope, with reasons:

- **Volume metrics.** `Bar` in `src/market-data/provider.ts` carries only
  `t, o, h, l, c` — there is no volume field, and both providers' bar fetches
  would have to change to add one. Deferred rather than faked.
- **Next earnings date.** No provider method exposes it; adding one means a new
  FMP or Yahoo endpoint. Deferred.
- Per-subscriber watchlists or per-subscriber scoring. Every recipient still
  receives the same picks; personalization is presentational.
- Any change to the scoring model itself. The gates and weights from the v1
  spec are untouched.

---

## 3. Data additions

### 3.1 New derived readings

Added to `src/lib/derive.ts` (pure, tested alongside the existing helpers):

| Function | Returns | Source |
|---|---|---|
| `priceChangePct(bars, lookback)` | % change over N trading days | the visible bar series |
| `fiftyTwoWeekRange(bars)` | `{ high, low, pctFromHigh, pctFromLow }` | needs ~252 bars |
| `epsSurprisePct(eps)` | latest actual vs estimate, in percent | `screener_quarterly_eps` |

`FETCH_BARS` in `src/lib/technicals.ts` is 276 (`WARMUP_BARS` 150 +
`VISIBLE_BARS` 126). A 52-week window needs ~252 **trading** days, which the
276 already covers — the extra readings cost no additional fetching. The
52-week range is computed over the full fetched series, not the 126-bar visible
window; `analyze()` gains a `fullRange` field carrying it so the bars do not
have to be re-walked downstream.

### 3.2 Widened `ScoreInput` and `ScoredPick`

`ScoreInput` gains optional context fields — `forwardPe`, `peg5yr`,
`netMarginTtm`, `grossMarginTtm`, `operatingMarginTtm`, `roiTtm`,
`epsSurprisePct`, `yoyTrend`. **These are carried, not scored.** The gate set
and the five factor weights are byte-identical to v1; adding a field to the
input must not move a single score. The existing "perfect input scores exactly
100" assertion is the guard, and a new assertion pins a representative pick's
score across the v1 and v2 input shapes.

`ScoredPick` gains the derived momentum and range readings so the renderer
never recomputes them.

---

## 4. Chart rendering

### 4.1 Why a PNG

Email clients run no JavaScript and Gmail strips inline SVG, so a real chart
must arrive as a raster image at a URL. The v1 CSS bars stay in the codebase as
the degraded path.

### 4.2 Renderer

`src/lib/chart/render.ts` draws, for one pick:

- the 126-day close series;
- the 150-day SMA line;
- the regression channel's upper, mid and lower rails;
- the golden-zone band shaded between the 0.5 and 0.618 retracement prices;
- the last close marked, with price and date axes.

Implemented with `@napi-rs/canvas` — prebuilt platform binaries, no system
libraries, which is what makes it viable on Vercel's runtime. The module
exports `renderChart(pick, technicals): Promise<Buffer | null>` and **returns
null rather than throwing** on any failure, including a missing native binary.

**Deployment risk, stated plainly.** A native dependency on Vercel's serverless
runtime is the least certain part of this design. The mitigations are
structural: the renderer is behind an interface, returns null on failure, and
the email falls back to the v1 CSS bars whenever a chart URL is absent. If the
binary does not load in production, the digest still goes out — it simply looks
like v1. Task 3 verifies this against a real deployment before anything depends
on it.

### 4.3 Storage

Charts are written to a **public** Supabase Storage bucket named
`digest-charts`, keyed `{easternDate}/{symbol}.png`. Public because mail clients
fetch images unauthenticated — there is no way to pass a token, and the content
is a chart of public market data.

`src/lib/chart/store.ts` exposes `uploadChart(date, symbol, png)` returning the
public URL or null, and `pruneCharts(olderThanDays)` deleting old prefixes.
Pruning runs in the preparation phase and keeps 30 days: at roughly 40 KB per
chart, 10 charts a day, that is ~12 MB standing — comfortable on the free tier.

Bucket creation is a manual step in the Supabase dashboard, documented in the
README, because the storage API for bucket creation needs privileges the
service-role key may not carry.

---

## 5. AI commentary

### 5.1 Shape

`src/lib/ai/commentary.ts` makes **exactly one** call per day:

- Model `claude-opus-5` via `@anthropic-ai/sdk`.
- `output_config.format` with a Zod schema, through `client.messages.parse()`,
  so the response is validated rather than parsed by hand.
- `output_config.effort: "low"`. Low effort on Opus 5 is strong, and this is an
  interpretation task over numbers already computed — not a reasoning problem.
  It also keeps the call inside the preparation phase's budget.
- No `temperature`, `top_p` or `top_k` — Opus 5 rejects them with a 400.
- Thinking is left at its default (on) rather than disabled; disabling it on
  Opus 5 carries documented failure modes and buys nothing here.

Returns `{ marketRead: string; perStock: Record<string, string> }`, or **null**
on any failure. A failed call omits the commentary blocks; it never fails the
digest.

### 5.2 Grounding — the rule that matters

The model receives **only numbers this system computed**: the index readings
from `getIndices()`, and for each pick its score, factor breakdown, price,
valuation, technical levels and momentum. It has no tools, no web access, and
no market data beyond that payload.

Two constraints are stated in the system prompt and enforced by review:

1. **It may not introduce a figure that is not in its input.** Its job is to
   interpret the supplied numbers, never to supply new ones. A model-invented
   price or percentage in a financial email is the worst failure this feature
   can produce, and it would be invisible to every automated check.
2. **It describes what the data shows; it does not recommend action.** "Sitting
   at the lower channel rail with margins expanding" is a description. "Buy
   this" is advice. This email goes to real traders under the user's name, and
   the app's existing disclaimer — *Fundamental signals only — not investment
   advice* — stays prominent in v2.

A post-generation check scans the returned prose for numeric tokens that do not
appear in the input payload and drops the commentary if any are found. This is
a coarse guard, not a proof, and it is documented as such: it catches an
invented `$412.50`, not a misdescribed trend.

### 5.3 Cost

One call, roughly 3K input and 1.5K output, at Opus 5's $5/$25 per MTok:
about **$0.05 a day, $1.50 a month**. Cost is not a consideration; the strongest
model is the right choice.

---

## 6. Preparation phase and persistence

### 6.1 Migration `0030_digest_prep.sql`

```
screener_digest_prep
  id            uuid PK
  prep_on       date NOT NULL UNIQUE   -- Eastern date; the idempotency key
  picks         jsonb                  -- scored picks, chart URLs attached
  market_read   text                   -- AI market commentary, nullable
  per_stock     jsonb                  -- symbol → AI read, nullable
  chart_count   integer NOT NULL DEFAULT 0
  ai_ok         boolean NOT NULL DEFAULT false
  created_at    timestamptz NOT NULL DEFAULT now()
  updated_at    timestamptz NOT NULL DEFAULT now()
```

Same conventions as 0026 and 0029: uuid PK, timestamptz defaults, the shared
`set_updated_at` trigger, named constraints, idempotent, no RLS.

`UNIQUE (prep_on)` makes preparation idempotent per Eastern day. Unlike
`screener_digest_sends`, preparation **upserts** — re-running it on the same day
is a legitimate retry that should overwrite, because nothing has been mailed.

### 6.2 Where it runs

A new `prepareDigest()` in `src/lib/digest.ts`, called from `/api/ingest`'s GET
handler **after** `publish()` and the existing cache warm, wrapped so that a
preparation failure cannot fail the ingest that already succeeded. It is
bounded by its own deadline (20s) inside the route's 60s, on the same pattern
the existing `warmTechnicals` uses.

Order within preparation: score → render and upload charts → AI call → upsert.
The row is written even when charts or AI failed, carrying whatever succeeded,
so the digest always has something to read.

### 6.3 Reading it

`/api/digest` reads the row for today's Eastern date. Three cases:

- **Fresh row present** → use it. This is the normal path.
- **Row absent or from an earlier date** → fall back to `buildSelection()`
  inline, exactly as v1, with no charts and no commentary.
- **Row present but partial** → use what it has; missing pieces degrade.

The digest route's existing structure — clock guard, `RESEND_API_KEY` check,
day claim, release-on-failure — is unchanged.

---

## 7. The v2 email

600px, table-based, inline CSS, no SVG, no script, light palette — every v1
markup constraint still applies, because the medium has not changed.

Structure:

1. **Header** — brand bar, the Eastern date, and a compact index strip:
   S&P 500, Nasdaq and VIX with YTD and P/E from `indices.ts`.
2. **Market read** — the AI's paragraph, in a distinct panel, labelled as
   generated commentary rather than presented as editorial.
3. **Greeting** — `Good morning, {first}`. Personalization is the name only:
   subscriber tenure and a digest number were an embellishment in an earlier
   draft of this spec, are not derivable from `DigestRecipient`, and were not
   part of the request. Dropped rather than built.
4. **Pick cards**, ranked. Each carries:
   - rank, logo, symbol, company name, and the score meter;
   - **the chart image**, full card width, with `alt` text naming the symbol so
     a blocked image still reads;
   - a **four-block metrics grid** — valuation (trailing/forward P/E, PEG, EPS
     CAGR), margins (net/gross/operating, ROI), momentum (1d/1w/1m, 52-week
     range, % from ATH), earnings (YoY, NTM, last surprise);
   - **technical levels** — channel rails as prices, the Fib ladder with prices,
     unfilled gaps, SMA-150 distance in both percent and dollars;
   - the AI's one-line read on that stock;
   - the deterministic factor breakdown, retained from v1.
5. **Footer** — methodology, the unchanged disclaimer, unsubscribe, and the
   **TripleQ Group** signature.

Every colour pair must clear WCAG AA 4.5:1, verified by computation as in v1.

---

## 8. Feature flag and safety

`DIGEST_TEMPLATE` selects the renderer: `v1` (default, current behaviour) or
`v2`. Unset means v1 — the flag fails safe, so a deploy that forgets it cannot
change what subscribers receive.

`renderDigest()` keeps its signature and dispatches internally, so no caller
changes and the flag cannot be half-applied.

During development, `/api/digest?force=1` delivers only to `DIGEST_TEST_EMAIL`.
Its behaviour is unchanged and it remains the only path used for review.

---

## 9. Files

New:

```
supabase/migrations/0030_digest_prep.sql
src/lib/chart/render.ts            PNG renderer (pure given bars; no I/O)
src/lib/chart/store.ts             Supabase Storage upload + prune
src/lib/ai/commentary.ts           the single grounded Claude call
src/lib/ai/prompt.ts               system prompt + payload builder (pure)
src/lib/email/render-v2.ts         the v2 template
src/lib/email/primitives-v2.ts     index strip, metrics grid, levels table
scripts/preview-digest-v2.ts       renders v2 to a file
```

Changed:

```
src/lib/derive.ts             + priceChangePct, fiftyTwoWeekRange, epsSurprisePct
src/lib/technicals.ts         + fullRange on Technicals
src/lib/score.ts              ScoreInput/ScoredPick widened (carried, not scored)
src/lib/digest.ts             + prepareDigest, + readPrep
src/app/api/ingest/route.ts   + bounded preparation phase after publish
src/app/api/digest/route.ts   read prep row; fall back inline when absent
src/lib/email/render.ts       dispatch on DIGEST_TEMPLATE
scripts/test-signals.ts       + derive, prompt-builder and grounding-guard tests
package.json                  + @napi-rs/canvas, @anthropic-ai/sdk, preview script
.env.example, README.md       new env vars, bucket setup, the two-phase pipeline
```

---

## 10. Environment

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | The commentary call. Unset ⇒ commentary skipped, digest still sends. |
| `DIGEST_TEMPLATE` | `v1` (default) or `v2`. |
| `SUPABASE_STORAGE_BUCKET` | Defaults to `digest-charts`. |

Manual setup: create the public `digest-charts` bucket in Supabase, and set
`ANTHROPIC_API_KEY` in Vercel.

---

## 11. Testing

- `scripts/test-signals.ts` gains: the three new derive helpers at their
  boundaries; `fullRange` over a known series; the prompt payload builder
  (every number the model receives must be traceable to an input); the
  grounding guard (a payload with an invented figure is rejected, a clean one
  passes); and the score-invariance assertion proving the widened `ScoreInput`
  moves no score.
- `scripts/preview-digest-v2.ts` renders v2 to a file for visual review,
  including a chart, without network or database.
- A deployed `?force=1` send proves the native chart binary works on Vercel —
  the one thing no local test can establish.
- `pnpm typecheck`, `pnpm test`, `pnpm build` gate every task.

---

## 12. Rollout

1. Ship every task with `DIGEST_TEMPLATE` unset. Subscribers keep receiving v1.
2. Review v2 by `?force=1` to the test address until it is right.
3. Flip `DIGEST_TEMPLATE=v2` and redeploy.
4. If anything is wrong, unset it — the next digest is v1 again, no deploy of
   code required beyond the env change.
