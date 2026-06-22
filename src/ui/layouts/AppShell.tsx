'use client'

import * as React from 'react'
import { Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { cn } from '../lib/cn'

interface AppShellContextValue {
  mobileOpen: boolean
  setMobileOpen: (v: boolean) => void
  collapsed: boolean
  setCollapsed: (v: boolean) => void
}

const AppShellContext = React.createContext<AppShellContextValue | null>(null)

/** Read the shell state (mobile drawer + desktop collapse). Exported so the
 *  sidebar content can render an icon-only rail when collapsed. */
export function useAppShell() {
  const ctx = React.useContext(AppShellContext)
  if (!ctx) throw new Error('AppShell.* must be rendered inside <AppShell>')
  return ctx
}

const COLLAPSE_KEY = 'appshell:collapsed'

export function AppShell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [collapsed, setCollapsed] = React.useState(false)

  // Restore the desktop collapse preference after mount (avoids SSR mismatch).
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1')
  }, [])

  const updateCollapsed = React.useCallback((v: boolean) => {
    setCollapsed(v)
    if (typeof window !== 'undefined') window.localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0')
  }, [])

  // Close the mobile drawer on any client-side navigation.
  React.useEffect(() => {
    if (!mobileOpen) return
    const close = () => setMobileOpen(false)
    window.addEventListener('popstate', close)
    return () => window.removeEventListener('popstate', close)
  }, [mobileOpen])

  return (
    <AppShellContext.Provider
      value={{ mobileOpen, setMobileOpen, collapsed, setCollapsed: updateCollapsed }}
    >
      <div className={cn('flex min-h-screen bg-background', className)}>{children}</div>
    </AppShellContext.Provider>
  )
}

export function AppShellSidebar({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const { mobileOpen, setMobileOpen, collapsed } = useAppShell()

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      ) : null}

      <aside
        className={cn(
          // Mobile: off-canvas 64-wide drawer. Desktop: sticky rail that
          // narrows to an icon strip when collapsed.
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-surface transition-[transform,width] duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed ? 'md:w-16' : 'md:w-64',
          className,
        )}
        aria-label="Primary navigation"
      >
        {children}
      </aside>
    </>
  )
}

export function AppShellMain({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn('flex min-w-0 flex-1 flex-col', className)}>{children}</div>
}

export function AppShellHeader({
  children,
  className,
}: {
  children?: React.ReactNode
  className?: string
}) {
  const { mobileOpen, setMobileOpen, collapsed, setCollapsed } = useAppShell()

  return (
    <header
      className={cn(
        'sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur md:px-6',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setMobileOpen(!mobileOpen)}
        className="-ml-1 rounded-md p-1 text-muted hover:bg-background md:hidden"
        aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="-ml-1 hidden rounded-md p-1 text-muted hover:bg-background md:inline-flex"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
      </button>
      {children}
    </header>
  )
}

export function AppShellContent({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <main className={cn('mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-8 md:py-8', className)}>
      {children}
    </main>
  )
}
