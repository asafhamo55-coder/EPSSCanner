import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Info, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { cn } from '../lib/cn'

const alertVariants = cva('flex gap-3 rounded-xl border p-4 text-sm', {
  variants: {
    variant: {
      info: 'border-blue-200 bg-blue-50 text-blue-900',
      success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
      warning: 'border-amber-200 bg-amber-50 text-amber-900',
      error: 'border-red-200 bg-red-50 text-red-900',
    },
  },
  defaultVariants: { variant: 'info' },
})

const iconMap = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
} as const

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  title?: string
  hideIcon?: boolean
}

export function Alert({
  className,
  variant = 'info',
  title,
  hideIcon,
  children,
  ...props
}: AlertProps) {
  const Icon = iconMap[variant ?? 'info']
  return (
    <div role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      {!hideIcon ? <Icon className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden /> : null}
      <div className="flex-1">
        {title ? <p className="mb-1 font-semibold">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  )
}
