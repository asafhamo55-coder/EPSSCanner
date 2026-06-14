'use client'

import { useMemo, useState, useTransition } from 'react'
import { Search } from 'lucide-react'
import { Card } from '@/ui'
import { computeEvaluation, type EvalInputs } from '@/lib/evaluation'
import { prefillEvaluation } from '@/app/actions'

// Form keeps rates in percent units (what the user types); converted to
// fractions when fed to the pure model.
interface Form {
  symbol: string
  name: string | null
  baseYear: number
  years: number
  baseRevenue: number
  revenueGrowthPct: number
  profitMarginPct: number
  currentMarketCap: number
  currentPrice: number
  discountRatePct: number
  peLow: number
  peMed: number
  peHigh: number
}

// Default = the ABNB worked example, so the model renders immediately.
const ABNB: Form = {
  symbol: 'ABNB',
  name: 'Airbnb, Inc.',
  baseYear: 2025,
  years: 5,
  baseRevenue: 12.1,
  revenueGrowthPct: 10,
  profitMarginPct: 30,
  currentMarketCap: 79,
  currentPrice: 132.28,
  discountRatePct: 12,
  peLow: 20,
  peMed: 25,
  peHigh: 30,
}

function fmt(n: number, dp = 1): string {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}
function pctFmt(frac: number): string {
  if (!Number.isFinite(frac)) return '—'
  const v = frac * 100
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
}

function NumField({
  label,
  value,
  onChange,
  step = 1,
  suffix,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  step?: number
  suffix?: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="relative">
        <input
          type="number"
          step={step}
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
          className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground focus:border-primary focus:outline-none"
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
            {suffix}
          </span>
        ) : null}
      </div>
    </label>
  )
}

export function EvaluationView() {
  const [form, setForm] = useState<Form>(ABNB)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function set<K extends keyof Form>(key: K, val: Form[K]) {
    setForm((f) => ({ ...f, [key]: val }))
  }

  function loadTicker(e: React.FormEvent) {
    e.preventDefault()
    const sym = search.trim().toUpperCase()
    if (!sym) return
    setError(null)
    startTransition(async () => {
      const res = await prefillEvaluation(sym)
      if (!res.ok || !res.data) {
        setError(res.error ?? 'Could not load that ticker.')
        return
      }
      const d = res.data
      setForm((f) => ({
        ...f,
        symbol: d.symbol,
        name: d.name,
        baseYear: d.baseYear,
        baseRevenue: d.baseRevenue,
        revenueGrowthPct: Math.round(d.revenueGrowth * 1000) / 10,
        profitMarginPct: Math.round(d.profitMargin * 1000) / 10,
        currentMarketCap: d.currentMarketCap,
        currentPrice: d.currentPrice,
      }))
    })
  }

  const inputs: EvalInputs = useMemo(
    () => ({
      symbol: form.symbol,
      baseYear: form.baseYear,
      years: form.years,
      baseRevenue: form.baseRevenue,
      revenueGrowth: form.revenueGrowthPct / 100,
      profitMargin: form.profitMarginPct / 100,
      currentMarketCap: form.currentMarketCap,
      currentPrice: form.currentPrice,
      discountRate: form.discountRatePct / 100,
      scenarios: [
        { label: 'Low', pe: form.peLow },
        { label: 'Medium', pe: form.peMed },
        { label: 'High', pe: form.peHigh },
      ],
    }),
    [form],
  )

  const result = useMemo(() => computeEvaluation(inputs), [inputs])
  const lastYear = result.years[result.years.length - 1]

  return (
    <div className="space-y-6">
      {/* Ticker search */}
      <form onSubmit={loadTicker} className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a ticker (e.g. ABNB, AAPL)…"
            className="h-9 w-64 rounded-lg border border-border bg-surface pl-8 pr-3 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Loading…' : 'Load real data'}
        </button>
        <span className="text-sm text-muted">
          Evaluating <span className="font-semibold text-foreground">{form.symbol}</span>
          {form.name ? ` · ${form.name}` : ''}
        </span>
      </form>
      {error ? <p className="text-sm text-neg">{error}</p> : null}

      {/* Assumptions */}
      <Card className="p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Assumptions</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <NumField label="Base year" value={form.baseYear} step={1} onChange={(n) => set('baseYear', n)} />
          <NumField label="Horizon (years)" value={form.years} step={1} onChange={(n) => set('years', n)} />
          <NumField label="Base revenue" suffix="$bn" step={0.1} value={form.baseRevenue} onChange={(n) => set('baseRevenue', n)} />
          <NumField label="Revenue growth" suffix="%" step={0.5} value={form.revenueGrowthPct} onChange={(n) => set('revenueGrowthPct', n)} />
          <NumField label="Profit margin" suffix="%" step={0.5} value={form.profitMarginPct} onChange={(n) => set('profitMarginPct', n)} />
          <NumField label="Current market cap" suffix="$bn" step={1} value={form.currentMarketCap} onChange={(n) => set('currentMarketCap', n)} />
          <NumField label="Current price" suffix="$" step={0.5} value={form.currentPrice} onChange={(n) => set('currentPrice', n)} />
          <NumField label="Discount rate" suffix="%" step={0.5} value={form.discountRatePct} onChange={(n) => set('discountRatePct', n)} />
          <NumField label="P/E — Low" step={1} value={form.peLow} onChange={(n) => set('peLow', n)} />
          <NumField label="P/E — Medium" step={1} value={form.peMed} onChange={(n) => set('peMed', n)} />
          <NumField label="P/E — High" step={1} value={form.peHigh} onChange={(n) => set('peHigh', n)} />
        </div>
      </Card>

      {/* Projection */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-right [&>th]:px-4 [&>th]:py-2.5">
                <th className="text-left font-medium text-muted">Projection</th>
                {result.years.map((y) => (
                  <th key={y} className="font-semibold text-foreground">
                    {y}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="[&>tr>td]:px-4 [&>tr>td]:py-2.5 [&>tr>td]:text-right">
              <tr className="border-b border-border">
                <td className="text-left font-medium text-foreground">Revenue ($bn)</td>
                {result.revenue.map((v, i) => (
                  <td key={i}>{fmt(v)}</td>
                ))}
              </tr>
              <tr>
                <td className="text-left font-medium text-foreground">Net income ($bn)</td>
                {result.netIncome.map((v, i) => (
                  <td key={i}>{fmt(v)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Scenarios */}
      <div className="space-y-4">
        {result.scenarios.map((s) => (
          <Card key={s.label} className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="font-semibold text-foreground">
                {s.label} multiple <span className="text-muted">· P/E {fmt(s.pe, 0)}×</span>
              </p>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <span className="text-muted">
                  CAGR <span className="font-semibold text-foreground">{pctFmt(s.cagr)}</span>
                </span>
                <span className="text-muted">
                  Price ({lastYear}){' '}
                  <span className="font-semibold text-foreground">${fmt(s.priceTerminal, 1)}</span>
                </span>
                <span className="text-muted">
                  Fair value today{' '}
                  <span className="font-semibold text-foreground">${fmt(s.fairToday, 1)}</span>
                </span>
                <span className="text-muted">
                  Margin of safety{' '}
                  <span className={s.marginOfSafety >= 0 ? 'font-semibold text-pos' : 'font-semibold text-neg'}>
                    {pctFmt(s.marginOfSafety)}
                  </span>
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody className="[&>tr>td]:px-4 [&>tr>td]:py-2.5 [&>tr>td]:text-right">
                  <tr>
                    <td className="text-left font-medium text-foreground">Market cap ($bn)</td>
                    {s.marketCaps.map((v, i) => (
                      <td key={i}>{fmt(v)}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted">
        Fair value today = terminal price discounted at the discount rate. Margin of safety = (fair value −
        current price) ÷ fair value; positive means undervalued. Estimates only — not investment advice.
      </p>
    </div>
  )
}
