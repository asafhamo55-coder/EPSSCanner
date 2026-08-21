'use client'

import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { EmptyState, Skeleton } from '@/ui'
import { getTechnicals } from '@/app/actions'
import type { Technicals } from '@/lib/technicals'
import { TechnicalChart } from './charts/LazyCharts'

// The technical chart is expensive on both ends — a live provider fetch plus a
// ~1.1MB echarts chunk — so nothing loads until the dialog is actually opened,
// and the fetch runs once per open rather than on every render.

type State =
  | { status: 'loading' }
  | { status: 'ready'; data: Technicals }
  | { status: 'error' }

export function TechnicalChartModal({
  symbol,
  open,
  onOpenChange,
}: {
  symbol: string
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setState({ status: 'loading' })
    // The action's own body can't throw — it resolves null on any failure. But
    // this is a server action called over the wire, so the RPC itself still
    // rejects on network loss, a 500, or deployment skew; without the catch the
    // modal would sit on the skeleton forever and React would log an unhandled
    // rejection.
    getTechnicals(symbol)
      .then((data) => {
        if (cancelled) return
        setState(data ? { status: 'ready', data } : { status: 'error' })
      })
      .catch(() => {
        if (cancelled) return
        setState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [open, symbol])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          // No description element — silences Radix's a11y warning rather than
          // pointing aria-describedby at nothing.
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-surface p-4 text-foreground shadow-xl sm:p-6"
        >
          <div className="mb-4 flex items-center justify-between gap-4">
            <Dialog.Title className="text-base font-semibold">
              {symbol} · technical chart
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close technical chart"
              className="rounded-lg p-1 text-muted transition-colors hover:bg-background hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {state.status === 'loading' ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-[400px] w-full" />
            </div>
          ) : state.status === 'error' ? (
            <EmptyState
              title="No chart data"
              description={`We couldn't load daily price history for ${symbol}. Try again in a moment.`}
            />
          ) : (
            <TechnicalChart data={state.data} symbol={symbol} />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
