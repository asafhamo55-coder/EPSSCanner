import { Card } from '@/ui'
import { getIndices, type Accent, type IndexCardData } from '@/market-data/indices'
import { pct, ratio } from '@/lib/format'

const ACCENT_BAR: Record<Accent, string> = {
  amber: 'bg-amber-500',
  violet: 'bg-violet-500',
  emerald: 'bg-emerald-500',
  sky: 'bg-sky-500',
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm font-medium tabular-nums text-foreground">{value}</span>
    </div>
  )
}

function IndexCard({ data }: { data: IndexCardData }) {
  const up = data.ytdPct != null && data.ytdPct >= 0
  return (
    <Card className="overflow-hidden">
      <div className={`h-1 w-full ${ACCENT_BAR[data.accent]}`} />
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">
            {data.region}
          </span>
        </div>
        <h3 className="text-lg font-bold text-foreground">{data.name}</h3>

        <div>
          <p className="text-xs text-muted">YTD return</p>
          <p
            className={`text-3xl font-bold tabular-nums ${
              up ? 'text-emerald-600' : 'text-red-600'
            }`}
          >
            {pct(data.ytdPct)}
          </p>
        </div>

        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <Row label="Trailing P/E" value={ratio(data.trailingPe, 1)} />
          <Row label="Forward P/E" value={ratio(data.forwardPe, 1)} />
          <Row label="EPS growth ’26" value={data.eps2026} />
          <Row label="EPS growth ’27" value={data.eps2027} />
        </div>
      </div>
    </Card>
  )
}

/** Key-indices comparison strip rendered at the top of the dashboard.
 *  YTD + P/E are live (Yahoo); EPS-growth figures are maintained estimates. */
export async function IndicesPanel() {
  const indices = await getIndices()

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">Key indices</h2>
          <p className="text-sm text-muted">
            Major benchmarks at a glance — YTD return and valuation, refreshed live.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {indices.map((d) => (
          <IndexCard key={d.key} data={d} />
        ))}
      </div>

      <p className="text-xs text-muted">
        YTD &amp; P/E live via index price and tracking ETFs (IWM, QQQ, SPY); TA-35 and EPS-growth
        figures are analyst-estimate ranges. Not investment advice.
      </p>
    </section>
  )
}
