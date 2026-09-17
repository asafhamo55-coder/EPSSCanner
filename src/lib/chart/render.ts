// Chart PNG for one pick: 126-day closes, the 150-day SMA, the regression
// channel rails, and the golden-zone band.
//
// Email clients run no JavaScript and Gmail strips inline SVG, so a real chart
// has to arrive as a raster image at a URL. This is the only module in the
// email path with a native dependency, which is why every failure mode here
// returns null instead of throwing: a chart that cannot be drawn degrades the
// email to the v1 CSS bars, and the digest still goes out.

import type { Technicals } from '@/lib/technicals'
import { GOLDEN_ZONE_HIGH, GOLDEN_ZONE_LOW } from '@/lib/technicals'

/** 2× the displayed size so the PNG is sharp on retina displays. */
const W = 1128
const H = 440
const PAD = { top: 20, right: 74, bottom: 34, left: 20 }

const COLORS = {
  bg: '#ffffff',
  grid: '#eef2f7',
  axis: '#94a3b8',
  price: '#0f172a',
  sma: '#4f46e5',
  rail: '#cbd5e1',
  /** The channel's centreline — same hue as `rail`, but translucent, so it
   *  reads as a lighter reference line rather than a third boundary. */
  railMid: 'rgba(148, 163, 184, 0.55)',
  golden: 'rgba(217, 119, 6, 0.13)',
  last: '#059669',
}

export interface ChartInput {
  symbol: string
  technicals: Technicals
}

export async function renderChart(input: ChartInput): Promise<Buffer | null> {
  try {
    // Everything is inside the guard, including reading `input` itself. The
    // whole point of this module is that a chart which cannot be drawn
    // degrades the email rather than failing the cron that produced it, and a
    // statement outside the guard is a hole in exactly that promise — however
    // well-typed the current caller happens to be.
    const bars = input.technicals?.visible ?? []
    if (bars.length < 2) return null
    const t = input.technicals

    // Imported lazily so a missing or incompatible native binary fails HERE,
    // where it is caught, rather than at module load — which would take down
    // the whole ingest route rather than just the chart.
    const { createCanvas } = await import('@napi-rs/canvas')
    const canvas = createCanvas(W, H)
    const ctx = canvas.getContext('2d')

    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, W, H)

    // ── Scales ────────────────────────────────────────────────────
    const series: number[] = bars.map((b) => b.c)
    const smas = t.sma150.filter((v): v is number => v != null)
    const rails = t.channel ? [...t.channel.upper, ...t.channel.lower] : []
    const all = [...series, ...smas, ...rails]
    let lo = Math.min(...all)
    let hi = Math.max(...all)
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) return null
    const padY = (hi - lo) * 0.08
    lo -= padY
    hi += padY

    const plotW = W - PAD.left - PAD.right
    const plotH = H - PAD.top - PAD.bottom
    const x = (i: number) => PAD.left + (i / (bars.length - 1)) * plotW
    const y = (p: number) => PAD.top + (1 - (p - lo) / (hi - lo)) * plotH

    // ── Golden-zone band ──────────────────────────────────────────
    if (t.fib) {
      const span = t.fib.high - t.fib.low
      const at = (ratio: number) =>
        t.fib!.direction === 'rally' ? t.fib!.high - span * ratio : t.fib!.low + span * ratio
      const a = y(at(GOLDEN_ZONE_LOW))
      const b = y(at(GOLDEN_ZONE_HIGH))
      ctx.fillStyle = COLORS.golden
      ctx.fillRect(PAD.left, Math.min(a, b), plotW, Math.abs(b - a))
    }

    // ── Horizontal gridlines + right-hand price axis ──────────────
    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 2
    ctx.font = '20px sans-serif'
    ctx.fillStyle = COLORS.axis
    ctx.textBaseline = 'middle'
    for (let g = 0; g <= 4; g++) {
      const price = lo + ((hi - lo) * g) / 4
      const py = y(price)
      ctx.beginPath()
      ctx.moveTo(PAD.left, py)
      ctx.lineTo(PAD.left + plotW, py)
      ctx.stroke()
      ctx.fillText(`$${price.toFixed(0)}`, PAD.left + plotW + 10, py)
    }

    // ── Channel rails ─────────────────────────────────────────────
    if (t.channel) {
      ctx.strokeStyle = COLORS.rail
      ctx.lineWidth = 2
      ctx.setLineDash([8, 8])
      for (const rail of [t.channel.upper, t.channel.lower]) {
        ctx.beginPath()
        rail.forEach((p, i) => (i === 0 ? ctx.moveTo(x(i), y(p)) : ctx.lineTo(x(i), y(p))))
        ctx.stroke()
      }
      // Mid rail (spec §4.2): the channel's centreline. `channel.mid` was
      // already computed and drawn on the dashboard, but never on this
      // chart — a thinner, finer-dashed, translucent line so it reads as a
      // centreline reference rather than a third boundary competing with
      // the upper/lower rails.
      ctx.strokeStyle = COLORS.railMid
      ctx.lineWidth = 1.5
      ctx.setLineDash([3, 5])
      ctx.beginPath()
      t.channel.mid.forEach((p, i) => (i === 0 ? ctx.moveTo(x(i), y(p)) : ctx.lineTo(x(i), y(p))))
      ctx.stroke()
      ctx.setLineDash([])
    }

    // ── SMA 150 ───────────────────────────────────────────────────
    ctx.strokeStyle = COLORS.sma
    ctx.lineWidth = 3
    ctx.beginPath()
    let started = false
    t.sma150.forEach((v, i) => {
      if (v == null) return
      if (!started) { ctx.moveTo(x(i), y(v)); started = true } else ctx.lineTo(x(i), y(v))
    })
    if (started) ctx.stroke()

    // ── Price ─────────────────────────────────────────────────────
    ctx.strokeStyle = COLORS.price
    ctx.lineWidth = 4
    ctx.beginPath()
    series.forEach((p, i) => (i === 0 ? ctx.moveTo(x(i), y(p)) : ctx.lineTo(x(i), y(p))))
    ctx.stroke()

    // ── Last close marker ─────────────────────────────────────────
    const lastX = x(bars.length - 1)
    const lastY = y(series[series.length - 1])
    ctx.fillStyle = COLORS.last
    ctx.beginPath()
    ctx.arc(lastX, lastY, 7, 0, Math.PI * 2)
    ctx.fill()

    // ── Date axis ─────────────────────────────────────────────────
    // Spec §4.2 also asks for this — PAD.bottom (34px) was reserved for it
    // from the start, but nothing drew into it. 4 evenly spaced labels
    // (first bar, last bar, two between), short month/day format matching
    // the dashboard's own convention (dayLabel() in
    // components/charts/TechnicalChart.tsx: Unix seconds → 'Mon D').
    // Alignment varies at the two ends so the label doesn't run past the
    // plot edge — 'center' for interior labels is fine since PAD.left/right
    // leave room either side of the first/last bar's x position.
    const DATE_LABEL_COUNT = 4
    ctx.fillStyle = COLORS.axis
    ctx.font = '20px sans-serif'
    ctx.textBaseline = 'top'
    const labelIdx = new Set<number>()
    for (let k = 0; k < DATE_LABEL_COUNT; k++) {
      labelIdx.add(Math.round((k / (DATE_LABEL_COUNT - 1)) * (bars.length - 1)))
    }
    for (const i of labelIdx) {
      const label = new Date(bars[i].t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      ctx.textAlign = i === 0 ? 'left' : i === bars.length - 1 ? 'right' : 'center'
      ctx.fillText(label, x(i), H - PAD.bottom + 6)
    }

    return canvas.toBuffer('image/png')
  } catch (e) {
    console.error(`[chart] render failed for ${input?.symbol ?? 'unknown'}: ${(e as Error).message}`)
    return null
  }
}
