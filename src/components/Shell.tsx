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
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
          </div>
        </AppShellHeader>
        <AppShellContent>{children}</AppShellContent>
      </AppShellMain>
    </AppShell>
  )
}
