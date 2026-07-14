import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import {
  BackLink,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  KeyValue,
  KeyValueList,
  PageHeader,
  Tabs,
} from '@/ui'
import { getTicker } from '@/lib/queries'
import { bigUsd, marginPct, num, usd } from '@/lib/format'
import { RefreshButton } from '@/components/RefreshButton'
import { RemoveTickerButton } from '@/components/RemoveTickerButton'
import { Scorecard } from '@/components/Scorecard'
// Lazy (client-side, on-mount) — keeps the ~1.1MB echarts chunk off the
// Overview tab. See LazyCharts for why the boundary lives there.
import { EpsTrendChart, QoqDeltaChart } from '@/components/charts/LazyCharts'
import { predictEps } from '@/lib/forecast'

export const dynamic = 'force-dynamic'

type Params = { symbol: string }
type Search = { tab?: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { symbol } = await params
  return { title: symbol.toUpperCase() }
}

const TABS = ['overview', 'trend', 'financials'] as const
type Tab = (typeof TABS)[number]

export default async function TickerPage({
  params,
  searchParams,
}: {
  params: Promise<Params>
  searchParams: Promise<Search>
}) {
  const { symbol } = await params
  const { tab: rawTab } = await searchParams
  const sym = symbol.toUpperCase()
  const data = await getTicker(sym)
  if (!data) notFound()

  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? '') ? (rawTab as Tab) : 'overview'
  const base = `/ticker/${sym}`

  const trendActuals = data.eps
    .filter((p) => !p.isForecast)
    .map((p) => ({ fiscalPeriod: p.fiscalPeriod, epsActual: p.epsActual }))
  const prediction = predictEps(data.eps, 4)

  const actuals = data.eps.filter((p) => !p.isForecast)
  const qoqBars = actuals
    .map((p, i) =>
      i === 0 || p.epsActual == null || actuals[i - 1].epsActual == null
        ? null
        : { label: p.fiscalPeriod, delta: Number((p.epsActual - actuals[i - 1].epsActual!).toFixed(2)) },
    )
    .filter((b): b is { label: string; delta: number } => b != null)

  return (
    <div className="space-y-6">
      <BackLink href="/" label="Watchlist" />

      <PageHeader
        title={
          <span className="flex items-baseline gap-3">
            {sym}
            {data.name ? <span className="text-base font-normal text-muted">{data.name}</span> : null}
          </span>
        }
        description={
          data.valuation.price != null
            ? `${usd(data.valuation.price)} · ${bigUsd(data.valuation.marketCap)} market cap`
            : 'No valuation on file yet — refresh to pull data.'
        }
        actions={
          <div className="flex items-center gap-2">
            <RefreshButton symbol={sym} />
            <RemoveTickerButton symbol={sym} redirectHome />
          </div>
        }
      />

      <Tabs
        currentPath={`${base}${tab === 'overview' ? '' : `?tab=${tab}`}`}
        items={[
          { label: 'Overview', href: base, active: tab === 'overview' },
          { label: 'EPS Trend', href: `${base}?tab=trend`, active: tab === 'trend' },
          { label: 'Financials', href: `${base}?tab=financials`, active: tab === 'financials' },
        ]}
      />

      {tab === 'overview' ? <Scorecard data={data} /> : null}

      {tab === 'trend' ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Quarterly EPS · actual + next 4Q forecast</CardTitle>
            </CardHeader>
            <CardContent>
              {trendActuals.length ? (
                <>
                  <EpsTrendChart actuals={trendActuals} prediction={prediction} />
                  {prediction.length ? (
                    <p className="mt-2 text-xs text-muted">
                      Forecast = next {prediction.length} quarters. Filled points use analyst consensus;
                      hollow points are a seasonal growth model (same quarter a year ago × trailing YoY
                      growth). Estimates only — not investment advice.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted">No EPS history yet.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>QoQ EPS deltas</CardTitle>
            </CardHeader>
            <CardContent>
              {qoqBars.length ? (
                <QoqDeltaChart bars={qoqBars} />
              ) : (
                <p className="text-sm text-muted">Not enough history for deltas.</p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'financials' ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Valuation (as of {data.valuation.asOf ?? '—'})</CardTitle>
            </CardHeader>
            <CardContent>
              <KeyValueList>
                <KeyValue label="Price" value={usd(data.valuation.price)} />
                <KeyValue label="Market cap" value={bigUsd(data.valuation.marketCap)} />
                <KeyValue label="Trailing P/E" value={data.valuation.trailingPe != null ? `${num(data.valuation.trailingPe)}×` : '—'} />
                <KeyValue label="Forward P/E" value={data.valuation.forwardPe != null ? `${num(data.valuation.forwardPe)}×` : '—'} />
                <KeyValue label="Net margin (TTM)" value={marginPct(data.valuation.netMarginTtm)} />
                <KeyValue label="Gross margin (TTM)" value={marginPct(data.valuation.grossMarginTtm)} />
                <KeyValue label="Operating margin (TTM)" value={marginPct(data.valuation.operatingMarginTtm)} />
                <KeyValue label="ROI (TTM)" value={marginPct(data.valuation.roiTtm)} />
              </KeyValueList>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Annual financials</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {data.annual.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm tabular-nums">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted [&>th]:px-6 [&>th]:py-2.5">
                        <th className="font-semibold">Fiscal year</th>
                        <th className="font-semibold">Revenue</th>
                        <th className="font-semibold">Net income</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.annual.map((a) => (
                        <tr
                          key={a.fiscalYear}
                          className="border-b border-border transition-colors last:border-0 hover:bg-primary-soft/40 [&>td]:px-6 [&>td]:py-2.5"
                        >
                          <td className="font-semibold text-foreground">{a.fiscalYear}</td>
                          <td>{bigUsd(a.revenue)}</td>
                          <td>{bigUsd(a.netIncome)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-6 text-sm text-muted">No annual financials on file.</p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
