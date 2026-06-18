'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react'
import { Badge, Card } from '@/ui'
import type { SignalState } from '@/lib/signals'
import { SignalChip } from './SignalChip'
import { RemoveTickerButton } from './RemoveTickerButton'

export interface WatchlistRow {
  symbol: string
  name: string | null
  trailingPe: number | null
  forwardPe: number | null
  peg5yr: number | null
  epsCagr5yr: number | null
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
  pePremium: boolean
  passing: number
  scored: number
}

type SortKey = 'composite' | 'symbol' | 'yoyPct' | 'passing'

function cmpNum(x: number, y: number): number {
  return x < y ? -1 : x > y ? 1 : 0
}

// Company logo by ticker (FMP public image endpoint); hides itself if missing.
function TickerLogo({ symbol }: { symbol: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://financialmodelingprep.com/image-stock/${symbol}.png`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-7 w-7 shrink-0 rounded-full bg-background object-contain ring-1 ring-border"
    />
  )
}
// Forward-growth value (na sinks to the bottom).
function fwdVal(r: WatchlistRow): number {
  return r.fwdState !== 'na' && r.fwdPct != null ? r.fwdPct : -Infinity
}
// QoQ EPS (step 3) value (na sinks to the bottom).
function qoqEpsVal(r: WatchlistRow): number {
  return r.yoyState !== 'na' && r.yoyPct != null ? r.yoyPct : -Infinity
}
// EPS CAGR 5yr expected (na sinks to the bottom).
function cagrVal(r: WatchlistRow): number {
  return r.epsCagr5yr ?? -Infinity
}

// Default ordering: YoY EPS(3) ↓ dominates; NTM EPS Growth ↓ then EPS CAGR
// 5yr ↓ only break exact ties (N/A sinks to the bottom).
function compositeCompare(a: WatchlistRow, b: WatchlistRow): number {
  return (
    cmpNum(qoqEpsVal(b), qoqEpsVal(a)) ||
    cmpNum(fwdVal(b), fwdVal(a)) ||
    cmpNum(cagrVal(b), cagrVal(a)) ||
    a.symbol.localeCompare(b.symbol)
  )
}

// Signal toggle chips — each narrows the list (active toggles AND together).
const TOGGLES: { key: string; label: string; test: (r: WatchlistRow) => boolean }[] = [
  { key: 'peband', label: 'P/E in band', test: (r) => r.peState === 'pass' },
  { key: 'premium', label: 'Premium', test: (r) => r.pePremium },
  { key: 'accel', label: 'Accelerating', test: (r) => r.qoqLabel === 'Accelerating' },
  { key: 'qoqpos', label: 'Positive YoY EPS', test: (r) => r.yoyState !== 'na' && (r.yoyPct ?? 0) > 0 },
  { key: 'fwd', label: 'Forward growth', test: (r) => r.fwdState !== 'na' && (r.fwdPct ?? 0) > 0 },
]

const MIN_SCORES = [
  { label: 'Any score', value: 0 },
  { label: '≥ 3', value: 3 },
  { label: '≥ 4', value: 4 },
  { label: '5 / 5', value: 5 },
]

export function WatchlistTable({ rows }: { rows: WatchlistRow[] }) {
  const router = useRouter()
  const [sortKey, setSortKey] = useState<SortKey>('composite')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')

  const [query, setQuery] = useState('')
  const [minScore, setMinScore] = useState(0)
  const [active, setActive] = useState<Set<string>>(new Set())

  function toggle(key: SortKey) {
    if (key === sortKey) setDir(dir === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(key)
      setDir(key === 'symbol' ? 'asc' : 'desc')
    }
  }

  function toggleChip(key: string) {
    setActive((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const hasFilters = query.trim() !== '' || minScore > 0 || active.size > 0
  function clearFilters() {
    setQuery('')
    setMinScore(0)
    setActive(new Set())
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (q && !r.symbol.toLowerCase().includes(q) && !(r.name?.toLowerCase().includes(q) ?? false)) {
        return false
      }
      if (r.passing < minScore) return false
      for (const t of TOGGLES) if (active.has(t.key) && !t.test(r)) return false
      return true
    })
  }, [rows, query, minScore, active])

  const sorted = useMemo(() => {
    if (sortKey === 'composite') return [...filtered].sort(compositeCompare)
    return [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'symbol') cmp = a.symbol.localeCompare(b.symbol)
      else if (sortKey === 'yoyPct') cmp = (a.yoyPct ?? -Infinity) - (b.yoyPct ?? -Infinity)
      else cmp = a.passing - b.passing
      const ordered = dir === 'asc' ? cmp : -cmp
      // Stable tiebreak so equal scores (e.g. all the 4/5s) stay alphabetical.
      return ordered !== 0 ? ordered : a.symbol.localeCompare(b.symbol)
    })
  }, [filtered, sortKey, dir])

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
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ticker or name…"
            className="h-9 w-56 rounded-lg border border-border bg-surface pl-8 pr-3 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
          />
        </div>

        <select
          value={minScore}
          onChange={(e) => setMinScore(Number(e.target.value))}
          className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground focus:border-primary focus:outline-none"
          aria-label="Minimum score"
        >
          {MIN_SCORES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>

        <div className="flex flex-wrap items-center gap-1.5">
          {TOGGLES.map((t) => {
            const on = active.has(t.key)
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => toggleChip(t.key)}
                aria-pressed={on}
                className={
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
                  (on
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : 'border-border text-muted hover:bg-background hover:text-foreground')
                }
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {hasFilters ? (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        ) : null}

        <span className="ml-auto text-xs text-muted">
          {sorted.length} of {rows.length}
        </span>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left [&>th]:px-4 [&>th]:py-3">
                <SortHeader label="Ticker" k="symbol" />
                <th className="font-medium text-muted">Trailing P/E (1)</th>
                <SortHeader label="YoY EPS (3)" k="yoyPct" />
                <th className="font-medium text-muted">Forward P/E</th>
                <th className="font-medium text-muted">NTM EPS Growth (%)</th>
                <th className="font-medium text-muted">PEG (5yr exp)</th>
                <th className="font-medium text-muted">EPS CAGR 5yr expected</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted">
                    No tickers match these filters.
                  </td>
                </tr>
              ) : (
                sorted.map((r) => (
                  <tr
                    key={r.symbol}
                    onClick={() => router.push(`/ticker/${r.symbol}`)}
                    className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-background [&>td]:px-4 [&>td]:py-3"
                  >
                    <td>
                      <div className="flex items-center gap-3">
                        <TickerLogo symbol={r.symbol} />
                        <div>
                          <div className="font-semibold text-foreground">{r.symbol}</div>
                          {r.name ? <div className="text-xs text-muted">{r.name}</div> : null}
                        </div>
                      </div>
                    </td>
                    <td>
                      <SignalChip
                        state={r.peState}
                        label={r.trailingPe != null ? `${r.trailingPe.toFixed(1)}×` : 'N/A'}
                      />
                    </td>
                    <td>
                      <SignalChip state={r.yoyState} label={r.yoyLabel} />
                    </td>
                    <td>
                      <span className="text-foreground">
                        {r.forwardPe != null ? `${r.forwardPe.toFixed(1)}×` : 'N/A'}
                      </span>
                    </td>
                    <td>
                      <SignalChip state={r.fwdState} label={r.fwdLabel} />
                    </td>
                    <td>
                      <span
                        className={
                          r.peg5yr != null && r.peg5yr < 1
                            ? 'inline-block rounded bg-[hsl(var(--pos)/0.22)] px-2 py-0.5 font-medium text-foreground'
                            : 'text-foreground'
                        }
                      >
                        {r.peg5yr != null ? r.peg5yr.toFixed(2) : 'N/A'}
                      </span>
                    </td>
                    <td>
                      {r.epsCagr5yr != null ? (
                        <Badge
                          variant={
                            r.epsCagr5yr < 15 ? 'destructive' : r.epsCagr5yr <= 30 ? 'warning' : 'success'
                          }
                          size="sm"
                        >
                          {r.epsCagr5yr.toFixed(1)}%
                          {r.epsCagr5yr < 15 ? '' : r.epsCagr5yr <= 30 ? ' · Good' : ' · Excellent'}
                        </Badge>
                      ) : (
                        <span className="text-muted">N/A</span>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <RemoveTickerButton symbol={r.symbol} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
