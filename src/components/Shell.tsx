'use client'

import {
  AppShell,
  AppShellContent,
  AppShellHeader,
  AppShellMain,
  AppShellSidebar,
} from '@/ui'
import { ScreenerSidebar } from './ScreenerSidebar'
import { ThemeToggle } from './ThemeToggle'

// App-wide chrome: off-canvas sidebar drawer on mobile, sticky sidebar on
// desktop — identical shell to the HOA dashboard. No auth gate (free app).
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <AppShellSidebar>
        <ScreenerSidebar />
      </AppShellSidebar>
      <AppShellMain>
        <AppShellHeader>
          <span className="text-sm font-bold tracking-tight md:hidden">
            <span className="text-gradient-brand">TripleQ</span>{' '}
            <span className="text-foreground">Group</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
          </div>
        </AppShellHeader>
        <AppShellContent>{children}</AppShellContent>
      </AppShellMain>
    </AppShell>
  )
}
