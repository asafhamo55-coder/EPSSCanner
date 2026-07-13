'use client'

import { type MouseEvent, type ReactNode, useMemo, useState } from 'react'
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

// Sort options surfaced as a dropdown on mobile, where the table's clickable
// column headers aren't visible.
const MOBILE_SORTS: { label: string; key: SortKey }[] = [
  { label: 'Best match', key: 'composite' },
  { label: 'YoY EPS', key: 'yoyPct' },
  { label: 'NTM EPS growth', key: 'fwdPct' },
  { label: 'PEG (5yr exp)', key: 'peg5yr' },
  { label: 'EPS CAGR 5yr', key: 'epsCagr5yr' },
  { label: '% vs SMA 150', key: 'vsSma150' },
  { label: 'Market cap', key: 'marketCap' },
  { label: '% ATH', key: 'pctFromAth' },
  { label: 'Price', key: 'price' },
  { label: 'Ticker', key: 'symbol' },
]

// One labelled metric inside a mobile card. Value may be plain text or a chip.
function MobileStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{children}</div>
    </div>
  )
}

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

  // Hover help tooltip (Hebrew). Shown only while the pointer is over a column
  // title; positioned with viewport coords so it isn't clipped by the sticky,
  // overflow-auto table container.
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)
  function showTip(e: MouseEvent<HTMLElement>, text: string) {
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.max(8, Math.min(r.left, window.innerWidth - TIP_WIDTH - 8))
    setTip({ text, x, y: r.bottom + 6 })
  }
  function hideTip() {
    setTip(null)
  }

  function toggle(key: SortKey) {
    if (key === sortKey) setDir(dir === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(key)
      setDir(key === 'symbol' ? 'asc' : 'desc')
    }
  }

  // Pick a sort column outright (mobile dropdown) with a sensible direction.
  function chooseSort(key: SortKey) {
    setSortKey(key)
    setDir(key === 'symbol' ? 'asc' : 'desc')
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

  // Rendered inline (a function call, NOT a <SortHeader/> element) so React
  // keeps the same <th> node across re-renders instead of remounting it — that
  // remount was silently dropping the button's mouseleave, which left the help
  // tooltip stuck on screen. Now the tooltip strictly follows the hover.
  const sortHeader = (label: string, k: SortKey, className?: string) => {
    const help = COLUMN_HELP[k]
    return (
      <th className={className}>
        <button
          type="button"
          onClick={() => toggle(k)}
          onMouseEnter={help ? (e) => showTip(e, help) : undefined}
          onMouseLeave={help ? hideTip : undefined}
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
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ticker or name…"
            className="h-10 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none sm:h-9"
          />
        </div>

        {/* Sort picker — only useful on mobile, where column headers are hidden. */}
        <select
          value={sortKey}
          onChange={(e) => chooseSort(e.target.value as SortKey)}
          className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-sm text-foreground focus:border-primary focus:outline-none sm:h-9 md:hidden"
          aria-label="Sort by"
        >
          {MOBILE_SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              Sort: {s.label}
            </option>
          ))}
        </select>

        <select
          value={minScore}
          onChange={(e) => setMinScore(Number(e.target.value))}
          className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-foreground focus:border-primary focus:outline-none sm:h-9"
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

      {/* Desktop / tablet: the full sortable table. Hidden on phones, where the
          14 columns are unreadable — the card list below takes over there. */}
      <Card className="hidden overflow-hidden md:block">
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
                {sortHeader('Ticker', 'symbol')}
                {sortHeader('Trailing P/E (1)', 'trailingPe', 'border-l border-border')}
                {sortHeader('YoY EPS (3)', 'yoyPct')}
                {sortHeader('Forward P/E', 'forwardPe', 'border-l border-border')}
                {sortHeader('NTM EPS Growth (%)', 'fwdPct')}
                {sortHeader('PEG (5yr exp)', 'peg5yr', 'border-l border-border')}
                {sortHeader('EPS CAGR 5yr expected', 'epsCagr5yr')}
                {sortHeader('SMA 150', 'sma150', 'border-l border-border')}
                {sortHeader('% vs SMA 150', 'vsSma150')}
                {sortHeader('Price', 'price', 'border-l border-border')}
                {sortHeader('Market Cap', 'marketCap', 'border-l border-border')}
                {sortHeader('All Time High', 'allTimeHigh')}
                {sortHeader('% ATH', 'pctFromAth')}
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

      {/* Phone: one tappable card per ticker — the essentials only, no sideways
          scroll. Shares the same filtered/sorted list as the table above. */}
      <div className="space-y-2.5 md:hidden">
        {sorted.length === 0 ? (
          <Card className="px-4 py-10 text-center text-sm text-muted">
            No tickers match these filters.
          </Card>
        ) : (
          sorted.map((r) => {
            const ath = r.pctFromAth
            return (
              <Card
                key={r.symbol}
                onClick={() => router.push(`/ticker/${r.symbol}`)}
                className="cursor-pointer p-3.5 transition-colors active:bg-background"
              >
                <div className="flex items-center gap-3">
                  <TickerLogo symbol={r.symbol} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{r.symbol}</span>
                      <Badge
                        variant={r.passing >= 4 ? 'success' : r.passing >= 3 ? 'warning' : 'neutral'}
                        size="sm"
                      >
                        {r.passing}/{r.scored}
                      </Badge>
                    </div>
                    {r.name ? <div className="truncate text-xs text-muted">{r.name}</div> : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-semibold tabular-nums text-foreground">
                      {r.price != null
                        ? `$${r.price.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}`
                        : 'N/A'}
                    </div>
                    <div className="text-[11px] tabular-nums text-muted">{bigUsd(r.marketCap)}</div>
                  </div>
                  <div className="-mr-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <RemoveTickerButton symbol={r.symbol} />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-border pt-3">
                  <MobileStat label="Trailing P/E (1)">
                    <SignalChip
                      state={r.peState}
                      label={r.trailingPe != null ? `${r.trailingPe.toFixed(1)}×` : 'N/A'}
                    />
                  </MobileStat>
                  <MobileStat label="Forward P/E">
                    <Badge variant="neutral" size="sm">
                      {r.forwardPe != null ? `${r.forwardPe.toFixed(1)}×` : 'N/A'}
                    </Badge>
                  </MobileStat>
                  <MobileStat label="YoY EPS (3)">
                    <SignalChip state={r.yoyState} label={r.yoyLabel} />
                  </MobileStat>
                  <MobileStat label="NTM EPS growth">
                    <SignalChip state={r.fwdState} label={r.fwdLabel} />
                  </MobileStat>
                  <MobileStat label="PEG (5yr exp)">
                    <span className={r.peg5yr != null && r.peg5yr < 1 ? 'text-emerald-600' : undefined}>
                      {r.peg5yr != null ? r.peg5yr.toFixed(2) : 'N/A'}
                    </span>
                  </MobileStat>
                  <MobileStat label="EPS CAGR 5yr exp">
                    {r.epsCagr5yr == null ? (
                      'N/A'
                    ) : (
                      <span
                        className={
                          r.epsCagr5yr < 15
                            ? 'text-red-600'
                            : r.epsCagr5yr <= 30
                              ? 'text-amber-600'
                              : 'text-emerald-600'
                        }
                      >
                        {r.epsCagr5yr.toFixed(1)}%
                      </span>
                    )}
                  </MobileStat>
                  <MobileStat label="% ATH">
                    {ath == null ? (
                      'N/A'
                    ) : (
                      <span
                        className={
                          ath >= -5 ? 'text-emerald-600' : ath >= -20 ? 'text-amber-600' : 'text-red-600'
                        }
                      >
                        {ath >= 0 ? '+' : ''}
                        {ath.toFixed(1)}%
                      </span>
                    )}
                  </MobileStat>
                  <MobileStat label="% vs SMA 150">
                    {(() => {
                      const v = vsSma150Pct(r)
                      if (v == null) return 'N/A'
                      return (
                        <span className={v >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                          {v >= 0 ? '+' : ''}
                          {v.toFixed(1)}%
                        </span>
                      )
                    })()}
                  </MobileStat>
                </div>
              </Card>
            )
          })
        )}
      </div>

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
