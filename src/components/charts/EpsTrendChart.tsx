'use client'

import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { tokens } from '@/ui'

// Quarterly EPS trend: solid line for reported actuals, dashed continuation
// for forecast quarters. The two series share an x-axis; the forecast series
// is null for historical points so the dash picks up exactly where actuals end.
export interface EpsTrendPoint {
  fiscalPeriod: string
  epsActual: number | null
  epsEstimate: number | null
  isForecast: boolean
}

export function EpsTrendChart({ points }: { points: EpsTrendPoint[] }) {
  const option = useMemo(() => {
    const labels = points.map((p) => p.fiscalPeriod)
    const actual = points.map((p) => (p.isForecast ? null : p.epsActual))

    // Forecast line: connect from the last actual through the estimate points.
    const lastActualIdx = points.reduce((acc, p, i) => (p.isForecast ? acc : i), -1)
    const forecast = points.map((p, i) => {
      if (i === lastActualIdx) return p.epsActual
      return p.isForecast ? p.epsEstimate : null
    })

    return {
      grid: { top: 16, right: 16, bottom: 28, left: 40, containLabel: false },
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
      yAxis: {
        type: 'value',
        scale: true,
        splitLine: { lineStyle: { color: tokens.screener.border } },
        axisLabel: { fontSize: 11, color: tokens.screener.muted },
      },
      series: [
        {
          name: 'EPS (actual)',
          type: 'line',
          data: actual,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2.5, color: tokens.screener.primary },
          itemStyle: { color: tokens.screener.primary },
          connectNulls: false,
        },
        {
          name: 'EPS (estimate)',
          type: 'line',
          data: forecast,
          smooth: true,
          symbol: 'emptyCircle',
          symbolSize: 6,
          lineStyle: { width: 2, type: 'dashed', color: tokens.screener.accent },
          itemStyle: { color: tokens.screener.accent },
          connectNulls: true,
        },
      ],
    }
  }, [points])

  return <ReactECharts option={option} style={{ height: 280 }} notMerge lazyUpdate />
}
