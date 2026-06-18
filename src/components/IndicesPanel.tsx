import { Card } from '@/ui'
import { getIndices, type Accent } from '@/market-data/indices'
import { pct, ratio } from '@/lib/format'

const ACCENT_DOT: Record<Accent, string> = {
  amber: 'bg-amber-500',
  violet: 'bg-violet-500',
  emerald: 'bg-emerald-500',
  sky: 'bg-sky-500',
}

/** Key-indices comparison rendered as one slim strip at the top of the
 *  dashboard. YTD + P/E are live (Yahoo); EPS-growth figures are maintained
 *  estimates. Kept deliberately compact to minimise vertical space. */
export async function IndicesPanel() {
  const indices = await getIndices()

  return (
    <Card className="overflow-x-auto p-0">
      <div className="flex min-w-max divide-x divide-border">
        {indices.map((d) => {
          const up = d.ytdPct != null && d.ytdPct >= 0
          return (
            <div key={d.key} className="flex-1 whitespace-nowrap px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${ACCENT_DOT[d.accent]}`} />
                <span className="text-sm font-semibold text-foreground">{d.name}</span>
                <span
                  className={`text-sm font-bold tabular-nums ${up ? 'text-emerald-600' : 'text-red-600'}`}
                >
                  {pct(d.ytdPct)}
                </span>
                <span className="text-[11px] text-muted">YTD</span>
              </div>
              <div className="mt-0.5 text-[11px] tabular-nums text-muted">
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
