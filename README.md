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
3. `supabase/migrations/0029_subscribers.sql` — required for the TripleQ Daily
   Maily (subscribers + the per-day send ledger; see below).
4. `supabase/migrations/0030_digest_prep.sql` and
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
| `ANTHROPIC_API_KEY` | Daily Maily v2's AI commentary call. Unset = commentary skipped, digest still sends |
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
run without it, because it spends money on a Yahoo fan-out and a real Resend
send. `/api/ingest` tolerates it being unset for its own core job (re-pulling
public fundamentals, which costs nothing) — but it also runs preparation for
the Daily Maily v2 email (chart rendering, a Storage upload, and a paid
Claude call), and that specific step only runs when `CRON_SECRET` is set, so
an unauthenticated `/api/ingest` request can never trigger it either.

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
| Market cap | ≥ `MIN_MARKET_CAP` ($500B) |
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

A redesign of the digest for expert traders: a real price chart per pick,
AI-written market and per-stock commentary, and a deeper metrics/technicals
breakdown — layered on top of everything above, behind a flag, so the live
list is never exposed to work in progress.

### Why the pipeline is split across two crons

**This is a hard platform constraint, not a style choice — do not "simplify"
it back to one cron.** A **Vercel Hobby** plan allows **2 cron jobs** and
**60 seconds per function**. Both cron slots are already spoken for
(`/api/ingest` at 09:30 UTC, `/api/digest` at 11:00 UTC), so there is no third
slot to add. A single Claude call with thinking on can by itself take
30–60 seconds; stacking chart rendering, a Storage upload and the subscriber
send fan-out on top of that inside one 60-second function risks a timeout
*mid-send* — the worst failure this system has, because the day is already
claimed, some subscribers are mailed, and the rest silently aren't.

So the expensive work is pulled out of the send path entirely and moved
earlier, into the cron that already runs 90 minutes before it:

```
09:30 UTC  /api/ingest   ingest → publish → PREPARE (score, render charts,
                         one Claude call) → persist to screener_digest_prep
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
   The digest uses whatever succeeded. Charts with no commentary (or the
   reverse) is an expected, valid state, not a bug.
3. **Chart render fails** — including a native binary that fails to load at
   runtime (`@napi-rs/canvas` returns `null` rather than throwing on any
   failure). That pick's email falls back to the v1 CSS bar chart.
4. **AI commentary fails** — the Claude call errors, is refused, gets raced
   out by its own time budget, or comes back with a figure the grounding
   guard can't trace to the input. Commentary is omitted; nothing else in
   the email changes.

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

### AI commentary and its grounding rules

`src/lib/ai/commentary.ts` makes exactly **one** Claude call per day
(`claude-opus-5`, structured output via Zod, `effort: "low"`) to produce a
market-wide read and a one-line read per pick. It returns `null` on any
failure — missing key, API error, schema mismatch, or a grounding
violation — and a `null` commentary simply omits those blocks; it never
fails the digest.

The model is given **only numbers this system already computed** — index
readings, and per pick its score, factor breakdown, price, valuation,
technical levels and momentum — with no tools and no web access. Two rules
are enforced in the system prompt and by review:

1. **It may not introduce a figure that isn't in its input.** It interprets
   supplied numbers; it never supplies new ones. An invented price or
   percentage in a financial email is the worst thing this feature could
   produce, and no automated check downstream would catch it.
2. **It describes what the data shows; it does not recommend action.** The
   app's existing disclaimer — *Fundamental signals only — not investment
   advice* — stays prominent in v2.

A post-generation guard (`isGrounded` in `src/lib/ai/prompt.ts`) scans the
returned prose for numeric tokens that don't trace back to the input payload
and drops the commentary if any are found. **Be honest about what this
catches:** it's a coarse net for a fabricated number like an invented
`$412.50`, not a fact-checker. A real number from the payload attached to
the wrong claim — crediting the wrong stock, or calling a decline a rally —
passes it untouched.

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
| `ANTHROPIC_API_KEY` | The commentary call. Unset ⇒ commentary is skipped, digest still sends |
| `DIGEST_TEMPLATE` | `v1` (current CSS-bar template) or `v2`. **Unset means v1** — deliberately, so a deploy that forgets to set this cannot change what subscribers receive |
| `SUPABASE_STORAGE_BUCKET` | Bucket for chart PNGs. Defaults to `digest-charts` if unset |

### Manual setup (cannot be done from code)

1. Apply `supabase/migrations/0030_digest_prep.sql` **and**
   `supabase/migrations/0031_digest_prep_counts.sql` — see Deploy → Step 1.
2. In the Supabase dashboard, create a **public** Storage bucket named
   `digest-charts` (or match whatever `SUPABASE_STORAGE_BUCKET` is set to).
   It must be public — see The public chart bucket above for why.
3. Set `ANTHROPIC_API_KEY` in Vercel's project environment variables.
4. Leave `DIGEST_TEMPLATE` unset until the v2 email has been reviewed (see
   Rollout below) — do not set it as part of this setup.

### Rollout

1. Ship every task with `DIGEST_TEMPLATE` unset. Subscribers keep receiving
   v1; nothing about their experience changes yet.
2. Review v2 by hitting `/api/digest?force=1`, which sends only to
   `DIGEST_TEST_EMAIL`, until it looks right.
3. Flip `DIGEST_TEMPLATE=v2` in Vercel and redeploy.
4. If anything is wrong in production, **unset `DIGEST_TEMPLATE`** — the next
   digest is v1 again. Reverting is an environment-variable change, not a
   code deploy.
