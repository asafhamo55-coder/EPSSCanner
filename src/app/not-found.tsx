import Link from 'next/link'
import { SearchX } from 'lucide-react'
import { Button, EmptyState } from '@/ui'

export default function NotFound() {
  return (
    <EmptyState
      icon={<SearchX className="h-8 w-8" />}
      title="Not tracked"
      description="That ticker isn't on your watchlist. Add it from the dashboard to start pulling its fundamentals."
      action={
        <Button asChild>
          <Link href="/">Back to watchlist</Link>
        </Button>
      }
    />
  )
}
