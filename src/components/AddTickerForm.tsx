'use client'

import { useState, useTransition } from 'react'
import { Plus } from 'lucide-react'
import { Button, Input, useToast } from '@/ui'
import { addTickerAction } from '@/app/actions'

// Add any ticker to the shared watchlist. NVDA is just an example — type a
// symbol, hit add, and ingest pulls its fundamentals from the active provider.
export function AddTickerForm() {
  const [symbol, setSymbol] = useState('')
  const [pending, startTransition] = useTransition()
  const toast = useToast()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const sym = symbol.trim().toUpperCase()
    if (!sym) return
    startTransition(async () => {
      const res = await addTickerAction(sym)
      if (res.ok) {
        toast({ message: res.message ?? `Added ${sym}.`, tone: 'success' })
        setSymbol('')
      } else {
        toast({ message: res.error ?? 'Could not add ticker.', tone: 'error' })
      }
    })
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <Input
        value={symbol}
        onChange={(e) => setSymbol(e.target.value.toUpperCase())}
        placeholder="Add ticker (e.g. AAPL)"
        aria-label="Ticker symbol"
        className="w-44"
        maxLength={10}
        disabled={pending}
      />
      <Button type="submit" loading={pending} aria-label="Add ticker">
        <Plus className="h-4 w-4" />
        Add
      </Button>
    </form>
  )
}
