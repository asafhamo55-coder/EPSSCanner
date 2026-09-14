# TripleQ Daily Maily — design

A personalized daily email, sent at **06:00 America/New_York**, listing the up-to-ten
watchlist stocks that pass a hard entry gate and score highest on a composite
0–100 model. Subscribers self-register through a new sidebar tab with first name,
last name and email, and confirm by clicking a link.

Status: approved 2026-09-14. Implementation plan follows this document.

---

## 1. Scope

In scope:

- A pure scoring engine (`src/lib/score.ts`) — gates plus a weighted 0–100 score.
- A subscriber store, double opt-in confirmation, and one-click unsubscribe.
- A "Daily Maily" tab in the sidebar with the signup form and a live preview of
  today's picks.
- An HTML email renderer with table/CSS mini-charts, and a Resend send adapter.
- A cron-driven digest route that refreshes data if needed, builds, and sends.

Out of scope:

- Authentication, accounts, or per-subscriber watchlists. The digest is the same
  list of stocks for everyone; only the greeting is personalized.
- Any change to the five-signal `buildScorecard` engine or the ingest pipeline's
  behaviour beyond its cron time.
- Sending to anyone who has not confirmed.

---

## 2. The scoring model

Named the **TripleQ Score**. Lives in `src/lib/score.ts`: pure functions, no I/O,
no React, verified in `scripts/test-signals.ts` — the same shape as `signals.ts`
and `technicals.ts`.

### 2.1 Inputs

One `ScoreInput` per ticker, assembled from data the app already has:

| Field | Source |
|---|---|
| `marketCap` | `valuation.marketCap` (snapshot) |
| `yoyPct`, `yoyState` | `scorecard.yoy` |
| `ntmPct`, `ntmState` | `scorecard.fwd` |
| `epsCagr5yr` | `trailingPe / peg5yr` |
| `price` | `valuation.price` |
| `sma150` | live Yahoo, `liveSma150` |
| `allTimeHigh` | live Yahoo, `liveAth` |
| `technicals` | live Yahoo, `liveTechnicals` → `analyze()` |

### 2.2 Gates

A ticker must pass **every** gate. Any `null` input fails its gate — an unknown
value is never treated as a pass.

| # | Gate | Rule |
|---|---|---|
| 1 | Mega cap | `marketCap >= 500e9` |
| 2 | Green YoY EPS | `yoyState !== 'na' && yoyPct > 0` |
| 3 | Green NTM EPS growth | `ntmState !== 'na' && ntmPct > 0` |
| 4 | Green EPS CAGR 5yr expected | `epsCagr5yr > 0` |
| 5 | Below all-time high | `price < allTimeHigh` |

`GateResult` records each gate's pass/fail plus the value that decided it, so the
preview page and any future debug view can explain an exclusion.

### 2.3 Factors

100 points across five factors. Every factor returns `0` when its input is
missing — absent signal is not a positive signal, consistent with
`scoreSignals()` in `technicals.ts`.

| Factor | Points | Curve |
|---|---|---|
| Growth engine | 30 | Three sub-scores of 10: `yoyPct`, `ntmPct`, `epsCagr5yr`, each `10 * clamp(g / 30, 0, 1)` where `g` is percent growth. Full credit at +30%. |
| SMA 150 proximity | 20 | `d = abs((price - sma150) / sma150) * 100`; `20 * clamp(1 - d / 15, 0, 1)`. Peaks on the SMA, zero at ±15%. |
| Tunnel position | 20 | `20 * (1 - clamp(positionPct, 0, 100) / 100)`. Channel low = 20, channel high = 0. `positionPct` may fall outside 0–100, hence the clamp. |
| Golden zone | 15 | From the close's retracement ratio `r`: full 15 for `0.5 <= r <= 0.618`; linear taper to 0 at `r = 0.236` below the band and `r = 0.786` above; 0 outside `[0.236, 0.786]`. |
| ATH drawdown | 15 | From `dd = abs(pctFromAth)`: 0 at `dd = 0`, ramping to full 15 across `8 <= dd <= 25`, holding to `dd = 30`, tapering to 0 at `dd = 45`, and 0 beyond. Rewards a real pullback, not a broken trend. |

Weights and breakpoints are exported constants in one block at the top of the
file. Tuning is a one-line edit; nothing else reads a literal.

`retracementRatio(close, fib)` is a **new exported helper in
`src/lib/technicals.ts`**, placed next to `inGoldenZone()` which it generalises.
It returns where `close` sits on the swing as a 0–1 ratio measured the same
direction the Fib levels are (`rally`: measured down from the high; `decline`:
measured up from the low), or `null` when there is no Fib or the span is zero.
`inGoldenZone()` is rewritten to call it, so the two cannot drift apart.

### 2.4 Selection

`selectPicks(inputs)`:

1. Drop every ticker failing any gate.
2. Score the rest.
3. Drop anything scoring `< MIN_SCORE` (50).
4. Sort by score descending, tie-break on symbol ascending for determinism.
5. Take the first `MAX_PICKS` (10).

Fewer than ten qualifying names yields a shorter list. Zero qualifying names is a
legitimate outcome and the email renders an explicit empty state — the list is
never padded with stocks that failed the bar.

Each pick carries a `reasons: string[]` — short plain-English phrases derived
from its strongest factors ("sitting 1.2% from its 150-day average", "bottom
third of its regression channel") for the "why it ranked here" line.

### 2.5 Shared derivations

`epsCagr5yr` and `pctFromAth` are currently computed inline in `toRow()` in
`src/app/page.tsx`. The scorer needs both. Rather than duplicate the formulas,
they move to exported helpers in `src/lib/derive.ts`, and `toRow()` is changed
to call them. One definition, three consumers (dashboard, scorer, email).

---

## 3. Data model

New migration `supabase/migrations/0029_subscribers.sql`. Conventions follow
0026: uuid PKs, `timestamptz` defaults, `set_updated_at` trigger, CHECK
constraints, partial indexes, idempotent (`IF NOT EXISTS`), no RLS — all access
is server-side through the service-role client.

### `screener_subscribers`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `email` | text NOT NULL UNIQUE | stored lowercased and trimmed by the app |
| `first_name` | text NOT NULL | |
| `last_name` | text NOT NULL | |
| `status` | text NOT NULL DEFAULT `'pending'` | CHECK in `('pending','confirmed','unsubscribed')` |
| `confirm_token` | text UNIQUE | nulled once confirmed |
| `unsubscribe_token` | text NOT NULL UNIQUE | stable for the row's life |
| `confirmed_at` | timestamptz | |
| `unsubscribed_at` | timestamptz | |
| `created_at` / `updated_at` | timestamptz NOT NULL DEFAULT now() | |

Partial index on `(status)` where `status = 'confirmed'` — the send query's only
filter.

### `screener_digest_sends`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `sent_on` | date NOT NULL UNIQUE | the **Eastern** calendar date; the idempotency key |
| `recipient_count` | integer NOT NULL DEFAULT 0 | |
| `pick_count` | integer NOT NULL DEFAULT 0 | |
| `picks` | jsonb | the scored picks as sent, for audit and for re-rendering |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

The UNIQUE on `sent_on` is what makes a double-fired or retried cron harmless:
the insert is attempted **before** any mail goes out, and a unique violation
means today's digest already went and the handler exits.

---

## 4. Timing and the digest route

### Crons (`vercel.json`)

```jsonc
{ "path": "/api/ingest", "schedule": "30 9 * * *" },   // 04:30 EST / 05:30 EDT
{ "path": "/api/digest", "schedule": "0 10,11 * * *" } // one of these is 06:00 ET
```

A single `/api/digest` entry with a two-hour list avoids relying on Vercel
accepting duplicate paths. Both fire well before the 09:30 ET open, and the
ingest cron moves earlier (from 11:00 UTC) so the refresh is finished before the
digest builds.

### `GET /api/digest`

Guarded by `CRON_SECRET` exactly like `/api/ingest`. `maxDuration = 60`.

1. **Hour guard.** Read the current hour in `America/New_York` via
   `Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false })`.
   Proceed only when the hour is `6` or `7`; otherwise return 200 with
   `{ skipped: 'off-hour' }`. Hour 7 is the late-fire recovery path — on a
   summer day the 10:00 UTC run already sent at 06:00 ET, so step 3 stops the
   11:00 UTC run; on a winter day 10:00 UTC lands at 05:00 ET and is skipped
   here, and 11:00 UTC lands at 06:00 ET and sends. Net effect: exactly one send
   per Eastern day, at 6 AM ET, year-round.
2. **Freshness.** Read the newest `as_of` across valuation snapshots. If it is
   not from today (ET), call `ingestAllActive()` first, then invalidate caches.
   The `publish()` helper currently private to `src/app/api/ingest/route.ts` is
   exported from a shared module (`src/lib/publish.ts`) and both routes import
   it, so the two cannot drift. The email must never be built from yesterday's
   numbers because the ingest cron failed.
3. **Claim the day.** Insert `screener_digest_sends` for today's ET date. A
   unique violation returns 200 with `{ skipped: 'already-sent' }` and nothing
   is sent.
4. **Build.** `getWatchlist()` → assemble `ScoreInput`s (adding `liveTechnicals`
   per symbol, bounded by the same concurrency ceiling `queries.ts` uses) →
   `selectPicks()`.
5. **Send.** Load confirmed subscribers, render one personalized HTML body each,
   send through the Resend adapter in batches.
6. **Record.** Update the claimed row with `recipient_count`, `pick_count` and
   `picks`. Return a JSON summary.

`?force=1` (still behind `CRON_SECRET`) bypasses the hour guard and the
already-sent guard and sends **only** to a `DIGEST_TEST_EMAIL` address, for
verifying a real send without mailing the list.

---

## 5. Sending

`src/lib/email/send.ts` — a small interface (`sendBatch(messages)`) with a
Resend implementation calling `POST https://api.resend.com/emails/batch` via
`fetch`. No new npm dependency; the adapter shape mirrors `src/market-data` so a
different provider is a new file, not a rewrite.

- From: `TripleQ Group <daily@tripleqgroup.com>` (`DIGEST_FROM` env var, with
  that as the default). Requires the domain verified in Resend via DNS.
- Batches of 100 (Resend's cap), issued sequentially with a short delay to stay
  under the account's request-rate limit.
- `List-Unsubscribe` and `List-Unsubscribe-Post` headers on every message, so
  Gmail shows its native unsubscribe control.
- A per-batch failure is logged and does not abort the remaining batches; the
  route reports how many succeeded.
- When `RESEND_API_KEY` is unset the adapter no-ops and logs, so local runs and
  mock-mode deploys cannot accidentally send.

---

## 6. The email

`src/lib/email/render.ts` — `renderDigest({ subscriber, picks, asOf })` returning
`{ subject, html, text }`. Pure; no I/O; takes everything it needs as arguments
so `scripts/preview-digest.ts` can render it to a file for design iteration
without touching the network.

Constraints that drive the markup: email clients strip `<style>` blocks
unreliably, ignore flexbox and grid, run no JavaScript, and Gmail strips inline
SVG. So: **nested tables, inline CSS, 600px fixed width, light palette, no
external CSS, no SVG, no script**. Every "chart" is built from table cells with
background colours and percentage widths.

Structure:

1. **Header** — brand gradient bar, the "Q" mark, "TripleQ Daily Maily", the
   Eastern date.
2. **Greeting** — `Good morning, {first_name}` and a one-line summary
   ("3 of 61 watchlist names cleared the gate this morning").
3. **Pick cards**, ranked. Each carries:
   - rank badge, company logo (the Parqet → FMP URLs `WatchlistTable` already
     uses; remote images, which Gmail proxies), symbol and company name;
   - the **TripleQ Score** as a number and a filled meter bar;
   - price, market cap, trailing P/E;
   - **% vs SMA 150** — a horizontal bar with a centre zero marker;
   - **tunnel position** — a low→high track with the current position marked;
   - **golden zone** — a 0.236→0.786 band with the golden 0.5–0.618 segment
     highlighted and the close marked;
   - **ATH drawdown** — a bar showing distance below the all-time high;
   - green/red chips for YoY EPS, NTM growth, EPS CAGR 5yr;
   - a "why it ranked here" line from `reasons`;
   - a link through to `/ticker/{symbol}` for the full technical chart.
4. **Empty state** when no stock cleared the gate — says so plainly and explains
   the criteria, rather than sending a blank email or lowering the bar.
5. **Footer** — the methodology in two sentences, "Fundamental signals only —
   not investment advice.", the unsubscribe link, and the **TripleQ Group**
   signature.

Icons are emoji, not images, so nothing depends on a remote asset loading.

A plain-text alternative is generated from the same data for clients that
refuse HTML.

The mini-chart colours and scales follow the `dataviz` skill; the implementer
loads it before writing any of the bar/meter markup.

---

## 7. Signup surface

**`/daily`** (new route, new sidebar entry "Daily Maily" with lucide `Mail`):

- `PageHeader` explaining what the digest is and when it arrives.
- `SubscribeForm` — first name, last name, email. Client component calling a
  `subscribeAction` server action; `zod` validates; the form reports success,
  duplicate, and error states through the existing `Toast`.
- A preview section rendering **today's actual picks** with the app's own
  components (not the email HTML), so the page has substance even before you
  subscribe, and so the model's output is visible and checkable in the UI.

**Server action `subscribeAction`** (in `src/app/actions.ts`, alongside the
existing actions):

- Normalises email to lowercase/trimmed; validates shape with `zod`.
- Upserts on `email`. A `pending` row re-sends the confirmation. A `confirmed`
  row reports "already subscribed" — it does not reset the row. An
  `unsubscribed` row is reactivated back to `pending` and re-confirms.
- Generates tokens with `crypto.randomUUID()`.
- Sends the confirmation email through the same send adapter.
- Returns the existing `ActionResult` shape.
- Never reveals whether an address was already on the list in a way that leaks
  it — the success copy is the same either way ("Check your inbox to confirm").

**`GET /api/subscribe/confirm?token=…`** — flips `pending` → `confirmed`, sets
`confirmed_at`, clears `confirm_token`, redirects to `/daily?confirmed=1`. An
unknown or already-used token redirects to `/daily?confirmed=0` rather than
erroring.

**`GET /api/subscribe/unsubscribe?token=…`** and the matching `POST` (for
`List-Unsubscribe-Post`) — sets `unsubscribed`, `unsubscribed_at`, redirects to
`/daily?unsubscribed=1`.

Rate limiting is deliberately out of scope: the double opt-in already means an
unconfirmed address never receives the digest, which is the abuse the form could
otherwise enable.

---

## 8. Files

New:

```
supabase/migrations/0029_subscribers.sql
src/lib/score.ts                         gates + weights + selectPicks (pure)
src/lib/derive.ts                        epsCagr5yr / pctFromAth, shared
src/lib/subscribers.ts                   subscriber reads/writes
src/lib/email/send.ts                    Resend adapter behind an interface
src/lib/email/render.ts                  HTML + text digest renderer
src/lib/email/confirm.ts                 confirmation email renderer
src/app/daily/page.tsx                   the new tab
src/components/SubscribeForm.tsx         the signup form
src/components/DigestPreview.tsx         today's picks, in-app rendering
src/lib/publish.ts                       revalidate helper, shared with ingest
src/app/api/digest/route.ts              the 6 AM ET cron target
src/app/api/subscribe/confirm/route.ts
src/app/api/subscribe/unsubscribe/route.ts
scripts/preview-digest.ts                renders the email to a file
```

Changed:

```
src/lib/technicals.ts        + retracementRatio(), inGoldenZone() reuses it
src/app/api/ingest/route.ts  publish() moves to src/lib/publish.ts

src/app/page.tsx             toRow() uses src/lib/derive.ts
src/app/actions.ts           + subscribeAction
src/components/ScreenerSidebar.tsx   + Daily Maily nav item
scripts/test-signals.ts      + score engine + selection tests
vercel.json                  ingest moves to 09:30 UTC, digest added
package.json                 + preview:digest script
.env.example, README.md      new env vars and the digest section
```

---

## 9. Environment

| Var | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend API key. Unset = send layer no-ops. |
| `DIGEST_FROM` | Defaults to `TripleQ Group <daily@tripleqgroup.com>`. |
| `NEXT_PUBLIC_SITE_URL` | Absolute base for confirm/unsubscribe/ticker links in email. |
| `DIGEST_TEST_EMAIL` | Sole recipient when `/api/digest?force=1` is used. |
| `CRON_SECRET` | Already exists; now also guards `/api/digest`. |

Manual setup outside the codebase: verify `tripleqgroup.com` in Resend (DNS
records), and set the four new vars in Vercel.

---

## 10. Testing

- `scripts/test-signals.ts` grows a section for `src/lib/score.ts`: each gate
  rejecting on its own; each factor's curve at its breakpoints and outside its
  domain; missing inputs scoring zero; the 50-point cutoff; ordering and the
  10-pick cap; the empty result. Plus `retracementRatio()` on both rally and
  decline swings, and `inGoldenZone()` still agreeing with its old behaviour.
- `scripts/preview-digest.ts` renders the email from fixture picks and from live
  picks, for visual review in a browser.
- `/api/digest?force=1` proves the real send path end to end against
  `DIGEST_TEST_EMAIL` without touching the list.
- `pnpm typecheck` and `pnpm build` gate the branch.

---

## 11. Open items

- **Seed addresses.** The initial list of emails to insert as pre-confirmed has
  not been provided yet. Until it is, the list is whoever confirms through the
  form. Seeding is a one-off SQL insert, not code.
