import Link from 'next/link'
import { LineChart, Plus, TrendingDown, TrendingUp } from 'lucide-react'
import { Button, EmptyState, PageHeader, StatCard } from '@/ui'
import { getWatchlist, type TickerData } from '@/lib/queries'
import { pct } from '@/lib/format'
import { AddTickerForm } from '@/components/AddTickerForm'
import { RefreshButton } from '@/components/RefreshButton'
import { WatchlistTable, type WatchlistRow } from '@/components/WatchlistTable'

export const dynamic = 'force-dynamic'

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function toRow(t: TickerData): WatchlistRow {
  const sc = t.scorecard
  const yoyLabel =
    sc.yoy.state === 'turnaround' ? 'Turnaround' : sc.yoy.state === 'na' ? 'N/A' : pct(sc.yoy.pct)
  const qoqLabel = sc.qoq.label === 'na' ? 'N/A' : capitalize(sc.qoq.label)
  const fwdLabel = sc.fwd.state === 'na' ? 'N/A' : pct(sc.fwd.pct)
  return {
    symbol: t.symbol,
    name: t.name,
    trailingPe: sc.pe.trailingPe,
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
    passing: sc.passing,
    scored: sc.scored,
  }
}

export default async function DashboardPage() {
  const watchlist = await getWatchlist()
  const rows = watchlist.map(toRow)

  const total = rows.length
  const cleanSweep = rows.filter((r) => r.scored > 0 && r.passing === r.scored).length
  const premium = watchlist.filter((t) => t.scorecard.pe.premiumFlag).length
  const decel = rows.filter((r) => r.qoqState === 'fail').length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Watchlist"
        description="Per-ticker fundamental scorecard — the 5-step EPS methodology, recomputed each refresh."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AddTickerForm />
            {total > 0 ? <RefreshButton /> : null}
          </div>
        }
      />

      {total === 0 ? (
        <EmptyState
          icon={<LineChart className="h-8 w-8" />}
          title="No tickers yet"
          description="Add your first ticker to start tracking YoY growth, QoQ trend, and forward signals. Try NVDA, AAPL, or any symbol."
          action={
            <Button asChild>
              <Link href="#">
                <Plus className="h-4 w-4" />
                Use the add box above
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={<LineChart className="h-4 w-4" />}
              label="Tickers tracked"
              value={total}
              meta="on your watchlist"
            />
            <StatCard
              icon={<TrendingUp className="h-4 w-4" />}
              label="Passing all signals"
              value={cleanSweep}
              meta={`of ${total} clear every scored step`}
            />
            <StatCard
              icon={<TrendingUp className="h-4 w-4" />}
              label="P/E premium"
              value={premium}
              meta="trading above 30× trailing"
            />
            <StatCard
              icon={<TrendingDown className="h-4 w-4" />}
              label="Decelerating"
              value={decel}
              meta="QoQ EPS deltas trending down"
            />
          </div>

          <WatchlistTable rows={rows} />
        </>
      )}
    </div>
  )
}
