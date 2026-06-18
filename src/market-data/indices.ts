import { unstable_cache } from 'next/cache'
import { fetchChartYtd, fetchSummary, num } from './providers/yahoo'

// Key-indices comparison panel data.
//
// What's genuinely real-time (free, via Yahoo):
//   • YTD return      → the index's own price series (^RUT, ^NDX, ^GSPC).
//   • Trailing/Fwd PE → the index's tracking ETF (IWM, QQQ, SPY), which Yahoo
//                       reports PE for; an index itself has none.
// What is NOT (no free real-time source — analyst consensus aggregates):
//   • Forward EPS growth (2026 / 2027) → maintained constants below.
//
// Every live field degrades gracefully to the seeded constant on any error, so
// the panel always renders even when Yahoo is unreachable.

export type Accent = 'amber' | 'violet' | 'emerald' | 'sky'

interface IndexConfig {
  key: string
  name: string
  region: string
  accent: Accent
  /** Index ticker for the live YTD series; null = use the static seed only. */
  indexSymbol: string | null
  /** Tracking ETF whose PE proxies the index; null = use the static PE seed. */
  peProxy: string | null
  /** Seeds: fallbacks for the live fields + the (always-static) EPS estimates. */
  seed: {
    ytdPct: number
    trailingPe: number
    forwardPe: number
    eps2026: string
    eps2027: string
  }
}

// EPS-growth ranges + seed PEs sourced from the provided research deck.
const INDICES: IndexConfig[] = [
  {
    key: 'rut',
    name: 'Russell 2000',
    region: 'US · Small Cap',
    accent: 'amber',
    indexSymbol: '^RUT',
    peProxy: 'IWM',
    seed: { ytdPct: 17.6, trailingPe: 35, forwardPe: 25, eps2026: '+25–30%', eps2027: '+15–20%' },
  },
  {
    key: 'ndx',
    name: 'Nasdaq-100',
    region: 'US · Tech',
    accent: 'violet',
    indexSymbol: '^NDX',
    peProxy: 'QQQ',
    seed: { ytdPct: 17.5, trailingPe: 32, forwardPe: 24.5, eps2026: '+25–30%', eps2027: '+15–18%' },
  },
  {
    key: 'spx',
    name: 'S&P 500',
    region: 'US · Large Cap',
    accent: 'emerald',
    indexSymbol: '^GSPC',
    peProxy: 'SPY',
    seed: { ytdPct: 8.4, trailingPe: 25.5, forwardPe: 21.8, eps2026: '+24%', eps2027: '+13–15%' },
  },
  {
    // TA-35 has no clean free index symbol / ETF proxy on Yahoo, so its figures
    // stay on the seeded research values rather than risk fetching the wrong
    // index (e.g. TA-125).
    key: 'ta35',
    name: 'TA-35',
    region: 'Israel · Large Cap',
    accent: 'sky',
    indexSymbol: null,
    peProxy: null,
    seed: { ytdPct: 14.2, trailingPe: 22.5, forwardPe: 20.5, eps2026: '+8–10%', eps2027: '+8–10%' },
  },
]

export interface IndexCardData {
  key: string
  name: string
  region: string
  accent: Accent
  ytdPct: number | null
  trailingPe: number | null
  forwardPe: number | null
  eps2026: string
  eps2027: string
  /** True when at least one field on this card came back live this load. */
  live: boolean
}

async function resolveIndex(cfg: IndexConfig): Promise<IndexCardData> {
  let ytdPct = cfg.seed.ytdPct
  let trailingPe = cfg.seed.trailingPe
  let forwardPe = cfg.seed.forwardPe
  let live = false

  if (cfg.indexSymbol) {
    try {
      const ytd = await fetchChartYtd(cfg.indexSymbol)
      if (ytd.ytdPct != null) {
        ytdPct = ytd.ytdPct
        live = true
      }
    } catch {
      /* keep seed */
    }
  }

  if (cfg.peProxy) {
    try {
      const s = await fetchSummary(cfg.peProxy)
      const tp = num(s.summaryDetail?.trailingPE)
      const fp = num(s.summaryDetail?.forwardPE) ?? num(s.defaultKeyStatistics?.forwardPE)
      if (tp != null) {
        trailingPe = tp
        live = true
      }
      if (fp != null) {
        forwardPe = fp
        live = true
      }
    } catch {
      /* keep seed */
    }
  }

  return {
    key: cfg.key,
    name: cfg.name,
    region: cfg.region,
    accent: cfg.accent,
    ytdPct,
    trailingPe,
    forwardPe,
    eps2026: cfg.seed.eps2026,
    eps2027: cfg.seed.eps2027,
    live,
  }
}

async function loadIndices(): Promise<IndexCardData[]> {
  return Promise.all(INDICES.map(resolveIndex))
}

/** Cached for 15 min so a busy dashboard never hammers Yahoo. */
export const getIndices = unstable_cache(loadIndices, ['key-indices-v1'], {
  revalidate: 900,
})
