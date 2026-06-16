import Link from 'next/link'
import { Activity, ArrowUpRight, Gauge, LineChart, Plus, Target, TrendingDown, TrendingUp } from 'lucide-react'
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
  // EPS CAGR (5-yr expected) = trailing P/E ÷ PEG ratio (5-yr expected).
  const peg5yr = t.valuation.peg5yr
  const epsCagr5yr =
    sc.pe.trailingPe != null && peg5yr != null && peg5yr !== 0 ? sc.pe.trailingPe / peg5yr : null
  const yoyLabel =
    sc.yoy.state === 'turnaround' ? 'Turnaround' : sc.yoy.state === 'na' ? 'N/A' : pct(sc.yoy.pct)
  const qoqLabel = sc.qoq.label === 'na' ? 'N/A' : capitalize(sc.qoq.label)
  const fwdLabel = sc.fwd.state === 'na' ? 'N/A' : pct(sc.fwd.pct)
  return {
    symbol: t.symbol,
    name: t.name,
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

export default async function DashboardPage() {
  const watchlist = await getWatchlist()
  const rows = watchlist.map(toRow)

  const total = rows.length
  const cleanSweep = rows.filter((r) => r.scored > 0 && r.passing === r.scored).length
  const premium = rows.filter((r) => r.pePremium).length
  const decel = rows.filter((r) => r.qoqLabel === 'Decelerating').length

  const scoredRows = rows.filter((r) => r.scored > 0)
  const avgScore =
    scoredRows.length > 0 ? scoredRows.reduce((s, r) => s + r.passing, 0) / scoredRows.length : 0
  const highConviction = rows.filter((r) => r.passing >= 4).length
  const accel = rows.filter((r) => r.qoqLabel === 'Accelerating').length
  const fwdGrowth = rows.filter((r) => r.fwdState !== 'na' && (r.fwdPct ?? 0) > 0).length

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
          description="Add your first ticker to start tracking QoQ EPS growth, sequential trend, and forward signals. Try NVDA, AAPL, or any symbol."
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
              meta="sequential EPS deltas trending down"
            />
            <StatCard
              icon={<Gauge className="h-4 w-4" />}
              label="Average score"
              value={`${avgScore.toFixed(1)} / 5`}
              meta={`across ${scoredRows.length} scored`}
            />
            <StatCard
              icon={<Target className="h-4 w-4" />}
              label="High conviction"
              value={highConviction}
              meta="passing ≥4 of 5 signals"
            />
            <StatCard
              icon={<Activity className="h-4 w-4" />}
              label="Accelerating"
              value={accel}
              meta="sequential EPS deltas trending up"
            />
            <StatCard
              icon={<ArrowUpRight className="h-4 w-4" />}
              label="Forward growth"
              value={fwdGrowth}
              meta="forward P/E implies EPS growth"
            />
          </div>

          <WatchlistTable rows={rows} />
        </>
      )}
    </div>
  )
}
