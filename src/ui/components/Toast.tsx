'use client'

import * as React from 'react'
import { CheckCircle2, Info, AlertCircle, X } from 'lucide-react'
import { cn } from '../lib/cn'

// Lightweight toast system. Mounts a fixed-position viewport in the bottom
// right; each toast is auto-dismissed after `duration` ms unless the user
// dismisses it manually. Use via `useToast()` at the consumer site.

type ToastTone = 'success' | 'error' | 'info'

export interface ToastOptions {
  message: string
  tone?: ToastTone
  /** ms before auto-dismiss. 0 = sticky. Default 4500. */
  duration?: number
}

interface ToastRow extends Required<Omit<ToastOptions, 'duration'>> {
  id: number
  duration: number
}

const ToastCtx = React.createContext<((opts: ToastOptions) => void) | null>(null)

let nextId = 1

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRow[]>([])

  const dismiss = React.useCallback((id: number) => {
    setToasts((rows) => rows.filter((r) => r.id !== id))
  }, [])

  const push = React.useCallback(
    (opts: ToastOptions) => {
      const row: ToastRow = {
        id: nextId++,
        message: opts.message,
        tone: opts.tone ?? 'info',
        duration: opts.duration ?? 4500,
      }
      setToasts((rows) => [...rows, row])
      if (row.duration > 0) {
        setTimeout(() => dismiss(row.id), row.duration)
      }
    },
    [dismiss],
  )

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <ToastBody key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

function ToastBody({ toast, onDismiss }: { toast: ToastRow; onDismiss: () => void }) {
  const Icon =
    toast.tone === 'success' ? CheckCircle2 : toast.tone === 'error' ? AlertCircle : Info
  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto animate-slide-in-right flex items-start gap-3 rounded-lg border bg-surface px-4 py-3 shadow-md',
        toast.tone === 'success' && 'border-primary/30',
        toast.tone === 'error' && 'border-destructive/40',
        toast.tone === 'info' && 'border-border',
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          toast.tone === 'success' && 'text-primary',
          toast.tone === 'error' && 'text-destructive',
          toast.tone === 'info' && 'text-muted',
        )}
        aria-hidden
      />
      <p className="flex-1 text-sm leading-snug text-foreground">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="-mr-1 -mt-1 rounded p-1 text-muted hover:bg-background hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  )
}

export function useToast(): (opts: ToastOptions) => void {
  const ctx = React.useContext(ToastCtx)
  if (!ctx) {
    throw new Error('useToast() must be used inside <ToastProvider>')
  }
  return ctx
}
