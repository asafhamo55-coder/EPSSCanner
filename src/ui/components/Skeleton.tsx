import * as React from 'react'
import { cn } from '../lib/cn'

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-shimmer rounded-md bg-[linear-gradient(110deg,hsl(var(--border))_8%,hsl(var(--surface))_18%,hsl(var(--border))_33%)] bg-[length:200%_100%]',
        className,
      )}
      {...props}
    />
  )
}
