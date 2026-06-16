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

    // QoQ EPS growth (the dashboard's step-3 metric): each quarter vs the same
    // quarter a year earlier, in percent, across actuals and the forecast. Drawn
    // on a secondary right axis so it overlays the EPS lines.
    const combined: (number | null)[] = [
      ...actuals.map((a) => a.epsActual),
      ...prediction.map((p) => p.eps),
    ]
    const growth = combined.map((v, i) => {
      const yearAgo = i >= 4 ? combined[i - 4] : null
      if (v == null || yearAgo == null || yearAgo <= 0) return null
      return Math.round((v / yearAgo - 1) * 1000) / 10
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
        valueFormatter: (v: number | null) => (v == null ? '—' : v.toFixed(2)),
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
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 1.5, type: 'dotted', color: tokens.screener.pos },
          itemStyle: { color: tokens.screener.pos },
          connectNulls: true,
        },
      ],
    }
  }, [actuals, prediction])

  return <ReactECharts option={option} style={{ height: 280 }} notMerge lazyUpdate />
}
