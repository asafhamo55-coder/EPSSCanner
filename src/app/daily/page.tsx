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
