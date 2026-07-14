'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/ui'

// echarts is ~1.1MB of client JS and renders to a canvas, so server-rendering it
// produces nothing useful — yet a static import (or a next/dynamic call inside a
// Server Component, which still ships the chunk for hydration) put it in the
// ticker route's initial payload for EVERY tab. The charts only appear on the
// "EPS Trend" tab, so the default Overview tab was paying ~380kB for a chart it
// never draws.
//
// Marking the boundary here — a Client Component with ssr:false — is what
// actually defers the chunk: it's requested at mount, i.e. only once the trend
// subtree renders.

export const EpsTrendChart = dynamic(
  () => import('./EpsTrendChart').then((m) => m.EpsTrendChart),
  { ssr: false, loading: () => <Skeleton className="h-72 w-full" /> },
)

export const QoqDeltaChart = dynamic(
  () => import('./QoqDeltaChart').then((m) => m.QoqDeltaChart),
  { ssr: false, loading: () => <Skeleton className="h-64 w-full" /> },
)
