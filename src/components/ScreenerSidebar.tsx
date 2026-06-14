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
        <LineChart className="h-5 w-5 text-primary" />
        <span>TripleQ Group</span>
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
