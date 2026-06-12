'use client'

import * as React from 'react'
import { cn } from '../lib/cn'

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  error?: boolean
  prefix?: React.ReactNode
  suffix?: React.ReactNode
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, prefix, suffix, ...props }, ref) => {
    if (prefix || suffix) {
      return (
        <div
          className={cn(
            'flex h-10 items-center rounded-lg border border-border bg-surface px-3 transition-colors focus-within:ring-2 focus-within:ring-primary',
            error && 'border-destructive focus-within:ring-destructive',
            className,
          )}
        >
          {prefix ? <span className="mr-2 flex shrink-0 items-center text-muted">{prefix}</span> : null}
          <input
            ref={ref}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted disabled:opacity-50"
            {...props}
          />
          {suffix ? <span className="ml-2 flex shrink-0 items-center text-muted">{suffix}</span> : null}
        </div>
      )
    }

    return (
      <input
        ref={ref}
        className={cn(
          'flex h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm transition-colors placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50',
          error && 'border-destructive focus:ring-destructive',
          className,
        )}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'
