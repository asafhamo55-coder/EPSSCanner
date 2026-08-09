import { Card, Skeleton } from '@/ui'

/** Placeholder for the key-indices panel — mirrors both IndicesPanel layouts
 *  (desktop's four divided columns, phone's 2×2 grid of stacked stat rows) so
 *  the swap to real data doesn't shift layout at either breakpoint. */
export function IndicesPanelSkeleton() {
  return (
    <Card className="overflow-hidden p-0">
      <div className="grid grid-cols-2 md:flex md:min-w-max md:divide-x md:divide-border">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className={`px-3.5 py-3.5 md:flex-1 md:whitespace-nowrap md:px-5 ${
              i % 2 === 0 ? 'border-r border-border md:border-r-0' : ''
            } ${i < 2 ? 'border-b border-border md:border-b-0' : ''}`}
          >
            <div className="flex items-center gap-2">
              <Skeleton className="h-2.5 w-2.5 rounded-full" />
              <Skeleton className="h-5 w-28" />
            </div>
            <Skeleton className="mt-1 h-3 w-20 md:hidden" />
            <Skeleton className="mt-1.5 h-7 w-24" />
            <Skeleton className="mt-2 hidden h-4 w-40 md:block" />
            <div className="mt-2.5 space-y-1.5 border-t border-border pt-2.5 md:hidden">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="flex items-baseline justify-between gap-2">
                  <Skeleton className="h-3 w-10" />
                  <Skeleton className="h-4 w-12" />
                </div>
              ))}
            </div>
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
