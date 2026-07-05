import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-fg',
        // Semantic tones are font-color only (no fill) so the color coding
        // reads as colored text, matching the "% vs SMA 150" column.
        success: 'border-transparent text-emerald-600 dark:text-emerald-400',
        warning: 'border-transparent text-amber-600 dark:text-amber-400',
        destructive: 'border-transparent text-red-600 dark:text-red-400',
        info: 'border-transparent text-sky-600 dark:text-sky-400',
        neutral: 'border-transparent text-muted',
        // AI-generated content. Matches the Sparkles icon family used for AI affordances.
        ai: 'border-transparent text-amber-600 dark:text-amber-400',
        outline: 'border-border bg-transparent',
      },
      size: {
        sm: 'px-2 py-0.5 text-xs',
        md: 'px-2.5 py-1 text-sm',
      },
    },
    defaultVariants: { variant: 'default', size: 'sm' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />
}

export { badgeVariants }
