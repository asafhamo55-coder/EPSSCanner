'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '../lib/cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-fg hover:opacity-90',
        outline: 'border border-border bg-transparent hover:bg-surface',
        ghost: 'bg-transparent hover:bg-surface',
        destructive: 'bg-destructive text-white hover:opacity-90',
        link: 'bg-transparent text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, disabled, children, ...props }, ref) => {
    // asChild path: hand off to whatever component the consumer passed
    // (typically a Next <Link>). Slot uses React.Children.only, so we
    // can't add a sibling spinner — loading state isn't meaningful for
    // nav links anyway.
    if (asChild) {
      return (
        <Slot
          ref={ref}
          className={cn(buttonVariants({ variant, size }), className)}
          {...props}
        >
          {children}
        </Slot>
      )
    }

    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'

export { buttonVariants }
