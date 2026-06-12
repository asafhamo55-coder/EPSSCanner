import * as React from 'react'
import { cn } from '../lib/cn'

// Segmented underline tabs used as in-page sub-nav (e.g. /vendors with
// Active / Invitations / Approval Queue / RFPs sub-pages). Active state
// is driven by the caller passing the current pathname or an explicit
// `active` flag — keeps this primitive RSC-safe.

export interface TabItem {
  label: string
  href: string
  badge?: string | number | null
  /** When provided, overrides the pathname-prefix match. */
  active?: boolean
}

export interface TabsProps {
  items: TabItem[]
  /** Used to compute active state when `item.active` is not set. */
  currentPath?: string
  className?: string
  'aria-label'?: string
}

function isActive(item: TabItem, currentPath?: string): boolean {
  if (typeof item.active === 'boolean') return item.active
  if (!currentPath) return false
  if (item.href === currentPath) return true
  // Treat /vendors as active for /vendors and /vendors/<id> but not
  // /vendors/invitations.
  return currentPath.startsWith(`${item.href}/`)
}

export function Tabs({ items, currentPath, className, ...aria }: TabsProps) {
  return (
    <nav
      aria-label={aria['aria-label'] ?? 'Page sections'}
      className={cn(
        'flex flex-wrap items-end gap-1 border-b border-border',
        className,
      )}
    >
      {items.map((item) => {
        const active = isActive(item, currentPath)
        return (
          <a
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted hover:text-foreground hover:border-border',
            )}
          >
            <span>{item.label}</span>
            {item.badge != null && item.badge !== '' && item.badge !== 0 ? (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none',
                  active
                    ? 'bg-primary/15 text-primary'
                    : 'bg-muted/10 text-muted',
                )}
              >
                {item.badge}
              </span>
            ) : null}
          </a>
        )
      })}
    </nav>
  )
}
