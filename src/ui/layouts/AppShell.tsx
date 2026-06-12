'use client'

import * as React from 'react'
import { Menu, X } from 'lucide-react'
import { cn } from '../lib/cn'

interface AppShellContextValue {
  mobileOpen: boolean
  setMobileOpen: (v: boolean) => void
}

const AppShellContext = React.createContext<AppShellContextValue | null>(null)

function useAppShell() {
  const ctx = React.useContext(AppShellContext)
  if (!ctx) throw new Error('AppShell.* must be rendered inside <AppShell>')
  return ctx
}

export function AppShell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const [mobileOpen, setMobileOpen] = React.useState(false)

  // Close the mobile drawer on any client-side navigation.
  React.useEffect(() => {
    if (!mobileOpen) return
    const close = () => setMobileOpen(false)
    window.addEventListener('popstate', close)
    return () => window.removeEventListener('popstate', close)
  }, [mobileOpen])

  return (
    <AppShellContext.Provider value={{ mobileOpen, setMobileOpen }}>
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
  const { mobileOpen, setMobileOpen } = useAppShell()

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
          // Mobile: off-canvas drawer.
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-surface transition-transform duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
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
  const { mobileOpen, setMobileOpen } = useAppShell()

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
  return <main className={cn('flex-1 px-4 py-6 md:px-6 md:py-8', className)}>{children}</main>
}
