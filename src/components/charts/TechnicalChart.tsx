'use client'

import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { Check, CircleHelp, Minus, TrendingUp, X } from 'lucide-react'
import { tokens } from '@/ui'
import { usd } from '@/lib/format'
import {
  DONT_BUY_PCT,
  GOLDEN_ZONE_HIGH,
  GOLDEN_ZONE_LOW,
  OPPORTUNITY_PCT,
  VISIBLE_BARS,
  type SignalScore,
  type Technicals,
  type Verdict,
} from '@/lib/technicals'

// Daily candlestick with the regression tunnel, the 150-day SMA, Fibonacci
// retracement levels and any still-open gaps, under a verdict banner.
//
// The verdict is scored from THREE factors — tunnel position, the golden-zone
// retracement and price vs the 150-day SMA — with one override: price at or
// above DONT_BUY_PCT of tunnel height stays 'dont-buy' whatever else fires.
// Open gaps are deliberately NOT scored and stay in the plain context line.
//
// Every grade ships as colour + icon + word + score. The two best grades are
// only ~9 ΔE apart as hues (a validated fail), so STRONG BUY and OPPORTUNITY
// are separated by FILL WEIGHT — solid vs tint — never by shade alone.

const VERDICT_COPY: Record<Verdict, string> = {
  'strong-buy': 'STRONG BUY',
  opportunity: 'OPPORTUNITY',
  fair: 'FAIR',
  'dont-buy': "DON'T BUY",
  'insufficient-history': 'NOT ENOUGH HISTORY',
}

const VERDICT_ICON: Record<Verdict, typeof Check> = {
  'strong-buy': TrendingUp,
  opportunity: Check,
  fair: Minus,
  'dont-buy': X,
  'insufficient-history': CircleHelp,
}

// Banner chrome mirrors the Alert palette so these tones read the same as every
// other status surface in the app. 'strong-buy' is the one solid fill — that
// weight, not a darker green, is what distinguishes it from 'opportunity'.
const VERDICT_BANNER: Record<Verdict, string> = {
  'strong-buy': 'border-emerald-600 bg-emerald-600 text-white',
  opportunity: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  fair: 'border-amber-200 bg-amber-50 text-amber-900',
  'dont-buy': 'border-red-200 bg-red-50 text-red-900',
  'insufficient-history': 'border-border bg-background text-foreground',
}

/** Meter tone follows the TUNNEL POSITION, not the grade — the bar measures
 *  position, so painting it by a 3-factor grade would show a green bar for a
 *  stretched price whenever the other two factors carried the score. */
function meterTone(positionPct: number): { fill: string; track: string } {
  if (positionPct >= DONT_BUY_PCT) return { fill: 'bg-red-600', track: 'bg-red-100' }
  if (positionPct <= OPPORTUNITY_PCT) return { fill: 'bg-emerald-600', track: 'bg-emerald-100' }
  return { fill: 'bg-amber-500', track: 'bg-amber-100' }
}

/** One scored factor: pass/fail glyph, what it tests, and the reading that
 *  decided it. The glyph carries the state so colour never has to. */
function FactorRow({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <li className="flex items-center gap-2">
      {ok ? (
        <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : (
        <X className="h-3.5 w-3.5 shrink-0 opacity-45" aria-hidden />
      )}
      <span className={ok ? 'font-medium' : 'opacity-60'}>{label}</span>
      <span className="ml-auto tabular-nums opacity-75">{value}</span>
      <span className="sr-only">{ok ? ' — met' : ' — not met'}</span>
    </li>
  )
}

/** Unix SECONDS → the short axis label ('Mar 14'). */
function dayLabel(t: number): string {
  return new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function ratioLabel(ratio: number): string {
  // 0.5 → '50%', 0.618 → '61.8%'. A trailing '.0' reads as false precision on
  // the round levels, which now sit in the scored golden-zone label.
  const pct = ratio * 100
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`
}

function signedPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

export function TechnicalChart({ data, symbol }: { data: Technicals; symbol: string }) {
  const { visible, sma150, channel, fib, gaps, verdict, positionPct, signals, windowBars } =
    data

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

  const Icon = VERDICT_ICON[verdict]
  const solid = verdict === 'strong-buy'
  const tone = positionPct != null ? meterTone(positionPct) : null

  return (
    <div className="space-y-3">
      <div className={`rounded-xl border px-4 py-3 ${VERDICT_BANNER[verdict]}`}>
        {/* Grade line: icon + word + score. Colour is never the only channel —
            a reader who cannot separate the two greens still has the glyph,
            the word and the N/3 count. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="flex items-center gap-2">
            <Icon className="h-5 w-5 shrink-0" aria-hidden />
            <span className="text-xl font-bold tracking-wide">{VERDICT_COPY[verdict]}</span>
          </span>
          {signals ? (
            <span className="flex items-center gap-2">
              {/* Score pips: one segment per factor, 2px surface gaps. */}
              <span className="flex gap-[2px]" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className={`h-1.5 w-5 rounded-full ${
                      i < signals.score
                        ? solid
                          ? 'bg-white'
                          : 'bg-current opacity-80'
                        : solid
                          ? 'bg-white/30'
                          : 'bg-current opacity-20'
                    }`}
                  />
                ))}
              </span>
              <span className="text-sm font-semibold">{signals.score}/3 signals</span>
            </span>
          ) : null}
        </div>

        {showPct && meterPct != null && tone ? (
          <div className="mt-3">
            <div className="flex items-baseline justify-between text-xs font-medium">
              {/* Proportional figures: this is a standalone value, not a column. */}
              <span>
                <span className="text-base font-semibold">{Math.round(positionPct)}%</span> of
                tunnel height
              </span>
              {isShortWindow ? <span>{windowBars} bars of history</span> : null}
            </div>
            {/* The raw reading can sit outside 0..100 (price broke out of the
                tunnel); the number above stays raw, the bar is clamped so it
                cannot overflow its track. The unfilled track is a lighter step
                of the fill's own ramp, so state reads across the whole bar. */}
            <div className={`relative mt-1.5 h-2 w-full rounded-full ${tone.track}`}>
              <div
                className={`h-full rounded-full ${tone.fill}`}
                style={{ width: `${meterPct}%` }}
              />
              {/* Threshold ticks: the two cut points the grade turns on. */}
              {[OPPORTUNITY_PCT, DONT_BUY_PCT].map((t) => (
                <span
                  key={t}
                  className="absolute top-0 h-full w-px bg-current opacity-40"
                  style={{ left: `${t}%` }}
                  aria-hidden
                />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] opacity-70">
              <span>cheap</span>
              <span>{OPPORTUNITY_PCT}</span>
              <span>{DONT_BUY_PCT}</span>
              <span>stretched</span>
            </div>
          </div>
        ) : null}

        {/* Factor rows: what actually produced the score, each with the reading
            that decided it, so the grade is never an unexplained assertion. */}
        {signals ? (
          <ul className="mt-3 space-y-1 border-t border-current/15 pt-2 text-xs">
            <FactorRow
              ok={signals.tunnelOk}
              label={`Tunnel position ≤ ${OPPORTUNITY_PCT}%`}
              value={positionPct != null ? `${Math.round(positionPct)}%` : '—'}
            />
            <FactorRow
              ok={signals.goldenOk}
              label={`Golden zone (${ratioLabel(GOLDEN_ZONE_LOW)}–${ratioLabel(GOLDEN_ZONE_HIGH)})`}
              value={
                fib
                  ? fib.anchor === 'window'
                    ? 'window extremes'
                    : 'from detected swing'
                  : 'no anchor'
              }
            />
            <FactorRow
              ok={signals.smaOk}
              label="Above SMA 150"
              value={vsSma != null ? signedPct(vsSma) : 'unavailable'}
            />
          </ul>
        ) : null}
      </div>

      <p className="text-xs leading-relaxed text-muted">
        <span className="font-medium uppercase tracking-wide">Context (not scored)</span>
        {' · '}
        {gaps.length === 0
          ? 'no open gaps'
          : `${gaps.length} open gap${gaps.length === 1 ? '' : 's'} (${gapsAbove} above, ${gapsBelow} below)`}
        {' · '}
        {nearestFib && fib
          ? `nearest fib ${ratioLabel(nearestFib.ratio)} · ${usd(nearestFib.price)}`
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
