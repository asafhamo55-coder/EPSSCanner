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
| `CRON_SECRET` | *(optional)* random string; protects `/api/ingest` |

Deploy. The app is live.

### 3. Weekly auto-refresh (built in)
`vercel.json` registers a **Vercel Cron** that GETs `/api/ingest` every Monday
11:00 UTC to re-pull fundamentals for the whole watchlist. If `CRON_SECRET` is
set, Vercel automatically sends it as a Bearer token. Nothing else to wire.

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
