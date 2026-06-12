'use client'

import * as React from 'react'
import { ChevronDown, ExternalLink, Building2, Gavel, Home as HomeIcon } from 'lucide-react'
import { cn } from '../lib/cn'

export type HubType = 'hoa' | 'eviction' | 'pm'

export interface Hub {
  /** Stable identifier, drives the icon and the (current vs other) split. */
  type: HubType
  /** Display label, e.g. "HOA Hub" / "Eviction Hub" / "PM Hub". */
  label: string
  /** Absolute URL to that hub's dashboard. Pulled from NEXT_PUBLIC_*_URL env. */
  url: string
  /**
   * The user's org name in this hub, if any. Hubs the user has no org in
   * are still rendered (with a "Create" hint) so they can self-serve into
   * a second hub from the dropdown.
   */
  orgName?: string
}

interface HubSwitcherProps {
  current: HubType
  hubs: Hub[]
}

const ICONS: Record<HubType, React.ComponentType<{ className?: string }>> = {
  hoa: HomeIcon,
  eviction: Gavel,
  pm: Building2,
}

export function HubSwitcher({ current, hubs }: HubSwitcherProps) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  // Close on outside click + Escape, the way every other dropdown should.
  React.useEffect(() => {
    if (!open) return
    function handlePointer(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', handlePointer)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handlePointer)
      window.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const currentHub = hubs.find((h) => h.type === current)
  const CurrentIcon = ICONS[current]

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-background"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary/10 text-primary">
          <CurrentIcon className="h-3.5 w-3.5" />
        </span>
        <span className="hidden sm:inline">
          {currentHub?.label ?? labelFor(current)}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted" aria-hidden />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
        >
          <p className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Switch hub
          </p>
          <ul className="py-1">
            {hubs.map((h) => {
              const Icon = ICONS[h.type]
              const isCurrent = h.type === current
              return (
                <li key={h.type}>
                  {isCurrent ? (
                    <div className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">{h.label}</p>
                        <p className="truncate text-xs text-muted">
                          {h.orgName ?? 'Active'} · current
                        </p>
                      </div>
                    </div>
                  ) : (
                    <a
                      href={h.url}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-background',
                      )}
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted/10 text-muted">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">{h.label}</p>
                        <p className="truncate text-xs text-muted">
                          {h.orgName ?? 'Sign in to set up'}
                        </p>
                      </div>
                      <ExternalLink className="h-3.5 w-3.5 text-muted" aria-hidden />
                    </a>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function labelFor(t: HubType): string {
  switch (t) {
    case 'hoa':
      return 'HOA Hub'
    case 'eviction':
      return 'Eviction Hub'
    case 'pm':
      return 'PM Hub'
  }
}
