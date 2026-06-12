import * as React from 'react'
import { cn } from '../lib/cn'

export interface KeyValueProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode
  value: React.ReactNode
}

/**
 * Single label/value pair used inside detail pages.
 *
 * Renders a small uppercase label above its value (vertical on mobile and
 * inside a `KeyValueList` grid on wider screens). Falls back to a muted em
 * dash when `value` is nullish or an empty string so callers don't have to
 * branch on missing data.
 */
export const KeyValue = React.forwardRef<HTMLDivElement, KeyValueProps>(
  ({ label, value, className, ...props }, ref) => {
    const isEmpty =
      value === null || value === undefined || value === ''
    return (
      <div ref={ref} className={cn('space-y-0.5', className)} {...props}>
        <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
        <dd className="text-sm text-foreground">
          {isEmpty ? <span className="text-muted">—</span> : value}
        </dd>
      </div>
    )
  },
)
KeyValue.displayName = 'KeyValue'

export interface KeyValueListProps extends React.HTMLAttributes<HTMLDListElement> {}

/**
 * Grouping wrapper that lays `KeyValue` children out in a responsive
 * two-column grid on `sm` and up. Use directly inside a `CardContent` or
 * other section container.
 */
export const KeyValueList = React.forwardRef<HTMLDListElement, KeyValueListProps>(
  ({ className, ...props }, ref) => (
    <dl
      ref={ref}
      className={cn('grid gap-x-6 gap-y-3 sm:grid-cols-2', className)}
      {...props}
    />
  ),
)
KeyValueList.displayName = 'KeyValueList'
