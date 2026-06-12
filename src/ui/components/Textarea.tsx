'use client'

import * as React from 'react'
import { cn } from '../lib/cn'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean
  showCount?: boolean
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, showCount = true, maxLength, value, defaultValue, onChange, ...props }, ref) => {
    const [internal, setInternal] = React.useState<string>(
      typeof defaultValue === 'string' ? defaultValue : '',
    )
    const current = typeof value === 'string' ? value : internal

    return (
      <div className="space-y-1">
        <textarea
          ref={ref}
          maxLength={maxLength}
          value={value}
          defaultValue={defaultValue}
          onChange={(e) => {
            if (value === undefined) setInternal(e.target.value)
            onChange?.(e)
          }}
          className={cn(
            'flex min-h-[80px] w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm transition-colors placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50',
            error && 'border-destructive focus:ring-destructive',
            className,
          )}
          {...props}
        />
        {showCount ? (
          <p className="text-right text-xs text-muted">
            {maxLength ? (
              <>
                {current.length} / {maxLength}{' '}
                <span className="text-muted/70">characters</span>
              </>
            ) : (
              <>
                {current.length} {current.length === 1 ? 'character' : 'characters'}
              </>
            )}
          </p>
        ) : null}
      </div>
    )
  },
)
Textarea.displayName = 'Textarea'
