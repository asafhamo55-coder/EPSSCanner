import { revalidatePath, revalidateTag } from 'next/cache'

/** Drop every cache holding stale screener numbers.
 *
 *  The dashboard is served from the CDN (ISR) and the live Yahoo fields sit in
 *  the Data Cache for 6–24h, so a fresh ingest is invisible until both are
 *  invalidated. Called by the ingest route and by the digest route's
 *  fallback ingest — shared so the two cannot invalidate different things. */
export function publish(symbol?: string): void {
  revalidateTag('yahoo-live')
  revalidatePath('/')
  if (symbol) revalidatePath(`/ticker/${symbol}`)
}
