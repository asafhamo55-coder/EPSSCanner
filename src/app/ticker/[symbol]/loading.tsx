import { Card, Skeleton } from '@/ui'

// Clicking a watchlist row used to sit on the dashboard with no feedback while
// the detail page resolved (Supabase reads + live Yahoo fields). This boundary
// paints instantly on navigation and mirrors the real layout: back link →
// header → tabs → scorecard + chart.
export default function Loading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-5 w-28" />

      <div className="flex flex-wrap items-center gap-3">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>

      {/* tab bar */}
      <div className="flex gap-2 border-b border-border pb-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24" />
        ))}
      </div>

      {/* scorecard grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-7 w-20" />
            <Skeleton className="mt-2 h-3 w-32" />
          </Card>
        ))}
      </div>

      {/* chart */}
      <Card className="p-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-4 h-64 w-full" />
      </Card>
    </div>
  )
}
