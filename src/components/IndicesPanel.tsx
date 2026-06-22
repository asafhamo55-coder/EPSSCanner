import { Card } from '@/ui'
import { getIndices, type Accent } from '@/market-data/indices'
import { pct, ratio } from '@/lib/format'

const ACCENT_DOT: Record<Accent, string> = {
  amber: 'bg-amber-500',
  violet: 'bg-violet-500',
  emerald: 'bg-emerald-500',
  sky: 'bg-sky-500',
}

/** Key-indices comparison rendered as a strip at the top of the dashboard.
 *  YTD + P/E are live (Yahoo); EPS-growth figures are maintained estimates.
 *  Sized for at-a-glance readability without dominating the page. */
export async function IndicesPanel() {
  const indices = await getIndices()

  return (
    <Card className="overflow-x-auto p-0">
      <div className="flex min-w-max divide-x divide-border">
        {indices.map((d) => {
          const up = d.ytdPct != null && d.ytdPct >= 0
          return (
            <div key={d.key} className="flex-1 whitespace-nowrap px-5 py-3.5">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${ACCENT_DOT[d.accent]}`} />
                <span className="text-base font-semibold text-foreground">{d.name}</span>
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span
                  className={`text-2xl font-bold tabular-nums ${up ? 'text-emerald-600' : 'text-red-600'}`}
                >
                  {pct(d.ytdPct)}
                </span>
                <span className="text-xs font-medium text-muted">YTD</span>
              </div>
              <div className="mt-1.5 text-xs tabular-nums text-muted">
                P/E {ratio(d.trailingPe, 1)} · Fwd {ratio(d.forwardPe, 1)} · EPS ’26 {d.eps2026} · ’27{' '}
                {d.eps2027}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
