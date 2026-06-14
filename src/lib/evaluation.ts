// Reverse-DCF / multiple-based company valuation model.
//
// Mirrors the spreadsheet methodology:
//   revenue[i]     = baseRevenue * (1 + growth)^i
//   netIncome[i]   = revenue[i] * margin
//   marketCap[i]   = netIncome[i] * peMultiple            (per scenario)
//   cagr           = (marketCap[N] / currentMarketCap)^(1/N) - 1
//   priceTerminal  = currentPrice * (marketCap[N] / currentMarketCap)
//   fairToday      = priceTerminal / (1 + discountRate)^N
//   marginOfSafety = (fairToday - currentPrice) / fairToday
//
// All monetary inputs are in the same unit (the UI uses $bn for revenue /
// market cap and $ for price). The math is unit-agnostic.

export interface EvalScenario {
  label: string // 'Low' | 'Medium' | 'High'
  pe: number
}

export interface EvalInputs {
  symbol: string
  baseYear: number
  years: number // projection horizon N (e.g. 5 → N+1 columns)
  baseRevenue: number // year-0 revenue ($bn)
  revenueGrowth: number // fraction, e.g. 0.10
  profitMargin: number // fraction, e.g. 0.30
  currentMarketCap: number // $bn
  currentPrice: number // $
  discountRate: number // fraction, e.g. 0.12
  scenarios: EvalScenario[]
}

export interface ScenarioResult extends EvalScenario {
  marketCaps: number[] // per projected year
  cagr: number // fraction
  priceTerminal: number // implied share price at the final year
  fairToday: number // discounted fair value today
  marginOfSafety: number // fraction; >0 = undervalued vs current price
}

export interface EvalResult {
  years: number[]
  revenue: number[]
  netIncome: number[]
  scenarios: ScenarioResult[]
}

export function computeEvaluation(inp: EvalInputs): EvalResult {
  const n = Math.max(0, Math.floor(inp.years))
  const years: number[] = []
  const revenue: number[] = []
  const netIncome: number[] = []

  for (let i = 0; i <= n; i++) {
    years.push(inp.baseYear + i)
    const rev = inp.baseRevenue * Math.pow(1 + inp.revenueGrowth, i)
    revenue.push(rev)
    netIncome.push(rev * inp.profitMargin)
  }

  const scenarios = inp.scenarios.map<ScenarioResult>((s) => {
    const marketCaps = netIncome.map((ni) => ni * s.pe)
    const mcTerminal = marketCaps[n]
    const cagr =
      inp.currentMarketCap > 0 && n > 0
        ? Math.pow(mcTerminal / inp.currentMarketCap, 1 / n) - 1
        : 0
    const priceTerminal =
      inp.currentMarketCap > 0 ? inp.currentPrice * (mcTerminal / inp.currentMarketCap) : 0
    const fairToday = priceTerminal / Math.pow(1 + inp.discountRate, n)
    const marginOfSafety = fairToday > 0 ? (fairToday - inp.currentPrice) / fairToday : 0
    return { ...s, marketCaps, cagr, priceTerminal, fairToday, marginOfSafety }
  })

  return { years, revenue, netIncome, scenarios }
}

export const DEFAULT_SCENARIOS: EvalScenario[] = [
  { label: 'Low', pe: 20 },
  { label: 'Medium', pe: 25 },
  { label: 'High', pe: 30 },
]
