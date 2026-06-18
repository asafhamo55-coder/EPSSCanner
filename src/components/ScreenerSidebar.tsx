'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Calculator, LineChart } from 'lucide-react'
import {
  NavItem,
  SidebarBrand,
  SidebarFooter,
  SidebarNav,
} from '@/ui'

const NAV = [
  { href: '/', label: 'Dashboard', icon: <LineChart className="h-4 w-4" /> },
  { href: '/evaluation', label: 'Company evaluation', icon: <Calculator className="h-4 w-4" /> },
]

export function ScreenerSidebar() {
  const pathname = usePathname()
  return (
    <div className="flex h-full flex-col">
      <SidebarBrand>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-brand text-sm font-bold text-white shadow-sm ring-brand">
          Q
        </span>
        <span className="text-base font-bold tracking-tight">
          <span className="text-gradient-brand">TripleQ</span>{' '}
          <span className="text-foreground">Group</span>
        </span>
      </SidebarBrand>
      <SidebarNav>
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} legacyBehavior passHref>
            <NavItem
              icon={item.icon}
              label={item.label}
              active={item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)}
            />
          </Link>
        ))}
      </SidebarNav>
      <SidebarFooter>
        <p className="px-1 text-xs text-muted">
          Fundamental signals only — not investment advice.
        </p>
      </SidebarFooter>
    </div>
  )
}
