'use client'

import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { tokens } from '@/ui'

// QoQ EPS deltas as a bar chart. Bars are tinted with the directional data
// tokens — emerald for a positive delta, rose for a negative one (NOT the
// brand color, which stays neutral so chrome never reads as a buy signal).
export interface QoqBar {
  label: string
  delta: number
}

export function QoqDeltaChart({ bars }: { bars: QoqBar[] }) {
  const option = useMemo(
    () => ({
      grid: { top: 16, right: 16, bottom: 28, left: 40, containLabel: false },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: number | null) =>
          v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`,
      },
      xAxis: {
        type: 'category',
        data: bars.map((b) => b.label),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 11, color: tokens.screener.muted },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: tokens.screener.border } },
        axisLabel: { fontSize: 11, color: tokens.screener.muted },
      },
      series: [
        {
          type: 'bar',
          data: bars.map((b) => ({
            value: b.delta,
            itemStyle: { color: b.delta >= 0 ? tokens.screener.pos : tokens.screener.neg },
          })),
          barMaxWidth: 28,
        },
      ],
    }),
    [bars],
  )

  return <ReactECharts option={option} style={{ height: 240 }} notMerge lazyUpdate />
}
