import { Card, Skeleton } from '@/ui'

/** Placeholder for the key-indices strip — mirrors the four divided columns of
 *  IndicesPanel (name row, YTD figure, PE/EPS footnote) so the swap to real
 *  data doesn't shift layout. */
export function IndicesPanelSkeleton() {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex min-w-max divide-x divide-border">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex-1 whitespace-nowrap px-5 py-3.5">
            <div className="flex items-center gap-2">
              <Skeleton className="h-2.5 w-2.5 rounded-full" />
              <Skeleton className="h-5 w-28" />
            </div>
            <Skeleton className="mt-1.5 h-7 w-24" />
            <Skeleton className="mt-2 h-3 w-40" />
          </div>
        ))}
      </div>
    </Card>
  )
}

/** Placeholder for the watchlist. Desktop mirrors the table (header + rows);
 *  mobile mirrors the stacked cards, matching WatchlistTable's breakpoint. */
export function WatchlistSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <Card className="overflow-hidden p-0">
      {/* toolbar / filter row */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="ml-auto h-8 w-24" />
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <div className="flex items-center gap-4 border-b border-border px-4 py-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className={i === 0 ? 'h-4 w-32' : 'h-4 flex-1'} />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0">
            <div className="flex w-32 items-center gap-3">
              <Skeleton className="h-7 w-7 rounded-md" />
              <Skeleton className="h-4 w-16" />
            </div>
            {Array.from({ length: 7 }).map((_, j) => (
              <Skeleton key={j} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>

      {/* mobile cards */}
      <div className="md:hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="border-b border-border px-4 py-3 last:border-0">
            <div className="flex items-center gap-3">
              <Skeleton className="h-7 w-7 rounded-md" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="ml-auto h-4 w-16" />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {Array.from({ length: 6 }).map((_, j) => (
                <Skeleton key={j} className="h-8 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
