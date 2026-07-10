'use client'

import { type MouseEvent, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react'
import { Badge, Card } from '@/ui'
import { bigUsd, usd } from '@/lib/format'
import type { SignalState } from '@/lib/signals'
import { SignalChip } from './SignalChip'
import { RemoveTickerButton } from './RemoveTickerButton'

export interface WatchlistRow {
  symbol: string
  name: string | null
  price: number | null
  sma150: number | null
  marketCap: number | null
  allTimeHigh: number | null
  pctFromAth: number | null // % distance from all-time high (≤ 0)
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

type SortKey =
  | 'composite'
  | 'symbol'
  | 'trailingPe'
  | 'yoyPct'
  | 'forwardPe'
  | 'fwdPct'
  | 'peg5yr'
  | 'epsCagr5yr'
  | 'sma150'
  | 'vsSma150'
  | 'price'
  | 'marketCap'
  | 'allTimeHigh'
  | 'pctFromAth'

function cmpNum(x: number, y: number): number {
  return x < y ? -1 : x > y ? 1 : 0
}

// Percent the current price sits above (+) or below (−) its 150-day SMA.
function vsSma150Pct(r: WatchlistRow): number | null {
  if (r.sma150 == null || r.sma150 === 0 || r.price == null) return null
  return ((r.price - r.sma150) / r.sma150) * 100
}

// Numeric sort value per column. N/A readings sink to the bottom (−Infinity)
// regardless of direction is handled by the tiebreak; here na → −Infinity.
function sortVal(r: WatchlistRow, key: SortKey): number {
  switch (key) {
    case 'trailingPe':
      return r.trailingPe ?? -Infinity
    case 'yoyPct':
      return r.yoyState !== 'na' && r.yoyPct != null ? r.yoyPct : -Infinity
    case 'forwardPe':
      return r.forwardPe ?? -Infinity
    case 'fwdPct':
      return r.fwdState !== 'na' && r.fwdPct != null ? r.fwdPct : -Infinity
    case 'peg5yr':
      return r.peg5yr ?? -Infinity
    case 'epsCagr5yr':
      return r.epsCagr5yr ?? -Infinity
    case 'sma150':
    case 'vsSma150':
      // Sort by how far price sits above/below the 150-day SMA.
      return vsSma150Pct(r) ?? -Infinity
    case 'price':
      return r.price ?? -Infinity
    case 'marketCap':
      return r.marketCap ?? -Infinity
    case 'allTimeHigh':
      return r.allTimeHigh ?? -Infinity
    case 'pctFromAth':
      return r.pctFromAth ?? -Infinity
    default:
      return 0
  }
}

// Company logo by ticker. Parqet serves logos with their own background (so
// white wordmarks like Uber stay visible); fall back to FMP, then hide.
function TickerLogo({ symbol }: { symbol: string }) {
  const sources = [
    `https://assets.parqet.com/logos/symbol/${symbol}?format=png`,
    `https://financialmodelingprep.com/image-stock/${symbol}.png`,
  ]
  const [idx, setIdx] = useState(0)
  if (idx >= sources.length) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={sources[idx]}
      alt=""
      loading="lazy"
      onError={() => setIdx((i) => i + 1)}
      className="h-7 w-7 shrink-0 rounded-md object-contain ring-1 ring-border"
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
  {
    key: 'nearsma150',
    label: 'Near SMA 150 (±5%)',
    test: (r) => {
      const v = vsSma150Pct(r)
      return v != null && Math.abs(v) <= 5
    },
  },
  {
    key: 'yoyltfwd',
    label: 'YoY EPS < NTM growth',
    test: (r) =>
      r.yoyState !== 'na' &&
      r.yoyPct != null &&
      r.fwdState !== 'na' &&
      r.fwdPct != null &&
      r.yoyPct < r.fwdPct,
  },
]

const MIN_SCORES = [
  { label: 'Any score', value: 0 },
  { label: '≥ 3', value: 3 },
  { label: '≥ 4', value: 4 },
  { label: '5 / 5', value: 5 },
]

// Simple Hebrew explanation per column — shown on hover of the header title.
const COLUMN_HELP: Partial<Record<SortKey, string>> = {
  symbol: 'סימול המניה של החברה בבורסה.',
  trailingPe:
    'מכפיל רווח נגרר: מחיר המניה חלקי הרווח למניה ב-12 החודשים האחרונים. ככל שנמוך יותר – המניה זולה יותר ביחס לרווח.',
  yoyPct: 'צמיחת הרווח למניה ברבעון האחרון בהשוואה לאותו רבעון לפני שנה (שנה מול שנה).',
  forwardPe: 'מכפיל רווח עתידי: מחיר המניה חלקי תחזית הרווח למניה ל-12 החודשים הקרובים.',
  fwdPct:
    'אחוז הצמיחה הצפוי ברווח למניה בשנה הקרובה. נגזר מהיחס בין המכפיל הנגרר למכפיל העתידי.',
  peg5yr:
    'יחס PEG: מכפיל הרווח חלקי הצמיחה השנתית הצפויה ל-5 שנים. ערך מתחת ל-1 נחשב תמחור אטרקטיבי.',
  epsCagr5yr:
    'קצב הצמיחה השנתי הממוצע הצפוי ברווח למניה ל-5 השנים הבאות (מחושב ממכפיל הרווח חלקי ה-PEG).',
  sma150:
    'ממוצע נע של מחיר המניה על פני 150 ימי מסחר. "מעל"/"מתחת" מציין היכן המחיר הנוכחי ביחס אליו.',
  vsSma150: 'בכמה אחוזים המחיר הנוכחי גבוה (+) או נמוך (−) מהממוצע הנע ל-150 יום.',
  price: 'מחיר המניה העדכני (אחרון ידוע).',
  marketCap: 'שווי השוק של החברה: מחיר המניה כפול מספר המניות. משקף את גודל החברה.',
  allTimeHigh: 'המחיר הגבוה ביותר שהמניה נסחרה בו אי פעם (שיא כל הזמנים).',
  pctFromAth:
    'בכמה אחוזים המחיר הנוכחי נמוך משיא כל הזמנים. 0% פירושו שהמניה בשיא חדש; ערך שלילי מציין את המרחק מהשיא.',
}

// Approx. tooltip width (matches max-w below) — used to keep it on-screen.
const TIP_WIDTH = 320

export function WatchlistTable({ rows }: { rows: WatchlistRow[] }) {
  const router = useRouter()
  const [sortKey, setSortKey] = useState<SortKey>('composite')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')

  const [query, setQuery] = useState('')
  const [minScore, setMinScore] = useState(0)
  const [active, setActive] = useState<Set<string>>(new Set())

  // Hover help tooltip (Hebrew). Positioned with viewport coords so it isn't
  // clipped by the sticky, overflow-auto table container.
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)
  function showTip(e: MouseEvent<HTMLElement>, text: string) {
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.max(8, Math.min(r.left, window.innerWidth - TIP_WIDTH - 8))
    setTip({ text, x, y: r.bottom + 6 })
  }

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
      const cmp =
        sortKey === 'symbol'
          ? a.symbol.localeCompare(b.symbol)
          : cmpNum(sortVal(a, sortKey), sortVal(b, sortKey))
      const ordered = dir === 'asc' ? cmp : -cmp
      // Stable tiebreak so equal values stay alphabetical.
      return ordered !== 0 ? ordered : a.symbol.localeCompare(b.symbol)
    })
  }, [filtered, sortKey, dir])

  const SortHeader = ({ label, k, className }: { label: string; k: SortKey; className?: string }) => {
    const help = COLUMN_HELP[k]
    return (
      <th className={className}>
        <button
          type="button"
          onClick={() => toggle(k)}
          onMouseEnter={help ? (e) => showTip(e, help) : undefined}
          onMouseLeave={help ? () => setTip(null) : undefined}
          className="inline-flex items-center gap-1 font-medium text-muted hover:text-foreground"
        >
          {label}
          {sortKey === k ? (
            dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
          ) : null}
        </button>
      </th>
    )
  }

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
        {/* Scroll the table within its own region (capped to the viewport) so
            the header row can stay frozen at the top as you scroll the data. */}
        <div className="max-h-[calc(100vh-6rem)] overflow-auto">
          <table className="w-full text-sm">
            <thead>
              {/* Grouping band — spans the columns beneath each time horizon. */}
              <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:h-8 [&>th]:bg-surface [&>th]:px-4 [&>th]:text-center [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-muted">
                <th aria-hidden />
                <th colSpan={2} className="border-l border-border">
                  Last year performance
                </th>
                <th colSpan={2} className="border-l border-border">
                  Next year performance
                </th>
                <th colSpan={2} className="border-l border-border">
                  Next 5 years performance
                </th>
                <th colSpan={2} className="border-l border-border">
                  150 SMA indicator
                </th>
                <th className="border-l border-border" />
                <th colSpan={3} className="border-l border-border">
                  Size &amp; range
                </th>
                <th />
              </tr>
              <tr className="text-left [&>th]:sticky [&>th]:top-8 [&>th]:z-10 [&>th]:border-b [&>th]:border-border [&>th]:bg-surface [&>th]:px-4 [&>th]:py-3">
                <SortHeader label="Ticker" k="symbol" />
                <SortHeader label="Trailing P/E (1)" k="trailingPe" className="border-l border-border" />
                <SortHeader label="YoY EPS (3)" k="yoyPct" />
                <SortHeader label="Forward P/E" k="forwardPe" className="border-l border-border" />
                <SortHeader label="NTM EPS Growth (%)" k="fwdPct" />
                <SortHeader label="PEG (5yr exp)" k="peg5yr" className="border-l border-border" />
                <SortHeader label="EPS CAGR 5yr expected" k="epsCagr5yr" />
                <SortHeader label="SMA 150" k="sma150" className="border-l border-border" />
                <SortHeader label="% vs SMA 150" k="vsSma150" />
                <SortHeader label="Price" k="price" className="border-l border-border" />
                <SortHeader label="Market Cap" k="marketCap" className="border-l border-border" />
                <SortHeader label="All Time High" k="allTimeHigh" />
                <SortHeader label="% ATH" k="pctFromAth" />
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-4 py-10 text-center text-sm text-muted">
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
                      <Badge variant="neutral" size="sm">
                        {r.forwardPe != null ? `${r.forwardPe.toFixed(1)}×` : 'N/A'}
                      </Badge>
                    </td>
                    <td>
                      <SignalChip state={r.fwdState} label={r.fwdLabel} />
                    </td>
                    <td>
                      {r.peg5yr != null ? (
                        <Badge variant={r.peg5yr < 1 ? 'success' : 'neutral'} size="sm">
                          {r.peg5yr.toFixed(2)}
                        </Badge>
                      ) : (
                        <Badge variant="neutral" size="sm">
                          N/A
                        </Badge>
                      )}
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
                        <Badge variant="neutral" size="sm">
                          N/A
                        </Badge>
                      )}
                    </td>
                    <td>
                      {r.sma150 != null ? (
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums text-muted">{r.sma150.toFixed(2)}</span>
                          {r.price != null ? (
                            <Badge variant={r.price >= r.sma150 ? 'success' : 'destructive'} size="sm">
                              {r.price >= r.sma150 ? 'Above' : 'Below'}
                            </Badge>
                          ) : null}
                        </div>
                      ) : (
                        <Badge variant="neutral" size="sm">
                          N/A
                        </Badge>
                      )}
                    </td>
                    <td>
                      {(() => {
                        const v = vsSma150Pct(r)
                        if (v == null)
                          return (
                            <Badge variant="neutral" size="sm">
                              N/A
                            </Badge>
                          )
                        return (
                          <span
                            className={
                              'font-semibold tabular-nums ' +
                              (v >= 0 ? 'text-emerald-600' : 'text-red-600')
                            }
                          >
                            {v >= 0 ? '+' : ''}
                            {v.toFixed(1)}%
                          </span>
                        )
                      })()}
                    </td>
                    <td>
                      <span className="font-semibold tabular-nums text-foreground">
                        {r.price != null
                          ? `$${r.price.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`
                          : 'N/A'}
                      </span>
                    </td>
                    <td className="border-l border-border">
                      <span className="tabular-nums text-foreground">{bigUsd(r.marketCap)}</span>
                    </td>
                    <td>
                      <span className="tabular-nums text-muted">
                        {r.allTimeHigh != null ? usd(r.allTimeHigh) : 'N/A'}
                      </span>
                    </td>
                    <td>
                      {r.pctFromAth == null ? (
                        <Badge variant="neutral" size="sm">
                          N/A
                        </Badge>
                      ) : (
                        <span
                          className={
                            'font-semibold tabular-nums ' +
                            (r.pctFromAth >= -5
                              ? 'text-emerald-600'
                              : r.pctFromAth >= -20
                                ? 'text-amber-600'
                                : 'text-red-600')
                          }
                        >
                          {r.pctFromAth >= 0 ? '+' : ''}
                          {r.pctFromAth.toFixed(1)}%
                        </span>
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

      {/* Hebrew help tooltip — fixed to the viewport so it never gets clipped. */}
      {tip ? (
        <div
          dir="rtl"
          style={{ position: 'fixed', left: tip.x, top: tip.y, width: TIP_WIDTH }}
          className="pointer-events-none z-50 rounded-lg border border-border bg-surface px-3 py-2 text-right text-xs leading-relaxed text-foreground shadow-lg"
        >
          {tip.text}
        </div>
      ) : null}
    </div>
  )
}
