import type {
  AnnualRow,
  DataProvider,
  EpsRow,
  ValuationSnapshot,
} from '../provider'

// Deterministic fixture provider. Backs `pnpm test:screener` and offline dev
// (MARKET_DATA_PROVIDER=mock). The NVDA fixture reproduces the methodology
// deck's numbers exactly so the signals engine can be verified against them:
//
//   yoy:  eps[Q]=1.87 / eps[Q-4]=0.81 = 2.31 → +131%
//   qoq:  last-4 deltas +0.40, +0.32, +0.25, +0.09 → decelerating
//   fwd:  trailing 32.56 / forward 24.27 = 1.34 → +34%
//   fwd annual eps: 213.4 / 24.27 = 8.79

const QUARTERS = [
  '2023Q1', '2023Q2', '2023Q3', '2023Q4',
  '2024Q1', '2024Q2', '2024Q3', '2024Q4',
  '2025Q1', '2025Q2', '2025Q3', '2025Q4',
]
const PERIOD_ENDS = [
  '2023-04-30', '2023-07-31', '2023-10-31', '2024-01-31',
  '2024-04-30', '2024-07-31', '2024-10-31', '2025-01-31',
  '2025-04-30', '2025-07-31', '2025-10-31', '2026-01-31',
]

// Q-4 (index 7) = 0.81, Q (index 11) = 1.87; last-4 deltas decelerate.
const NVDA_EPS = [0.27, 0.35, 0.44, 0.51, 0.58, 0.65, 0.73, 0.81, 1.21, 1.53, 1.78, 1.87]
const NVDA_REV = [
  7192, 13507, 18120, 22103, 26044, 30040, 35082, 39331, 44062, 46743, 49000, 51200,
]

function buildEps(eps: number[], rev: number[], forecast: { eps: number; rev: number }[]): EpsRow[] {
  const actuals = eps.map<EpsRow>((v, i) => ({
    fiscalPeriod: QUARTERS[i],
    periodEnd: PERIOD_ENDS[i],
    epsActual: v,
    epsEstimate: null,
    revenueActual: rev[i],
    revenueEstimate: null,
    isForecast: false,
  }))
  const fc = forecast.map<EpsRow>((f, i) => ({
    fiscalPeriod: `2026Q${i + 2}`,
    periodEnd: i === 0 ? '2026-04-30' : '2026-07-31',
    epsActual: null,
    epsEstimate: f.eps,
    revenueActual: null,
    revenueEstimate: f.rev,
    isForecast: true,
  }))
  return [...actuals, ...fc]
}

const FIXTURES: Record<string, { eps: EpsRow[]; val: ValuationSnapshot; annual: AnnualRow[]; name: string }> = {
  NVDA: {
    name: 'NVIDIA Corporation',
    eps: buildEps(NVDA_EPS, NVDA_REV, [
      { eps: 2.01, rev: 53500 },
      { eps: 2.18, rev: 56100 },
    ]),
    val: {
      asOf: '2026-06-12',
      price: 213.4,
      trailingPe: 32.56,
      forwardPe: 24.27,
      peg5yr: 0.81,
      netMarginTtm: 0.5589,
      grossMarginTtm: 0.7501,
      operatingMarginTtm: 0.6213,
      roiTtm: 0.4471,
      marketCap: 5_210_000_000_000,
    },
    annual: [
      { fiscalYear: 2021, revenue: 16675, netIncome: 4332 },
      { fiscalYear: 2022, revenue: 26914, netIncome: 9752 },
      { fiscalYear: 2023, revenue: 60922, netIncome: 29760 },
      { fiscalYear: 2024, revenue: 96307, netIncome: 53008 },
      { fiscalYear: 2025, revenue: 130497, netIncome: 72880 },
    ],
  },
}

/** Deterministic synthetic series for any non-fixtured symbol so the dashboard
 *  renders in mock mode. Seeded off the symbol so it's stable across refreshes. */
function synthetic(symbol: string): { eps: EpsRow[]; val: ValuationSnapshot; annual: AnnualRow[]; name: string } {
  let seed = 0
  for (const ch of symbol) seed = (seed * 31 + ch.charCodeAt(0)) % 1000
  const base = 0.2 + (seed % 50) / 100
  const growth = 1.06 + (seed % 20) / 200
  const eps: number[] = []
  let v = base
  for (let i = 0; i < 12; i++) {
    eps.push(Number(v.toFixed(2)))
    v *= growth
  }
  const rev = eps.map((e) => Math.round(e * 18000))
  const trailingPe = 18 + (seed % 22)
  return {
    name: `${symbol} (mock)`,
    eps: buildEps(eps, rev, [
      { eps: Number((v * 1.01).toFixed(2)), rev: Math.round(v * 18000) },
    ]),
    val: {
      asOf: '2026-06-12',
      price: Number((eps[11] * trailingPe).toFixed(2)),
      trailingPe,
      forwardPe: trailingPe / (growth + 0.04),
      peg5yr: Number((trailingPe / (15 + (seed % 35))).toFixed(2)),
      netMarginTtm: 0.12 + (seed % 30) / 100,
      grossMarginTtm: 0.45 + (seed % 25) / 100,
      operatingMarginTtm: 0.18 + (seed % 20) / 100,
      roiTtm: 0.1 + (seed % 15) / 100,
      marketCap: Math.round(eps[11] * trailingPe * 1_000_000_00),
    },
    annual: [2021, 2022, 2023, 2024, 2025].map((fy, i) => ({
      fiscalYear: fy,
      revenue: Math.round(rev[i] * 4 * Math.pow(growth, i)),
      netIncome: Math.round(rev[i] * 0.5 * Math.pow(growth, i)),
    })),
  }
}

function lookup(symbol: string) {
  return FIXTURES[symbol.toUpperCase()] ?? synthetic(symbol.toUpperCase())
}

export class MockProvider implements DataProvider {
  async getProfile(symbol: string) {
    return { name: lookup(symbol).name, currency: 'USD' }
  }
  async getQuarterlyEps(symbol: string, quarters: number): Promise<EpsRow[]> {
    const all = lookup(symbol).eps
    const actuals = all.filter((r) => !r.isForecast).slice(-quarters)
    const forecasts = all.filter((r) => r.isForecast)
    return [...actuals, ...forecasts]
  }
  async getValuation(symbol: string): Promise<ValuationSnapshot> {
    return lookup(symbol).val
  }
  async getAnnualFinancials(symbol: string, years: number): Promise<AnnualRow[]> {
    return lookup(symbol).annual.slice(-years)
  }
}
