'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { Button, useConfirm, useToast } from '@/ui'
import { removeTickerAction } from '@/app/actions'

// Soft-removes a ticker from the watchlist behind a modal confirm (replaces
// window.confirm, matching the HOA TwoClickDelete intent).
export function RemoveTickerButton({
  symbol,
  redirectHome = false,
}: {
  symbol: string
  redirectHome?: boolean
}) {
  const [pending, startTransition] = useTransition()
  const confirm = useConfirm()
  const toast = useToast()
  const router = useRouter()

  async function onClick() {
    const ok = await confirm({
      title: `Remove ${symbol}?`,
      description: `${symbol} will be removed from your watchlist. You can add it back any time.`,
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!ok) return
    startTransition(async () => {
      const res = await removeTickerAction(symbol)
      toast({
        message: res.ok ? res.message ?? `Removed ${symbol}.` : res.error ?? 'Could not remove.',
        tone: res.ok ? 'success' : 'error',
      })
      if (res.ok && redirectHome) router.push('/')
    })
  }

  return (
    <Button variant="ghost" size="sm" onClick={onClick} loading={pending} aria-label={`Remove ${symbol}`}>
      <Trash2 className="h-4 w-4" />
    </Button>
  )
}
