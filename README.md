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

No RLS/auth/storage setup needed.

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
run without it (`/api/ingest` tolerates it being unset; `/api/digest` does
not, because it spends money on a Yahoo fan-out and a real Resend send).

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

### Two crons, one send
`vercel.json` schedules `/api/digest` at both **10:00 and 11:00 UTC**, every
day. Eastern time moves with DST, so on any given day exactly one of those two
UTC times is 06:00 ET: 10:00 UTC in summer (EDT), 11:00 UTC in winter (EST).
The route's hour guard discards whichever run lands at the wrong Eastern hour;
the one that lands at 06:00 ET (or the 07:00 ET recovery hour, for a cron that
fires late) claims the day and sends. Net: one send per Eastern day, at 6 AM,
year-round, from a scheduler that only understands UTC.

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
