import Link from 'next/link'
import { LineChart, Plus } from 'lucide-react'
import { Button, Card, EmptyState, PageHeader } from '@/ui'
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
  // NTM EPS Growth (%) = trailing P/E ÷ forward P/E × 100 (no −1), e.g. MU
  // 48.1 / 8.9 ≈ 540%. Forward P/E is Yahoo's (same value as the column).
  const fwdLabel =
    sc.fwd.state === 'na' || sc.fwd.ratio == null ? 'N/A' : `${(sc.fwd.ratio * 100).toFixed(0)}%`
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
      ) : (
        <>
          <Card className="overflow-x-auto p-0">
            <div className="flex min-w-max divide-x divide-border">
              {[
                { label: 'Tickers', value: total },
                { label: 'All signals', value: cleanSweep },
                { label: 'P/E premium', value: premium },
                { label: 'Decelerating', value: decel },
                { label: 'Avg score', value: `${avgScore.toFixed(1)}/5` },
                { label: 'High conviction', value: highConviction },
                { label: 'Accelerating', value: accel },
                { label: 'Forward growth', value: fwdGrowth },
              ].map((s) => (
                <div key={s.label} className="flex-1 whitespace-nowrap px-3 py-2 text-center">
                  <span className="text-sm font-bold text-foreground">{s.value}</span>
                  <span className="ml-1.5 text-[11px] text-muted">{s.label}</span>
                </div>
              ))}
            </div>
          </Card>

          <WatchlistTable rows={rows} />
        </>
      )}
    </div>
  )
}
