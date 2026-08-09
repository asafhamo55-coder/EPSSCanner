import { Card } from '@/ui'
import { getIndices, type Accent } from '@/market-data/indices'
import { pct, ratio } from '@/lib/format'

const ACCENT_DOT: Record<Accent, string> = {
  amber: 'bg-amber-500',
  violet: 'bg-violet-500',
  emerald: 'bg-emerald-500',
  sky: 'bg-sky-500',
}

/** One label/value row of the phone layout — mirrors WatchlistTable's
 *  MobileStat idiom (small uppercase label, value in full contrast). */
function IndexStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  )
}

/** Key-indices comparison at the top of the dashboard.
 *  YTD + P/E are live (Yahoo); EPS-growth figures are maintained estimates.
 *
 *  Two layouts, same data: a divided horizontal strip on desktop, and a 2×2
 *  grid on phones where the strip would force sideways scrolling. The grid
 *  breaks the P/E footnote into aligned label/value rows — the run-on
 *  `·`-separated version is unreadable at phone width. */
export async function IndicesPanel() {
  const indices = await getIndices()

  return (
    <Card className="overflow-hidden p-0 md:overflow-x-auto">
      <div className="grid grid-cols-2 md:flex md:min-w-max md:divide-x md:divide-border">
        {indices.map((d, i) => {
          const up = d.ytdPct != null && d.ytdPct >= 0
          // 2×2 grid dividers: right edge on the left column, bottom edge on
          // the top row. Desktop takes its dividers from `divide-x` instead.
          const cell = [
            i % 2 === 0 ? 'border-r border-border md:border-r-0' : '',
            i < 2 ? 'border-b border-border md:border-b-0' : '',
          ].join(' ')
          return (
            <div key={d.key} className={`px-3.5 py-3.5 md:flex-1 md:whitespace-nowrap md:px-5 ${cell}`}>
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${ACCENT_DOT[d.accent]}`} />
                <span className="truncate text-base font-semibold text-foreground">{d.name}</span>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-muted md:hidden">{d.region}</div>

              <div className="mt-1 flex items-baseline gap-1.5">
                <span
                  className={`text-2xl font-bold tabular-nums ${up ? 'text-emerald-600' : 'text-red-600'}`}
                >
                  {pct(d.ytdPct)}
                </span>
                <span className="text-xs font-medium text-muted">YTD</span>
              </div>

              {/* Desktop: one compact footnote line. */}
              <div className="mt-1.5 hidden text-sm tabular-nums text-muted md:block">
                P/E {ratio(d.trailingPe, 1)} · Fwd {ratio(d.forwardPe, 1)} · EPS ’26 {d.eps2026} · ’27{' '}
                {d.eps2027}
              </div>

              {/* Phone: stacked rows, values in full contrast. */}
              <dl className="mt-2.5 space-y-1.5 border-t border-border pt-2.5 md:hidden">
                <IndexStat label="P/E" value={ratio(d.trailingPe, 1)} />
                <IndexStat label="Fwd" value={ratio(d.forwardPe, 1)} />
                <IndexStat label="EPS ’26" value={d.eps2026} />
                <IndexStat label="EPS ’27" value={d.eps2027} />
              </dl>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
