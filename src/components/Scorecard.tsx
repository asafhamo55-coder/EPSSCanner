import { Card, CardContent, CardHeader, KeyValue, KeyValueList } from '@/ui'
import type { TickerData } from '@/lib/queries'
import { marginPct, num, pct, ratio } from '@/lib/format'
import { SignalChip } from './SignalChip'

// The 5-step scorecard — each card shows the real numbers behind the signal
// plus its pass/flag/fail chip. The numeric breakdown uses shared KeyValue
// rows, matching the HOA detail-page language.

function StepCard({
  step,
  title,
  chip,
  children,
  footer,
}: {
  step: number
  title: string
  chip: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Step {step}</p>
          <h3 className="text-base font-semibold leading-tight">{title}</h3>
        </div>
        {chip}
      </CardHeader>
      <CardContent>
        <KeyValueList>{children}</KeyValueList>
        {footer}
      </CardContent>
    </Card>
  )
}

function bool(v: boolean | null): string {
  if (v == null) return '—'
  return v ? 'Yes' : 'No'
}

function billions(v: number | null): string {
  if (v == null) return '—'
  return (v / 1e9).toFixed(1)
}

// The actual per-year revenue & net-income numbers behind the step-2 verdict,
// coloured green/red by year-over-year direction so the "rising" call is visible.
function AnnualMiniTable({
  annual,
}: {
  annual: { fiscalYear: number; revenue: number | null; netIncome: number | null }[]
}) {
  if (!annual.length) return null
  const rows = [
    { label: 'Revenue', key: 'revenue' as const },
    { label: 'Net income', key: 'netIncome' as const },
  ]
  return (
    <div className="mt-3 overflow-x-auto border-t border-border pt-3">
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-muted [&>th]:px-1.5 [&>th]:py-1 [&>th]:text-right">
            <th className="text-left font-medium">$bn</th>
            {annual.map((a) => (
              <th key={a.fiscalYear} className="font-medium">
                {a.fiscalYear}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="[&>td]:px-1.5 [&>td]:py-1 [&>td]:text-right">
              <td className="text-left font-medium text-foreground">{r.label}</td>
              {annual.map((a, i) => {
                const v = a[r.key]
                const prev = i > 0 ? annual[i - 1][r.key] : null
                const cls =
                  v != null && prev != null ? (v > prev ? 'text-pos' : v < prev ? 'text-neg' : '') : ''
                return (
                  <td key={a.fiscalYear} className={cls}>
                    {billions(v)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Scorecard({ data }: { data: TickerData }) {
  const sc = data.scorecard
  const yoyText =
    sc.yoy.state === 'turnaround'
      ? 'Loss → profit'
      : sc.yoy.ratio != null
        ? `${ratio(sc.yoy.ratio)} (${pct(sc.yoy.pct)})`
        : '—'
  const qoqLabel = sc.qoq.label === 'na' ? 'N/A' : sc.qoq.label[0].toUpperCase() + sc.qoq.label.slice(1)

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <StepCard
        step={1}
        title="P/E reasonableness"
        chip={<SignalChip state={sc.pe.state} />}
      >
        <KeyValue label="Trailing P/E" value={sc.pe.trailingPe != null ? `${num(sc.pe.trailingPe, 2)}×` : '—'} />
        <KeyValue label="In 20–30 band" value={sc.pe.trailingPe == null ? '—' : bool(sc.pe.inBand)} />
        <KeyValue label="Premium (>30×)" value={sc.pe.trailingPe == null ? '—' : bool(sc.pe.premiumFlag)} />
      </StepCard>

      <StepCard
        step={2}
        title="Fundamentals trend (5 yr)"
        chip={<SignalChip state={sc.fundamentals.state} />}
        footer={<AnnualMiniTable annual={data.annual} />}
      >
        <KeyValue label="Revenue rising" value={bool(sc.fundamentals.revenueGrowing)} />
        <KeyValue label="Net income rising" value={bool(sc.fundamentals.netIncomeGrowing)} />
        <KeyValue label="Net margin (TTM)" value={marginPct(sc.fundamentals.netMarginTtm)} />
      </StepCard>

      <StepCard
        step={3}
        title="QoQ EPS growth"
        chip={
          <SignalChip
            state={sc.yoy.state}
            label={sc.yoy.state === 'na' ? 'N/A' : sc.yoy.state === 'turnaround' ? 'Turnaround' : pct(sc.yoy.pct)}
          />
        }
      >
        <KeyValue label="EPS (latest Q)" value={num(sc.yoy.epsQ)} />
        <KeyValue label="EPS (year ago)" value={num(sc.yoy.epsQ4)} />
        <KeyValue label="Growth" value={yoyText} />
      </StepCard>

      <StepCard
        step={4}
        title="QoQ EPS delta trend"
        chip={<SignalChip state={sc.qoq.state} label={qoqLabel} />}
      >
        <KeyValue label="Trend" value={qoqLabel} />
        <KeyValue label="Slope" value={sc.qoq.slope != null ? num(sc.qoq.slope, 3) : '—'} />
        <KeyValue
          label="Recent deltas"
          value={sc.qoq.deltas.length ? sc.qoq.deltas.map((d) => `${d > 0 ? '+' : ''}${d.toFixed(2)}`).join('  ') : '—'}
        />
      </StepCard>

      <StepCard
        step={5}
        title="Forward growth (P/E)"
        chip={<SignalChip state={sc.fwd.state} label={sc.fwd.state === 'na' ? 'N/A' : pct(sc.fwd.pct)} />}
      >
        <KeyValue label="Trailing P/E" value={sc.fwd.trailingPe != null ? `${num(sc.fwd.trailingPe)}×` : '—'} />
        <KeyValue label="Forward P/E" value={sc.fwd.forwardPe != null ? `${num(sc.fwd.forwardPe)}×` : '—'} />
        <KeyValue label="Trailing ÷ Forward" value={sc.fwd.ratio != null ? ratio(sc.fwd.ratio) : '—'} />
        <KeyValue label="Implied growth" value={sc.fwd.state === 'na' ? '—' : pct(sc.fwd.pct)} />
      </StepCard>

      <Card className="bg-background/40">
        <CardHeader className="pb-3">
          <p className="text-xs uppercase tracking-wide text-muted">Composite</p>
          <h3 className="text-base font-semibold leading-tight">Signals passing</h3>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-foreground">
            {sc.passing}
            <span className="text-lg font-medium text-muted">/{sc.scored}</span>
          </p>
          <p className="mt-1 text-sm text-muted">
            Signals shown for your own judgment — not a buy/avoid verdict.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
