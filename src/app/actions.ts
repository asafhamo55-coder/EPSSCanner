'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { ingestAllActive, ingestTicker } from '@/lib/ingest'
import { getProvider } from '@/market-data'

export interface ActionResult {
  ok: boolean
  message?: string
  error?: string
}

export interface EvalPrefill {
  symbol: string
  name: string | null
  baseYear: number
  baseRevenue: number // $bn
  revenueGrowth: number // fraction
  profitMargin: number // fraction
  currentMarketCap: number // $bn
  currentPrice: number // $
}

function round(n: number, dp: number): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/** Pull real FMP data for any ticker (need not be on the watchlist) and turn it
 *  into sensible starting assumptions for the evaluation model. Every field is
 *  user-editable afterwards — this is just a starting point from real data. */
export async function prefillEvaluation(
  symbol: string,
): Promise<{ ok: boolean; data?: EvalPrefill; error?: string }> {
  const sym = symbol.trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) return { ok: false, error: 'Invalid ticker symbol.' }
  try {
    const provider = getProvider()
    const [profile, val, annual] = await Promise.all([
      provider.getProfile(sym),
      provider.getValuation(sym),
      provider.getAnnualFinancials(sym, 5),
    ])

    const withRev = annual.filter((a) => a.revenue != null && a.revenue > 0)
    const latest = withRev.length ? withRev[withRev.length - 1] : null
    const baseRevenue = latest ? (latest.revenue as number) / 1e9 : 0

    // Default revenue growth = historical revenue CAGR over the years on file.
    let growth = 0.1
    if (withRev.length >= 2) {
      const first = withRev[0]
      const last = withRev[withRev.length - 1]
      const span = last.fiscalYear - first.fiscalYear
      if (span > 0 && (first.revenue as number) > 0) {
        growth = Math.pow((last.revenue as number) / (first.revenue as number), 1 / span) - 1
      }
    }

    return {
      ok: true,
      data: {
        symbol: sym,
        name: profile.name,
        baseYear: latest ? latest.fiscalYear : new Date().getFullYear(),
        baseRevenue: round(baseRevenue, 2),
        revenueGrowth: round(growth, 4),
        profitMargin: round(val.netMarginTtm ?? 0.2, 4),
        currentMarketCap: val.marketCap != null ? round(val.marketCap / 1e9, 2) : 0,
        currentPrice: val.price != null ? round(val.price, 2) : 0,
      },
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
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
    // The live Yahoo fields (SMA / ATH / PEG) are held in the Data Cache for
    // 6-24h. An explicit "Refresh now" must mean it, so drop them too — not
    // just the re-ingested DB rows.
    revalidateTag('yahoo-live')
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
    revalidateTag('yahoo-live')
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
