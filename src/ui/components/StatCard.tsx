import * as React from 'react'
import { cn } from '../lib/cn'
import { Card } from './Card'

export interface StatCardProps {
  /** Icon node (consumer-supplied so packages/ui stays free of lucide). */
  icon?: React.ReactNode
  /** Small muted label rendered next to the icon (e.g. "Action required"). */
  label: string
  /** Primary big number / string (rendered text-3xl). Ignored when emptyState is set. */
  value?: React.ReactNode
  /** Small subtext under the value (e.g. "items need approval"). */
  meta?: React.ReactNode
  /** Optional node rendered inline next to the value (e.g. an overdue Badge). */
  valueExtra?: React.ReactNode
  /** Optional href — when set the entire card becomes a clickable <a>. */
  href?: string
  /** Optional CTA text rendered at the bottom (e.g. "Review now →"). */
  cta?: React.ReactNode
  /**
   * If non-null, the card replaces value/meta/cta with this muted line.
   * Caller decides the copy (e.g. "Inbox zero. Nothing waiting on you.").
   */
  emptyState?: React.ReactNode | null
  className?: string
}

/**
 * Compact dashboard stat tile. Always uses Card variant="interactive" so it
 * gets the hover-lift + border-tint affordance. When `href` is set the whole
 * tile is wrapped in an <a>; packages/ui has no Next dependency, so consumers
 * that want soft-routing should wrap StatCard in their router's Link.
 */
export function StatCard({
  icon,
  label,
  value,
  meta,
  valueExtra,
  href,
  cta,
  emptyState,
  className,
}: StatCardProps) {
  const isEmpty = emptyState !== undefined && emptyState !== null

  const inner = (
    <div className={cn('group flex flex-col gap-3 p-6', !href && className)}>
      <div className="flex items-center gap-2 text-sm font-medium text-muted">
        {icon}
        <span>{label}</span>
      </div>

      {isEmpty ? (
        <p className="text-sm text-muted">{emptyState}</p>
      ) : (
        <>
          <div className="flex items-baseline gap-3">
            <p className="text-3xl font-bold text-foreground">{value}</p>
            {valueExtra}
          </div>
          {meta ? <p className="text-sm text-muted">{meta}</p> : null}
          {cta ? (
            <p className="text-sm font-medium text-primary group-hover:underline">{cta}</p>
          ) : null}
        </>
      )}
    </div>
  )

  if (href) {
    return (
      <a
        href={href}
        className={cn(
          'block rounded-xl no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          className,
        )}
      >
        <Card variant="interactive">{inner}</Card>
      </a>
    )
  }

  return <Card variant="interactive">{inner}</Card>
}
