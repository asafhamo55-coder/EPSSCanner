'use client'

import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { tokens } from '@/ui'
import { usd } from '@/lib/format'
import { VISIBLE_BARS, type Technicals, type Verdict } from '@/lib/technicals'

// Daily candlestick with the regression tunnel, the 150-day SMA, Fibonacci
// retracement levels and any still-open gaps, under a verdict banner.
//
// The verdict comes from the tunnel position ALONE. Gaps, SMA and Fib are
// context a trader reads next to it — they are never scored, so they render
// visually subordinate to the banner and never inside it.

const VERDICT_COPY: Record<Verdict, string> = {
  'dont-buy': "DON'T BUY",
  opportunity: 'OPPORTUNITY',
  fair: 'FAIR',
  'insufficient-history': 'NOT ENOUGH HISTORY',
}

// Banner chrome mirrors the Alert palette so the three tones read the same as
// every other status surface in the app.
const VERDICT_BANNER: Record<Verdict, string> = {
  'dont-buy': 'border-red-200 bg-red-50 text-red-900',
  opportunity: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  fair: 'border-border bg-background text-foreground',
  'insufficient-history': 'border-border bg-background text-foreground',
}

const VERDICT_METER: Record<Verdict, string> = {
  'dont-buy': 'bg-red-600',
  opportunity: 'bg-emerald-600',
  fair: 'bg-foreground/50',
  'insufficient-history': 'bg-foreground/50',
}

/** Unix SECONDS → the short axis label ('Mar 14'). */
function dayLabel(t: number): string {
  return new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function ratioLabel(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

function signedPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

export function TechnicalChart({ data, symbol }: { data: Technicals; symbol: string }) {
  const { visible, sma150, channel, fib, gaps, verdict, positionPct, windowBars } = data

  const option = useMemo(() => {
    const labels = visible.map((b) => dayLabel(b.t))
    // ECharts candlestick wants [open, close, low, high] — NOT OHLC.
    const candles = visible.map((b) => [b.o, b.c, b.l, b.h])
    const lastLabel = labels[labels.length - 1]

    const fibLines = (fib?.levels ?? []).map((l) => ({
      yAxis: l.price,
      label: {
        formatter: `${ratioLabel(l.ratio)} · ${usd(l.price)}`,
        position: 'insideEndTop' as const,
        fontSize: 10,
        color: tokens.screener.muted,
      },
    }))

    // An open gap stays relevant from the day it printed through today, so the
    // band runs from that bar to the right edge rather than sitting on the two
    // bars that produced it.
    const gapAreas = gaps.map((g) => {
      const startIdx = visible.findIndex((b) => b.t === g.fromT)
      const color = g.direction === 'up' ? tokens.screener.pos : tokens.screener.neg
      return [
        {
          xAxis: labels[startIdx >= 0 ? startIdx : 0],
          yAxis: g.bottom,
          itemStyle: { color, opacity: 0.1 },
          label: {
            formatter: `${g.direction === 'up' ? 'Gap up' : 'Gap down'} ${g.pct.toFixed(1)}%`,
            position: 'insideTopLeft' as const,
            fontSize: 10,
            color: tokens.screener.muted,
          },
        },
        { xAxis: lastLabel, yAxis: g.top },
      ]
    })

    const series: Record<string, unknown>[] = [
      {
        name: 'Price',
        type: 'candlestick',
        data: candles,
        itemStyle: {
          color: tokens.screener.pos,
          color0: tokens.screener.neg,
          borderColor: tokens.screener.pos,
          borderColor0: tokens.screener.neg,
        },
        z: 3,
        markLine: fibLines.length
          ? {
              silent: true,
              symbol: 'none',
              lineStyle: { color: tokens.screener.accent, type: 'dotted', width: 1, opacity: 0.8 },
              data: fibLines,
            }
          : undefined,
        markArea: gapAreas.length ? { silent: true, data: gapAreas } : undefined,
      },
      {
        name: 'SMA 150',
        type: 'line',
        data: sma150,
        symbol: 'none',
        connectNulls: false,
        lineStyle: { width: 1.5, color: tokens.screener.primary },
        itemStyle: { color: tokens.screener.primary },
        z: 2,
      },
    ]

    if (channel) {
      // The shaded tunnel is a stacked pair: an invisible baseline at `lower`
      // plus a band of `upper - lower` on top of it. Stacking is the only way
      // ECharts fills between two arbitrary lines — which is why the tooltip
      // below reads the raw arrays instead of the series values, and why the
      // legend is non-interactive (toggling one half would leave the other
      // rendering a delta).
      const bandHeights = channel.upper.map((u, i) => u - channel.lower[i])
      series.push(
        {
          name: 'Channel lower',
          type: 'line',
          stack: 'channel',
          // ECharts' default 'samesign' strategy refuses to stack a positive
          // band height onto a negative baseline and silently restarts the
          // stack at 0 — which would draw the tunnel at 0..(upper-lower)
          // instead of lower..upper. `lower = mid - 2σ` can go negative on a
          // low-priced, high-residual name, and the result looks plausible
          // while being in entirely the wrong place. 'all' stacks regardless
          // of sign.
          stackStrategy: 'all',
          data: channel.lower,
          symbol: 'none',
          lineStyle: { width: 1, type: 'dashed', color: tokens.screener.muted },
          areaStyle: { opacity: 0 },
          z: 1,
        },
        {
          name: 'Regression channel (±2σ)',
          type: 'line',
          stack: 'channel',
          stackStrategy: 'all',
          data: bandHeights,
          symbol: 'none',
          lineStyle: { width: 1, type: 'dashed', color: tokens.screener.muted },
          areaStyle: { color: tokens.screener.primary, opacity: 0.07 },
          z: 1,
        },
      )
    }

    return {
      animation: false,
      grid: { top: 34, right: 68, bottom: 28, left: 52, containLabel: false },
      legend: {
        top: 0,
        right: 0,
        // A key, not a control: see the stacking note above.
        selectedMode: false,
        itemWidth: 18,
        textStyle: { fontSize: 11, color: tokens.screener.muted },
        data: ['Price', 'SMA 150', ...(channel ? ['Regression channel (±2σ)'] : [])],
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params: { dataIndex: number }[]) => {
          const i = params[0]?.dataIndex
          if (i == null) return ''
          const b = visible[i]
          if (!b) return ''
          const rows = [
            `O ${usd(b.o)}  H ${usd(b.h)}`,
            `L ${usd(b.l)}  C ${usd(b.c)}`,
            `SMA 150: ${sma150[i] != null ? usd(sma150[i] as number) : '—'}`,
          ]
          if (channel) {
            rows.push(
              `Channel: ${usd(channel.lower[i])} – ${usd(channel.upper[i])}`,
            )
          }
          return `${labels[i]}<br/>${rows.join('<br/>')}`
        },
      },
      xAxis: {
        type: 'category',
        data: labels,
        boundaryGap: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 11, color: tokens.screener.muted },
      },
      yAxis: {
        type: 'value',
        scale: true,
        splitLine: { lineStyle: { color: tokens.screener.border } },
        axisLabel: { fontSize: 11, color: tokens.screener.muted },
      },
      series,
    }
  }, [visible, sma150, channel, fib, gaps])

  // ─── Context, never scored ───────────────────────────────────────
  const lastBar = visible.length ? visible[visible.length - 1] : null
  const lastSma = sma150.length ? sma150[sma150.length - 1] : null
  const vsSma =
    lastBar && lastSma != null && lastSma !== 0 ? ((lastBar.c - lastSma) / lastSma) * 100 : null

  const gapsAbove = gaps.filter((g) => g.side === 'above').length
  const gapsBelow = gaps.length - gapsAbove

  const nearestFib =
    fib && lastBar
      ? fib.levels.reduce((best, l) =>
          Math.abs(l.price - lastBar.c) < Math.abs(best.price - lastBar.c) ? l : best,
        )
      : null

  const meterPct = positionPct != null ? Math.min(100, Math.max(0, positionPct)) : null
  const showPct = verdict !== 'insufficient-history' && positionPct != null
  // A channel built on fewer than VISIBLE_BARS bars renders identically to a
  // full 126-bar one otherwise — surface the true window size so a short
  // history reads as short, not as full confidence.
  const isShortWindow = windowBars < VISIBLE_BARS

  return (
    <div className="space-y-3">
      <div className={`rounded-xl border px-4 py-3 ${VERDICT_BANNER[verdict]}`}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span className="text-lg font-bold tracking-wide">{VERDICT_COPY[verdict]}</span>
          {showPct ? (
            <span className="text-sm font-semibold tabular-nums">
              {Math.round(positionPct)}% of tunnel height
              {isShortWindow ? ` · ${windowBars} bars of history` : null}
            </span>
          ) : null}
        </div>
        {showPct && meterPct != null ? (
          // The raw reading can sit outside 0..100 (price broke out of the
          // tunnel); the number above stays raw, the bar is clamped so it
          // cannot overflow its track.
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
            <div
              className={`h-full rounded-full ${VERDICT_METER[verdict]}`}
              style={{ width: `${meterPct}%` }}
            />
          </div>
        ) : null}
      </div>

      <p className="text-xs leading-relaxed text-muted">
        <span className="font-medium uppercase tracking-wide">Context (not scored)</span>
        {' · '}
        {vsSma != null ? `${signedPct(vsSma)} vs SMA 150` : 'SMA 150 unavailable'}
        {' · '}
        {gaps.length === 0
          ? 'no open gaps'
          : `${gaps.length} open gap${gaps.length === 1 ? '' : 's'} (${gapsAbove} above, ${gapsBelow} below)`}
        {' · '}
        {nearestFib && fib
          ? `nearest fib ${ratioLabel(nearestFib.ratio)} · ${usd(nearestFib.price)} — ${
              fib.anchor === 'window' ? 'window extremes (no major swing)' : 'from the detected swing'
            }`
          : 'no fib retracement'}
      </p>

      {/* ReactECharts renders a bare div and drops unknown props, so the label
          for the canvas has to live on a wrapper. */}
      <div role="img" aria-label={`Daily candlestick chart for ${symbol}`}>
        <ReactECharts option={option} style={{ height: 400 }} notMerge lazyUpdate />
      </div>
    </div>
  )
}
