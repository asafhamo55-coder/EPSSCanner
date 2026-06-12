'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { ingestAllActive, ingestTicker } from '@/lib/ingest'

export interface ActionResult {
  ok: boolean
  message?: string
  error?: string
}

export async function addTickerAction(symbol: string): Promise<ActionResult> {
  const sym = symbol.trim().toUpperCase()
  if (!sym) return { ok: false, error: 'Enter a ticker symbol.' }
  try {
    const res = await ingestTicker(sym)
    revalidatePath('/')
    revalidatePath(`/ticker/${res.symbol}`)
    return { ok: true, message: `Added ${res.symbol}.` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function refreshTickerAction(symbol: string): Promise<ActionResult> {
  try {
    const res = await ingestTicker(symbol)
    revalidatePath('/')
    revalidatePath(`/ticker/${res.symbol}`)
    return { ok: true, message: `Refreshed ${res.symbol}.` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function refreshAllAction(): Promise<ActionResult> {
  try {
    const res = await ingestAllActive()
    revalidatePath('/')
    return { ok: true, message: `Refreshed ${res.length} ticker${res.length === 1 ? '' : 's'}.` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function removeTickerAction(symbol: string): Promise<ActionResult> {
  const sym = symbol.trim().toUpperCase()
  try {
    const supabase = db()
    const { error } = await supabase
      .from('screener_tickers')
      .update({ active: false, deleted_at: new Date().toISOString() })
      .eq('symbol', sym)
    if (error) throw new Error(error.message)
    revalidatePath('/')
    return { ok: true, message: `Removed ${sym}.` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
