'use client'

import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { tokens } from '@/ui'

// Quarterly EPS trend: solid line for reported actuals, dashed continuation for
// the next-4-quarters forecast. Forecast points are filled when they come from
// analyst consensus and hollow when they're the seasonal growth model.
export interface EpsTrendActual {
  fiscalPeriod: string
  epsActual: number | null
}

export interface EpsTrendForecast {
  fiscalPeriod: string
  eps: number
  source: 'consensus' | 'model'
}

/** 'YYYYQn' → the same quarter one year earlier ('2026Q2' → '2025Q2'). */
function priorYearLabel(label: string): string | null {
  const m = /^(\d{4})Q([1-4])$/.exec(label)
  if (!m) return null
  return `${Number(m[1]) - 1}Q${m[2]}`
}

export function EpsTrendChart({
  actuals,
  prediction,
}: {
  actuals: EpsTrendActual[]
  prediction: EpsTrendForecast[]
}) {
  const option = useMemo(() => {
    const labels = [...actuals.map((a) => a.fiscalPeriod), ...prediction.map((p) => p.fiscalPeriod)]
    const lastActualIdx = actuals.length - 1
    const lastActual = lastActualIdx >= 0 ? actuals[lastActualIdx].epsActual : null

    const actualData: (number | null)[] = [
      ...actuals.map((a) => a.epsActual),
      ...prediction.map(() => null),
    ]

    // Forecast series: null over history, anchored to the last actual so the
    // dashed line continues seamlessly, then the predicted points.
    const forecastData = labels.map((_, i) => {
      if (i === lastActualIdx) return lastActual
      const pi = i - actuals.length
      if (pi < 0) return null
      const p = prediction[pi]
      const filled = p.source === 'consensus'
      return {
        value: p.eps,
        symbol: 'circle',
        symbolSize: 7,
        itemStyle: filled
          ? { color: tokens.screener.accent }
          : { color: tokens.screener.surface, borderColor: tokens.screener.accent, borderWidth: 2 },
      }
    })

    // QoQ EPS growth (the dashboard's step-3 metric): each quarter ÷ the SAME
    // fiscal quarter one year earlier, matched by label (2026Q2 ÷ 2025Q2), in
    // percent, across both actuals and the forecast. Matching by label — rather
    // than by position — stays correct even when the stored quarters have gaps
    // or extra rolled-off history.
    const combined: { label: string; eps: number | null }[] = [
      ...actuals.map((a) => ({ label: a.fiscalPeriod, eps: a.epsActual })),
      ...prediction.map((p) => ({ label: p.fiscalPeriod, eps: p.eps })),
    ]
    const epsByLabel = new Map<string, number>()
    for (const c of combined) if (c.eps != null) epsByLabel.set(c.label, c.eps)
    const growth = combined.map((c) => {
      if (c.eps == null) return null
      const yearAgo = priorYearLabel(c.label)
      const prev = yearAgo != null ? epsByLabel.get(yearAgo) : undefined
      if (prev == null || prev <= 0) return null
      return Math.round((c.eps / prev - 1) * 1000) / 10
    })

    return {
      grid: { top: 30, right: 48, bottom: 28, left: 40, containLabel: false },
      legend: {
        top: 0,
        right: 0,
        itemWidth: 18,
        textStyle: { fontSize: 11, color: tokens.screener.muted },
        data: ['EPS (actual)', 'Forecast (next 4Q)', 'QoQ EPS growth (%)'],
      },
      tooltip: {
        trigger: 'axis',
        formatter: (params: { axisValue: string; marker: string; seriesName: string; value: number | null }[]) => {
          const head = params[0]?.axisValue ?? ''
          const lines = params
            .filter((p) => p.value != null)
            .map((p) => {
              const isPct = p.seriesName === 'QoQ EPS growth (%)'
              const v = p.value as number
              return `${p.marker} ${p.seriesName}: ${isPct ? `${v.toFixed(1)}%` : v.toFixed(2)}`
            })
          return `${head}<br/>${lines.join('<br/>')}`
        },
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 11, color: tokens.screener.muted },
      },
      yAxis: [
        {
          type: 'value',
          scale: true,
          splitLine: { lineStyle: { color: tokens.screener.border } },
          axisLabel: { fontSize: 11, color: tokens.screener.muted },
        },
        {
          type: 'value',
          position: 'right',
          scale: true,
          splitLine: { show: false },
          axisLabel: { fontSize: 11, color: tokens.screener.muted, formatter: '{value}%' },
        },
      ],
      series: [
        {
          name: 'EPS (actual)',
          type: 'line',
          data: actualData,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2.5, color: tokens.screener.primary },
          itemStyle: { color: tokens.screener.primary },
          connectNulls: false,
        },
        {
          name: 'Forecast (next 4Q)',
          type: 'line',
          data: forecastData,
          smooth: true,
          lineStyle: { width: 2, type: 'dashed', color: tokens.screener.accent },
          itemStyle: { color: tokens.screener.accent },
          connectNulls: true,
        },
        {
          name: 'QoQ EPS growth (%)',
          type: 'line',
          yAxisIndex: 1,
          data: growth,
          smooth: false,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { width: 1.5, type: 'dotted', color: tokens.screener.pos },
          itemStyle: { color: tokens.screener.pos },
          // Break the line at quarters with no same-quarter-last-year data
          // instead of drawing a misleading straight segment across the gap.
          connectNulls: false,
        },
      ],
    }
  }, [actuals, prediction])

  return <ReactECharts option={option} style={{ height: 280 }} notMerge lazyUpdate />
}
