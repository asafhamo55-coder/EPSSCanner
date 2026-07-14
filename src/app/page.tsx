import { Suspense } from 'react'
import Link from 'next/link'
import { LineChart, Plus } from 'lucide-react'
import { Button, EmptyState, PageHeader } from '@/ui'
import { getWatchlist, type TickerData } from '@/lib/queries'
import { pct } from '@/lib/format'
import { AddTickerForm } from '@/components/AddTickerForm'
import { RefreshButton } from '@/components/RefreshButton'
import { WatchlistTable, type WatchlistRow } from '@/components/WatchlistTable'
import { IndicesPanel } from '@/components/IndicesPanel'
import { IndicesPanelSkeleton, WatchlistSkeleton } from '@/components/DashboardSkeletons'

// Rendered ahead of the request and served from the CDN, so opening the app
// paints real content immediately instead of waiting on the ~57-ticker fan-out
// (Supabase reads + live Yahoo SMA/ATH/PEG). The underlying data is re-ingested
// weekly by the cron, so a 5-minute window is far fresher than the source; any
// mutation (add / remove / refresh) calls revalidatePath('/') for an instant bust.
export const revalidate = 300

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function toRow(t: TickerData): WatchlistRow {
  const sc = t.scorecard
  // EPS CAGR (5-yr expected) = trailing P/E ÷ PEG ratio (5-yr expected).
  const peg5yr = t.valuation.peg5yr
  const epsCagr5yr =
    sc.pe.trailingPe != null && peg5yr != null && peg5yr !== 0 ? sc.pe.trailingPe / peg5yr : null
  const yoyLabel =
    sc.yoy.state === 'turnaround' ? 'Turnaround' : sc.yoy.state === 'na' ? 'N/A' : pct(sc.yoy.pct)
  const qoqLabel = sc.qoq.label === 'na' ? 'N/A' : capitalize(sc.qoq.label)
  // NTM EPS Growth (%) = (trailing P/E ÷ forward P/E − 1) × 100, e.g. MU
  // 48.1 / 8.9 ≈ 5.40 → 440%. Forward P/E is Yahoo's (same value as the
  // column). `sc.fwd.pct` already carries the (ratio − 1) × 100 growth.
  const fwdLabel =
    sc.fwd.state === 'na' || sc.fwd.pct == null ? 'N/A' : `${sc.fwd.pct.toFixed(0)}%`
  // % distance from the all-time high — price is at/below the ATH, so this is
  // ≤ 0 (0 = making new highs). Null when either input is missing.
  const ath = t.valuation.allTimeHigh
  const price = t.valuation.price
  const pctFromAth =
    ath != null && ath !== 0 && price != null ? ((price - ath) / ath) * 100 : null
  return {
    symbol: t.symbol,
    name: t.name,
    price: t.valuation.price,
    sma150: t.valuation.sma150,
    marketCap: t.valuation.marketCap,
    allTimeHigh: ath,
    pctFromAth,
    trailingPe: sc.pe.trailingPe,
    forwardPe: sc.fwd.forwardPe,
    peg5yr,
    epsCagr5yr,
    peState: sc.pe.state,
    fundState: sc.fundamentals.state,
    yoyPct: sc.yoy.pct,
    yoyState: sc.yoy.state,
    yoyLabel,
    qoqState: sc.qoq.state,
    qoqLabel,
    fwdPct: sc.fwd.pct,
    fwdState: sc.fwd.state,
    fwdLabel,
    pePremium: sc.pe.premiumFlag,
    passing: sc.passing,
    scored: sc.scored,
  }
}

async function Watchlist() {
  const watchlist = await getWatchlist()
  const rows = watchlist.map(toRow)

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<LineChart className="h-8 w-8" />}
        title="No tickers yet"
        description="Add your first ticker to start tracking YoY EPS growth, sequential trend, and forward signals. Try NVDA, AAPL, or any symbol."
        action={
          <Button asChild>
            <Link href="#">
              <Plus className="h-4 w-4" />
              Use the add box above
            </Link>
          </Button>
        }
      />
    )
  }
  return <WatchlistTable rows={rows} />
}

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Each slow section streams behind its own boundary, so the header and
          add/refresh controls stay interactive while data resolves. */}
      <Suspense fallback={<IndicesPanelSkeleton />}>
        <IndicesPanel />
      </Suspense>

      <PageHeader
        title="Watchlist"
        description="Per-ticker fundamental scorecard — the 5-step EPS methodology, recomputed each refresh."
        actions={
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <AddTickerForm />
            <RefreshButton />
          </div>
        }
      />

      <Suspense fallback={<WatchlistSkeleton />}>
        <Watchlist />
      </Suspense>
    </div>
  )
}
