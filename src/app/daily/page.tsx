import { Suspense } from 'react'
import { CloudOff, Mail } from 'lucide-react'
import {
  Alert,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
} from '@/ui'
import { getCachedSelection } from '@/lib/digest'
import { MAX_PICKS, MIN_MARKET_CAP, MIN_SCORE } from '@/lib/score'
import { SubscribeForm } from '@/components/SubscribeForm'
import { DigestPreview } from '@/components/DigestPreview'
import { WatchlistSkeleton } from '@/components/DashboardSkeletons'

// NOTE: no page-level `export const revalidate` here — `await searchParams`
// below (the confirmed/unsubscribed flags) forces this page dynamic, which
// makes a page-level revalidate dead code (confirmed by `pnpm build`: this
// route ships as `ƒ` with no revalidate window). The actual caching lives on
// the expensive part only — getCachedSelection() in src/lib/digest.ts wraps
// buildSelection() in unstable_cache — so the page stays dynamic for the
// cheap query-flag rendering while the ~172-Supabase-round-trip fan-out is
// still shared across requests.

async function TodaysPicks() {
  // buildSelection() (via getCachedSelection) deliberately THROWS on an
  // empty/unreadable watchlist — that's for /api/digest's benefit, whose
  // releaseDigestDay path needs the throw to retry instead of recording a
  // false "sent". This page has no such retry mechanism and no error.tsx
  // boundary of its own, so letting the throw propagate would 500 the
  // entire public page — subscribe form included — on the exact conditions
  // (an empty or not-yet-seeded watchlist, a transient Supabase blip) that
  // getWatchlist()'s own EmptyState-tolerant design says should degrade
  // instead. Catch here and render an honest "temporarily unavailable"
  // state — NOT DigestPreview's "nothing qualified today" EmptyState, which
  // would be exactly the misleading claim C3 was written to prevent.
  try {
    const selection = await getCachedSelection()
    return <DigestPreview selection={selection} />
  } catch (e) {
    console.error('[daily] could not build today\'s picks:', e)
    return (
      <EmptyState
        icon={<CloudOff className="h-8 w-8" />}
        title="Today's picks are temporarily unavailable"
        description="We couldn't score the watchlist just now — try again shortly. Your subscription (and today's 6 AM send) isn't affected."
      />
    )
  }
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
        <Alert variant="success" title="You're in.">
          Your first Daily Maily arrives at 6:00 AM Eastern.
        </Alert>
      ) : null}
      {sp.confirmed === '0' ? (
        <Alert variant="warning" title="That link has expired.">
          Sign up again below and we'll send a fresh confirmation.
        </Alert>
      ) : null}
      {sp.unsubscribed === '1' ? (
        <Alert variant="info" title="Unsubscribed.">
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
