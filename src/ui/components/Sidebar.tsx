import * as React from 'react'
import { cn } from '../lib/cn'

export function SidebarBrand({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex h-14 items-center gap-2 border-b border-border px-4 text-base font-semibold text-foreground',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function SidebarNav({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <nav className={cn('flex-1 overflow-y-auto px-2 py-4', className)} aria-label="Sidebar">
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </nav>
  )
}

export interface NavItemProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  icon?: React.ReactNode
  label: string
  badge?: React.ReactNode
  active?: boolean
}

// Renders an <a> so it works both with framework Links (asChild-style via
// rendering a child) and plain hrefs. App code typically wraps it in a
// next/link <Link>.
export const NavItem = React.forwardRef<HTMLAnchorElement, NavItemProps>(
  ({ icon, label, badge, active, className, children, ...props }, ref) => (
    <li>
      <a
        ref={ref}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          active
            ? 'bg-primary/10 text-primary'
            : 'text-muted hover:bg-background hover:text-foreground',
          className,
        )}
        aria-current={active ? 'page' : undefined}
        {...props}
      >
        {icon ? <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span> : null}
        <span className="flex-1 truncate">{label}</span>
        {badge !== undefined && badge !== null ? (
          <span className="shrink-0 text-xs">{badge}</span>
        ) : null}
        {children}
      </a>
    </li>
  ),
)
NavItem.displayName = 'NavItem'

export function SidebarFooter({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('border-t border-border p-3', className)}>{children}</div>
  )
}

export function SidebarSection({
  label,
  children,
  className,
}: {
  label?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-2 mt-3 first:mt-0', className)}>
      {label ? (
        <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted/70">
          {label}
        </p>
      ) : null}
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  )
}
