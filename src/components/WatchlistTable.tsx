'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Card } from '@/ui'
import type { SignalState } from '@/lib/signals'
import { SignalChip } from './SignalChip'
import { RemoveTickerButton } from './RemoveTickerButton'

export interface WatchlistRow {
  symbol: string
  name: string | null
  trailingPe: number | null
  peState: SignalState
  fundState: SignalState
  yoyPct: number | null
  yoyState: SignalState
  yoyLabel: string
  qoqState: SignalState
  qoqLabel: string
  fwdPct: number | null
  fwdState: SignalState
  fwdLabel: string
  passing: number
  scored: number
}

type SortKey = 'symbol' | 'yoyPct' | 'passing'

export function WatchlistTable({ rows }: { rows: WatchlistRow[] }) {
  const router = useRouter()
  const [sortKey, setSortKey] = useState<SortKey>('passing')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')

  function toggle(key: SortKey) {
    if (key === sortKey) setDir(dir === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(key)
      setDir(key === 'symbol' ? 'asc' : 'desc')
    }
  }

  const sorted = [...rows].sort((a, b) => {
    let cmp = 0
    if (sortKey === 'symbol') cmp = a.symbol.localeCompare(b.symbol)
    else if (sortKey === 'yoyPct') cmp = (a.yoyPct ?? -Infinity) - (b.yoyPct ?? -Infinity)
    else cmp = a.passing - b.passing
    const ordered = dir === 'asc' ? cmp : -cmp
    // Stable tiebreak so equal scores (e.g. all the 4/5s) stay alphabetical.
    return ordered !== 0 ? ordered : a.symbol.localeCompare(b.symbol)
  })

  const SortHeader = ({ label, k, className }: { label: string; k: SortKey; className?: string }) => (
    <th className={className}>
      <button
        type="button"
        onClick={() => toggle(k)}
        className="inline-flex items-center gap-1 font-medium text-muted hover:text-foreground"
      >
        {label}
        {sortKey === k ? (
          dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : null}
      </button>
    </th>
  )

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left [&>th]:px-4 [&>th]:py-3">
              <SortHeader label="Ticker" k="symbol" />
              <th className="font-medium text-muted">P/E (1)</th>
              <th className="font-medium text-muted">Fundamentals (2)</th>
              <SortHeader label="YoY EPS (3)" k="yoyPct" />
              <th className="font-medium text-muted">QoQ trend (4)</th>
              <th className="font-medium text-muted">Forward (5)</th>
              <SortHeader label="Score" k="passing" />
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={r.symbol}
                onClick={() => router.push(`/ticker/${r.symbol}`)}
                className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-background [&>td]:px-4 [&>td]:py-3"
              >
                <td>
                  <div className="font-semibold text-foreground">{r.symbol}</div>
                  {r.name ? <div className="text-xs text-muted">{r.name}</div> : null}
                </td>
                <td>
                  <SignalChip
                    state={r.peState}
                    label={r.trailingPe != null ? `${r.trailingPe.toFixed(1)}×` : 'N/A'}
                  />
                </td>
                <td>
                  <SignalChip state={r.fundState} />
                </td>
                <td>
                  <SignalChip state={r.yoyState} label={r.yoyLabel} />
                </td>
                <td>
                  <SignalChip state={r.qoqState} label={r.qoqLabel} />
                </td>
                <td>
                  <SignalChip state={r.fwdState} label={r.fwdLabel} />
                </td>
                <td>
                  <span className="font-medium text-foreground">
                    {r.passing}/{r.scored}
                  </span>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <RemoveTickerButton symbol={r.symbol} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
