import * as React from 'react'

export interface PageHeaderProps {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1>{title}</h1>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  )
}
