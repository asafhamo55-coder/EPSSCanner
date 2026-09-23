# EPS Screener

A fundamental **EPS screener** — track a watchlist of tickers and score each one
against a 5-step methodology: P/E reasonableness, 5-year fundamentals trend, YoY
EPS growth, QoQ delta trend (accel/decel), and forward growth via the P/E ratio.

Standalone **Next.js 15 + Supabase** app. Free, single shared watchlist — no
auth, no billing, no RLS. Add any ticker; data comes from a pluggable provider
(FMP for live data, a deterministic mock for zero-key demos).

> Self-contained: there are no external workspace dependencies. The design
> system lives in `src/ui`, the data adapter in `src/market-data`.

---

## Quick start (local)

```bash
pnpm install          # or npm install
cp .env.example .env.local
# edit .env.local — for a zero-key demo, leave MARKET_DATA_PROVIDER=mock
pnpm dev              # http://localhost:3000
pnpm test             # verify the signals engine against the NVDA fixture
```

Mock mode needs **no** Supabase or API keys to render and compute signals, but
adding/persisting tickers requires a Supabase project (below).

---

## Deploy

### 1. Supabase — apply the schema
In the SQL editor of your project (`oyhcchumlizmhwvjjlrl`), run in order:
1. `supabase/migrations/0026_screener.sql`
2. `supabase/migrations/0027_screener_views.sql`
3. `supabase/migrations/0028_peg.sql` — adds the 5-yr-expected PEG ratio to
   valuation snapshots.
4. `supabase/migrations/0029_subscribers.sql` — required for the TripleQ Daily
   Maily (subscribers + the per-day send ledger; see below).
5. `supabase/migrations/0030_digest_prep.sql` and
   `supabase/migrations/0031_digest_prep_counts.sql` — required for Daily
   Maily v2 (the preparation table; see below). Both are additive and
   idempotent — apply them even if you aren't turning v2 on yet.

No RLS/auth setup needed. Daily Maily v2 also needs one manual **Storage**
step (creating a public bucket) — see Daily Maily v2 → Manual setup below.

### 2. Vercel — import the repo
- **Framework preset:** Next.js (root directory `/`).
- **Environment variables:**

| Var | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://oyhcchumlizmhwvjjlrl.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` (server-only) |
| `MARKET_DATA_PROVIDER` | `fmp` for live data, or `mock` to demo |
| `MARKET_DATA_FMP_API_KEY` | free key from financialmodelingprep.com (only for `fmp`) |
| `CRON_SECRET` | **required.** Random string; protects `/api/ingest` and `/api/digest`. `/api/digest` fails closed (401) with no key set — without this, the digest endpoint is disabled |
| `RESEND_API_KEY` | Resend API key. Unset = the send layer no-ops and logs instead of mailing anyone |
| `DIGEST_FROM` | Sender identity, e.g. `TripleQ Group <daily@tripleqgroup.com>`. Requires the domain verified in Resend |
| `NEXT_PUBLIC_SITE_URL` | Absolute origin for links inside emails, e.g. `https://tripleqgroup.com`. No trailing slash — should share a domain with `DIGEST_FROM` in production (mismatched sender/footer domains read as untrustworthy and hurt deliverability) |
| `DIGEST_TEST_EMAIL` | Sole recipient of `GET /api/digest?force=1`, for verifying a real send |
| `DIGEST_TEMPLATE` | `v1` (default) or `v2`. Leave unset until v2 has been reviewed — see Daily Maily v2 below |
| `SUPABASE_STORAGE_BUCKET` | Chart-image bucket name. Defaults to `digest-charts` if unset |

Deploy. The app is live.

### 3. Daily auto-refresh and the morning digest
`vercel.json` registers two **Vercel Cron** jobs:
- `/api/ingest` at 09:30 UTC every day — re-pulls fundamentals for the whole
  watchlist.
- `/api/digest` at 11:00 UTC every day — the TripleQ Daily Maily (see below).

**Why 11:00 UTC, and what it means for delivery time.** Cron speaks only UTC,
but Eastern moves with DST, so one fixed hour cannot be 06:00 ET all year.
11:00 UTC is **07:00 ET in summer (EDT)** and **06:00 ET in winter (EST)**.
Both land inside the route's 6-or-7 clock guard, so a digest goes out every
day of the year, always well before the 09:30 open.

10:00 UTC was rejected: its winter fire lands at 05:00 ET, outside the guard,
which would silently stop the digest for the four months of EST.

A **Vercel Hobby** plan caps crons at one run per day, which is what forces the
single fire. On **Pro**, change the digest schedule to `0 10,11 * * *`: both
hours fire, the clock guard discards the wrong one, the day-claim discards the
duplicate, and delivery becomes exactly 06:00 ET year-round. No code change —
only `vercel.json`.

Vercel automatically sends `CRON_SECRET` as a Bearer token on both. Nothing
else to wire — but you must set it: `/api/digest` returns 401 and refuses to
run without it, because it spends money on a Yahoo fan-out and a real send
via Gmail SMTP. `/api/ingest` tolerates it being unset for its own core job
(re-pulling public fundamentals, which costs nothing) — but it also runs
preparation for the Daily Maily v2 email (chart rendering and a Storage
upload), and that specific step only runs when `CRON_SECRET` is set, so an
unauthenticated `/api/ingest` request can never trigger it either.

> **Note on live data:** FMP's free tier doesn't expose forward P/E, so **Step 5
> shows N/A** on live data until you add a forward-EPS source or upgrade FMP.
> Mock mode exercises all five steps.

---

## How it works

```
src/
├── app/                      Next.js App Router
│   ├── page.tsx              dashboard — StatCards + sortable scorecard table
│   ├── ticker/[symbol]/      detail — Tabs → scorecard / ECharts charts / financials
│   ├── api/ingest/route.ts   idempotent ingest (POST one/all, GET = cron)
│   └── actions.ts            server actions: add / refresh / remove
├── lib/
│   ├── signals.ts            the 5-step calc engine (pure, fully tested)
│   ├── ingest.ts             provider → Supabase upserts (idempotent)
│   ├── queries.ts            reads + runs the engine on read
│   └── db.ts                 service-role Supabase client
├── market-data/              DataProvider adapter (FMP + deterministic mock)
└── ui/                       vendored design system (AppShell, Card, chips…)

supabase/migrations/          0026 (tables) + 0027 (views)
```

- **Idempotent ingest:** upserts on `(ticker_id, fiscal_period)` etc., so
  re-running never duplicates and estimates flip to actuals when earnings land.
- **One engine, every surface:** the dashboard, the detail page, and `pnpm test`
  all compute signals through `buildScorecard`, so they can't disagree.
- **Edge cases handled:** loss→profit `turnaround`, missing forward P/E → `n/a`,
  short history → `n/a` (never a misleading ratio).

## The 5 signals

| Step | Signal | Formula |
|---|---|---|
| 1 | P/E reasonableness | `20 ≤ trailing_pe ≤ 30`; premium flag if `> 30` |
| 2 | Fundamentals (5 yr) | revenue & net income strictly increasing |
| 3 | YoY EPS growth | `eps[Q] / eps[Q-4]` |
| 4 | QoQ delta trend | regression slope of recent `eps[i] − eps[i-1]` |
| 5 | Forward growth | `trailing_pe / forward_pe` (= `eps_fwd / eps_ttm`) |

Signals are shown for your own judgment — there is no buy/avoid verdict.

## TripleQ Daily Maily

A daily email digest of the watchlist, sent at exactly **6 AM America/New_York**
to everyone confirmed on the list — the ranked, scored picks that would have
been worth a second look before the open.

### What it sends, and when
`GET /api/digest` (the Vercel Cron target) scores the watchlist with the model
below and emails whichever names clear both the gates and the score floor,
ranked best first, capped at `MAX_PICKS` (10). If nothing clears the bar, the
email says so plainly rather than padding the list — see `MIN_SCORE` (50)
below.

**Entry gates** — binary; a name must pass every one or it is not in the
running, however well it scores elsewhere (`src/lib/score.ts`):

| Gate | Rule |
|---|---|
| Market cap | ≥ `MIN_MARKET_CAP` ($400B) |
| YoY EPS growth | positive |
| NTM EPS growth | positive |
| EPS CAGR (5yr, expected) | positive |
| Below the all-time high | trading below it |

**Factor weights** — continuous, sum to 100; a name that passes every gate
still needs `MIN_SCORE` (50) or better to be emailed (`src/lib/score.ts`
`WEIGHTS`):

| Factor | Weight |
|---|---|
| Growth engine (YoY, NTM, 5yr CAGR — averaged) | 30 |
| SMA 150 proximity | 20 |
| Tunnel position (regression channel) | 20 |
| Golden zone (retracement) | 15 |
| Room below the all-time high (drawdown) | 15 |

### One fire, the right hour
`vercel.json` schedules `/api/digest` at a single **11:00 UTC**, every day —
see Deploy → 3 above for why that hour (and not 10:00) was chosen: it's the
one UTC time that lands inside the route's 6-or-7 ET clock guard in both DST
states, so a Hobby plan's one-fire-per-day cron still sends every day of the
year. (This is a different split from the ingest/digest **pipeline** split
described in Daily Maily v2 below — that's about *what* each cron does, this
is about *when* the digest one fires.)

### Idempotency
Before any mail goes out, the route inserts a row into
`screener_digest_sends` keyed on the Eastern calendar date (`sent_on`). The
UNIQUE constraint on that column means a retried or double-fired cron loses
the race and exits without sending — the day is claimed before a single email
is built, let alone sent.

### Double opt-in
Signing up (at `/daily`) creates a `pending` row in `screener_subscribers` and
emails a confirm link. Clicking it flips the row to `confirmed`, and only
`confirmed` rows ever receive the digest — an address someone else typed in
never gets mail. Every digest email carries a working unsubscribe link, plus
the `List-Unsubscribe` / `List-Unsubscribe-Post` headers Gmail needs to show
its native one-click unsubscribe control; either path flips the row to
`unsubscribed`.

### Environment variables
| Var | Value |
|---|---|
| `RESEND_API_KEY` | Resend API key. Unset = the send layer no-ops and logs instead of mailing anyone |
| `DIGEST_FROM` | Sender identity, e.g. `TripleQ Group <daily@tripleqgroup.com>`. Requires the domain verified in Resend |
| `NEXT_PUBLIC_SITE_URL` | Absolute origin for links inside emails. No trailing slash |
| `DIGEST_TEST_EMAIL` | Sole recipient of `GET /api/digest?force=1`, for verifying a real send |

### Migration
`supabase/migrations/0029_subscribers.sql` (`screener_subscribers` +
`screener_digest_sends`) must be applied before this works — see Deploy →
Step 1.

---

## Daily Maily v2

A redesign of the digest for expert traders: a real price chart per pick, a
composed market and per-stock read, and a deeper metrics/technicals
breakdown — layered on top of everything above, behind a flag, so the live
list is never exposed to work in progress.

### Why the pipeline is split across two crons

**This is a hard platform constraint, not a style choice — do not "simplify"
it back to one cron.** A **Vercel Hobby** plan allows **2 cron jobs** and
**60 seconds per function**. Both cron slots are already spoken for
(`/api/ingest` at 09:30 UTC, `/api/digest` at 11:00 UTC), so there is no third
slot to add. Ingesting ~70 tickers, rendering a chart per pick, uploading
each to Storage and sending to every subscriber does not fit in one
60-second function without real risk of a timeout *mid-send* — the worst
failure this system has, because the day is already claimed, some
subscribers are mailed, and the rest silently aren't.

So the expensive work is pulled out of the send path entirely and moved
earlier, into the cron that already runs 90 minutes before it:

```
09:30 UTC  /api/ingest   ingest → publish → PREPARE (score, render charts,
                         compose the market read) → persist to
                         screener_digest_prep
11:00 UTC  /api/digest   read today's prepared row → render per-subscriber
                         HTML → send
```

`prepareDigest()` (`src/lib/digest.ts`) runs as a bounded, best-effort phase
appended to `/api/ingest` *after* its existing publish + cache warm, on its
own ~20s budget inside the route's 60s — a failure there cannot fail the
ingest that already succeeded. `/api/digest` no longer scores anything or
calls anything expensive; it reads one row (`readPrep`, scoped to today's
Eastern date) and sends.

### The degradation ladder

Every artifact `prepareDigest` produces is optional, and the digest is built
to use whatever exists rather than require all of it. In every one of these
cases the email still arrives — it only ever loses richness, never
correctness:

1. **No prep row** — preparation never ran, or the row on file is from an
   earlier Eastern date (stale). The digest falls back to scoring the
   watchlist inline, exactly as v1 did before this feature existed. No
   charts, no commentary — still sends.
2. **Prep row present but partial** — some of the row's fields are `null`.
   The digest uses whatever succeeded. A row with a market read but no
   charts is an expected, valid state, not a bug.
3. **Chart render fails** — including a native binary that fails to load at
   runtime (`@napi-rs/canvas` returns `null` rather than throwing on any
   failure). That pick's email falls back to the v1 CSS bar chart.
4. **Nothing scores** — `buildMarketRead` returns `null` only for an empty
   pick list, which is the same state that already means there is no email
   to build. Short of that it always produces a read, saying less when
   fields are missing (see The market read below).

### The public chart bucket

Chart PNGs are stored in a Supabase Storage bucket, `digest-charts` by
default (`SUPABASE_STORAGE_BUCKET` to rename it), keyed
`{easternDate}/{symbol}.png`, and it **must be public**. Mail clients fetch
embedded images unauthenticated — there is no mechanism to hand an email
client a token — and the content being served is a chart of public market
data, so there's nothing to protect. `pruneCharts` deletes anything older
than 30 days during preparation, keeping storage use small (~40 KB/chart ×
10 charts/day ≈ 12 MB standing).

Bucket creation is **manual** — see Manual setup below — because creating a
bucket needs dashboard-level privileges the service-role key doesn't
necessarily carry.

`screener_digest_prep` itself has no equivalent retention policy — it
accumulates one row per day, indefinitely, at roughly 10 KB/day (mostly the
`picks` jsonb column). Small, but the same unbounded-growth class as the
chart bucket above; nothing prunes it yet.

### Staying under Gmail's clipping limit

Gmail clips a message past 102,400 bytes and shows "[Message clipped] View
entire message". v2's first real render — five picks, full technical detail
on each — measured 114,976 bytes and would have arrived clipped.

`src/lib/email/compact.ts` closes that gap without dropping a figure: it
hoists font-family and tabular-nums into a `<style>` rule (safe — a client
that strips `<style>` just falls back to its default typeface) and, since
that alone wasn't enough to keep every scoring pick in full detail rather
than just the top few, generically hoists any OTHER style string that
repeats (a broader trade: an element it touches renders unstyled, not
misleadingly, if `<style>` is stripped — see the file's own doc comments for
the full reasoning). `renderDigestV2` then assembles the email adaptively:
full detail for as many picks as measure under a 96,000-byte budget, compact
rows (score, price, vs-SMA-150, channel position, retracement, drawdown,
still every number a reader acts on) for whatever doesn't fit — weighing the
actual finalised document each time, never predicting its size. In practice
this fits full detail for up to 9 picks; the rare 10-pick day gets 9 full
and 1 compact rather than risking a clip.

### The market read

`src/lib/market-read.ts` composes the market-wide paragraph and the
one-line read per pick. It is pure, synchronous and total: no network, no
API key, no cost, and no failure path — the only `null` it returns is for
an empty pick list.

**This used to be one `claude-opus-5` call per day, guarded at runtime by a
grounding check that scanned the generated prose for numbers it could not
trace back to the input.** The call was removed on 2026-09-17; the module
that replaced it builds every sentence directly out of fields already on
`ScoredPick` and `IndexCardData`. That turns the property the guard was
checking into a structural one — a figure that is never generated cannot be
fabricated — which is why no grounding guard exists any more. It is not a
check that was dropped; it is a check that no longer has anything to catch.

What it says, and where each figure comes from:

| Sentence | Source |
|---|---|
| Index performance, year to date | `IndexCardData.ytdPct` — indices with no YTD are dropped, never shown flat |
| How many names cleared every gate, and the score range | `ScoredPick.score` |
| How many trade below their 150-day average, how many are in the golden zone, the median drawdown | `vsSma150Pct`, `retracement`, `pctFromAth` |
| Per pick: position vs the average, band within the channel, distance off the high | `vsSma150Pct`, `positionPct`, `pctFromAth` |
| Per pick: EPS growth on three horizons | `yoyPct`, `ntmPct`, `epsCagr5yr` |

Two deliberate choices in the wording. The channel position is banded into
thirds rather than quoted as a percentage — the regression fit is a rough
read, and "31% up the channel" implies precision it does not carry (the
metrics grid still shows the exact figure). And every clause is emitted
only when the field behind it is present, so a pick with no technicals
contributes a shorter line, or none at all, instead of a half-formed
sentence.

The read describes what the data shows and never recommends action. The
app's existing disclaimer — *Fundamental signals only — not investment
advice* — stays prominent in v2.

### In the news

Each full-detail pick card carries up to 3 real, attributed news
headlines — title, a short excerpt, the outlet's name, a link back to the
original. Every field is exactly what the provider returned: nothing here
is generated, paraphrased, or extracted by an LLM. That constraint exists
for the same reason the market read above stopped being an
`claude-opus-5` call — generated prose about a real stock carries a
fabrication risk that raw provider data does not, and this feature was
designed from the start to never reintroduce that risk under a different
name.

The source is FMP's `/stable/news/stock` endpoint, fetched only for the
picks actually being emailed that morning — at most `MAX_PICKS`, never the
whole watchlist — during the same preparation phase that renders charts,
inside `prepareDigest`'s existing budget. Yahoo and the mock provider have
no equivalent and return `[]`. A pick with no available news simply shows
no section at all — never a placeholder like "no news today" — the same
degrade-not-fail rule the chart row and the market read already follow.
It needs no new migration: `news` rides inside the existing `picks` jsonb
column on `screener_digest_prep`, exactly as `chartUrl` already does.

The panel is full-card-only, omitted from compact rows. A compact row
exists specifically to protect Gmail's clipping limit on a rare
10-qualifying-pick day, and up to three headlines with excerpts and
attribution is real HTML weight — the same tier as the Fib ladder and gap
table, not the ~240-byte chart `<img>` tag that both card sizes can afford.

### Tiered ingest: not every ticker earns the full refresh

`ingestTicker` makes seven FMP requests per ticker (`/ratios-ttm`,
`/key-metrics-ttm`, `/quote`, `/analyst-estimates`, `/earnings`,
`/income-statement`, `/profile`). Across the full watchlist that is ~490
requests a day, and it exhausted FMP's quota outright — observed in
production as mega caps rejected on the CAGR gate for **no data**, not a
genuinely negative reading.

Most of the watchlist can never clear the market-cap gate regardless — a
$50B company is not crossing $400B overnight — so paying for its analyst
estimates and five years of income statements every morning bought nothing.
`ingestAllActive` (`src/lib/ingest.ts`) now tiers the refresh from
yesterday's own market cap (`screener_latest_valuation`, one query, not one
per ticker):

- **At or above `FULL_REFRESH_FLOOR`** (90% of `MIN_MARKET_CAP` — a company
  climbing toward the threshold is on the full path *before* it crosses, not
  the day it does) — the full seven-request refresh.
- **Below the floor** — `getValuationLight`: two FMP requests plus the
  already-free keyless Yahoo call. Enough to keep price, market cap, margins
  and the P/E family current, and to promote the name back to the full path
  the day it climbs. EPS history and annual financials are neither
  refetched nor overwritten on this path — the rows already on file stand.
- **Unknown cap** (never ingested) — full path. There is no basis for the
  cheap decision on a brand-new symbol.

The ingest cron's response reports `ingestLight` — how many tickers took the
cheap path that morning.

### Why a gate can be 'unknown', not just pass/fail

Every gate used to report only `passed: boolean`, and a missing reading
failed it exactly like a genuinely bad one — `isNum(x)` is false either way.
A rate-limited provider and a real negative EPS CAGR were therefore
indistinguishable in the output. `GateResult.state` (`src/lib/score.ts`) is
now `'pass' | 'fail' | 'unknown'` — `'unknown'` still does not pass a gate
(a name whose growth cannot be verified has no business in a list of
recommendations), but it is no longer silently reported as a real rejection.

`selectionFunnel()` uses this to answer "why is the pick list this size?" —
call `/api/digest?status=1` and read `funnel`: per-gate rejection counts,
how many are `failedMissingData`, and `amongMegaCaps.lostToMissingData` —
mega caps that might have qualified had the refresh been complete, as
opposed to names the $400B rule was always going to exclude.

### EPS CAGR fallback

`epsCagr5yr` ("EPS CAGR 5yr expected") is normally derived from Yahoo's PEG
ratio (`peg5yr`), but Yahoo has no PEG data for some real mega-cap names, so
`peg5yr` — and therefore `epsCagr5yr` — is legitimately `null` for them. As a
fallback, `forwardEpsCagr` (`src/lib/derive.ts`) computes a genuinely
different estimate directly from FMP's own consensus annual EPS estimates
(not a proxy for PEG, a separate calculation). It only activates when the
usable forward span is at least 3 years (`MIN_FORWARD_YEARS`) — a real
observed ticker had only 1 usable future year of estimates after filtering,
and labeling that a multi-year trend would have been misleading, so it
correctly yields nothing instead. Requires migration
`0032_eps_cagr_est.sql`.

**Only FMP's full-refresh path populates it.** `getValuationLight` (the
cheap tier tiered ingest uses for names nowhere near the market-cap gate —
see Tiered ingest above) doesn't fetch `/analyst-estimates` at all, and
Yahoo and the mock provider both hardcode `epsCagr5yrEst: null` — they have
no equivalent data. A ticker on the light path, or refreshed via
`MARKET_DATA_PROVIDER=yahoo`/`mock`, simply never gets this fallback; only
the PEG-based value can fill it there.

**Every surface reads the same decision.** `epsCagr5yrWithFallback`
(`derive.ts`) is the one place `epsCagr5yr(...) ?? epsCagr5yrEst` is
computed — `src/lib/digest.ts` and `src/app/page.tsx` both call it rather
than each inlining the `??` themselves, specifically so the dashboard table
and the daily email can't show a different CAGR for the identical ticker
(they did, briefly, in an earlier version of this fallback — see git
history if curious).

**It shares the same 0–30%-credit growth scale as the PEG-based value**
(`score.ts`'s `growthUnit`, full credit at `GROWTH_FULL_PCT`), despite being
a different calculation with a different typical range — a recovery-off-a-
depressed-base name (real example: base EPS 1.5 → terminal 6.5 over 4
years) computes to ~44% and clamps to full credit, while a typical
PEG-derived mega cap earns roughly half credit. Both are labeled identically
everywhere they appear. This is a known, accepted trade-off, not an
oversight — worth revisiting only if it visibly skews rankings in practice.

### The `@napi-rs/canvas` build dependency

`next.config.ts` sets `serverExternalPackages: ['@napi-rs/canvas']`. This
isn't optional config hygiene — `@napi-rs/canvas` ships a native `.node`
binary that Webpack cannot bundle; without this line the build fails
outright with a confusing "Unexpected character" error as Webpack tries to
parse the binary as JavaScript. If you ever see that build error, check this
line first.

### Environment variables

| Var | Value |
|---|---|
| `DIGEST_TEMPLATE` | `v1` (current CSS-bar template) or `v2`. **Unset means v1** — deliberately, so a deploy that forgets to set this cannot change what subscribers receive |
| `SUPABASE_STORAGE_BUCKET` | Bucket for chart PNGs. Defaults to `digest-charts` if unset |

### Manual setup (cannot be done from code)

1. Apply `supabase/migrations/0030_digest_prep.sql` **and**
   `supabase/migrations/0031_digest_prep_counts.sql` — see Deploy → Step 1.
2. In the Supabase dashboard, create a **public** Storage bucket named
   `digest-charts` (or match whatever `SUPABASE_STORAGE_BUCKET` is set to).
   It must be public — see The public chart bucket above for why.
3. Leave `DIGEST_TEMPLATE` unset until the v2 email has been reviewed (see
   Rollout below) — do not set it as part of this setup.

### Rollout

1. Ship every task with `DIGEST_TEMPLATE` unset. Subscribers keep receiving
   v1; nothing about their experience changes yet.
2. Review v2 by hitting `/api/digest?force=1&template=v2`, which sends only
   to `DIGEST_TEST_EMAIL` — rendered with v2 for that request only, without
   changing `DIGEST_TEMPLATE`. This is the step that actually makes v2
   reviewable: `template` is honoured ONLY when `force=1` is also set (see
   `resolveTemplateOverride` in `src/app/api/digest/resolve-template.ts`),
   specifically so a bare `?template=v2` can never redirect a real send. Keep
   hitting it with edits until it looks right — none of this touches what
   the 11:00 UTC cron sends.
3. Only once v2 looks right, flip `DIGEST_TEMPLATE=v2` in Vercel and
   redeploy. This is the one step that changes what the cron sends to all 13
   subscribers, and it should be the LAST step, after review — not a
   precondition for being able to review at all.
4. If anything is wrong in production, **unset `DIGEST_TEMPLATE`** — the next
   digest is v1 again. Reverting is an environment-variable change, not a
   code deploy.
