import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-fg',
        success: 'border-transparent bg-emerald-100 text-emerald-800',
        warning: 'border-transparent bg-amber-100 text-amber-800',
        destructive: 'border-transparent bg-red-100 text-red-800',
        info: 'border-transparent bg-sky-100 text-sky-800',
        neutral: 'border-transparent bg-slate-100 text-slate-700',
        // AI-generated content. Matches the Sparkles icon family used for AI affordances.
        ai: 'border-transparent bg-amber-100 text-amber-800',
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
