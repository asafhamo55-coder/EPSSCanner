// Forward EPS prediction for the trend chart.
//
// FMP's free tier only carries ~1-2 quarters of analyst consensus, so to show a
// full next-4-quarters outlook we blend two sources, in order:
//   1. analyst consensus  — the stored forecast rows, used for the near term;
//   2. a seasonal growth model — for quarters beyond consensus: take the same
//      quarter a year earlier and grow it by the trailing year-over-year rate
//      (averaged over recent quarters with a positive year-ago base).
// Each predicted point is tagged with its source so the UI can distinguish the
// real consensus from the model extrapolation.

export interface EpsHistoryPoint {
  fiscalPeriod: string
  epsActual: number | null
  epsEstimate: number | null
  isForecast: boolean
}

export interface EpsPrediction {
  fiscalPeriod: string
  eps: number
  source: 'consensus' | 'model'
}

/** 'YYYYQn' → the following quarter's label ('2026Q4' → '2027Q1'). */
function nextFiscalPeriod(label: string): string {
  const m = /^(\d{4})Q([1-4])$/.exec(label)
  if (!m) return `${label}+`
  let year = Number(m[1])
  let q = Number(m[2]) + 1
  if (q > 4) {
    q = 1
    year += 1
  }
  return `${year}Q${q}`
}

export function predictEps(history: EpsHistoryPoint[], count = 4): EpsPrediction[] {
  const actuals = history.filter(
    (p): p is EpsHistoryPoint & { epsActual: number } => !p.isForecast && p.epsActual != null,
  )
  const consensus = history.filter((p) => p.isForecast && p.epsEstimate != null)
  const n = actuals.length
  if (n === 0) return []

  const a = actuals.map((p) => p.epsActual)

  // Trailing YoY growth, averaged over the last few quarters whose year-ago
  // base is positive (so the ratio is meaningful). Clamped to a sane band.
  const growths: number[] = []
  for (let i = n - 1; i >= 4 && growths.length < 4; i--) {
    if (a[i - 4] > 0) growths.push(a[i] / a[i - 4] - 1)
  }
  let g = growths.length ? growths.reduce((s, x) => s + x, 0) / growths.length : 0
  g = Math.max(-0.95, Math.min(5, g))

  const out: EpsPrediction[] = []
  let lastLabel = actuals[n - 1].fiscalPeriod

  for (let k = 0; k < count; k++) {
    const c = consensus[k]
    if (c && c.epsEstimate != null) {
      out.push({ fiscalPeriod: c.fiscalPeriod, eps: round2(c.epsEstimate), source: 'consensus' })
      lastLabel = c.fiscalPeriod
      continue
    }
    // Seasonal model: same quarter a year earlier, grown by g. Falls back to
    // chaining off the previous prediction when history is shorter than a year.
    const seasonIdx = n - 4 + k
    const base = seasonIdx >= 0 && seasonIdx < n ? a[seasonIdx] : out.length ? out[out.length - 1].eps : a[n - 1]
    const label = nextFiscalPeriod(lastLabel)
    out.push({ fiscalPeriod: label, eps: round2(base * (1 + g)), source: 'model' })
    lastLabel = label
  }
  return out
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
