'use client'

import { useTransition } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button, useToast } from '@/ui'
import { refreshAllAction, refreshTickerAction } from '@/app/actions'

// "Refresh now" — re-ingests either one ticker (when `symbol` is set) or the
// whole active watchlist. Same idempotent path as the weekly cron.
export function RefreshButton({
  symbol,
  label,
  variant = 'outline',
}: {
  symbol?: string
  label?: string
  variant?: 'outline' | 'default' | 'ghost'
}) {
  const [pending, startTransition] = useTransition()
  const toast = useToast()

  function run() {
    startTransition(async () => {
      const res = symbol ? await refreshTickerAction(symbol) : await refreshAllAction()
      toast({
        message: res.ok ? res.message ?? 'Refreshed.' : res.error ?? 'Refresh failed.',
        tone: res.ok ? 'success' : 'error',
      })
    })
  }

  return (
    <Button variant={variant} onClick={run} loading={pending}>
      <RefreshCw className="h-4 w-4" />
      {label ?? 'Refresh now'}
    </Button>
  )
}
