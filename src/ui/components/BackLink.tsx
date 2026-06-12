import * as React from 'react'
import { ArrowLeft } from 'lucide-react'

export interface BackLinkProps {
  href: string
  label?: React.ReactNode
}

export function BackLink({ href, label = 'Back' }: BackLinkProps) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {label}
    </a>
  )
}
