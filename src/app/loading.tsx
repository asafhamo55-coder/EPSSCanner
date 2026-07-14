import { Skeleton } from '@/ui'
import { IndicesPanelSkeleton, WatchlistSkeleton } from '@/components/DashboardSkeletons'

// Shown during client-side navigation back to the dashboard. Mirrors the real
// page structure (indices strip → header → watchlist) rather than generic
// blocks, so there's no layout jump when the content arrives.
export default function Loading() {
  return (
    <div className="space-y-6">
      <IndicesPanelSkeleton />
      <div className="flex flex-wrap items-center gap-3">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
      <WatchlistSkeleton />
    </div>
  )
}
