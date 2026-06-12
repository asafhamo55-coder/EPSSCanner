'use client'

import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'
import { cn } from '../lib/cn'

// `useConfirm()` returns an async function that opens a modal and resolves
// to true (confirmed) or false (cancelled). Designed to replace
// `window.confirm` 1-for-1 at call sites.

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Destructive confirms render the primary action in red. */
  destructive?: boolean
}

type Resolver = (value: boolean) => void
type ConfirmState = ConfirmOptions & { resolve: Resolver }

const ConfirmCtx = React.createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<ConfirmState | null>(null)
  const dialogRef = React.useRef<HTMLDialogElement | null>(null)

  const confirm = React.useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setState({ ...opts, resolve })
      }),
    [],
  )

  React.useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (state) {
      if (!dialog.open) dialog.showModal()
    } else if (dialog.open) {
      dialog.close()
    }
  }, [state])

  const close = React.useCallback(
    (result: boolean) => {
      if (!state) return
      state.resolve(result)
      setState(null)
    },
    [state],
  )

  // Treat ESC / backdrop close as cancel.
  const onCancel = React.useCallback(
    (e: React.SyntheticEvent<HTMLDialogElement>) => {
      e.preventDefault()
      close(false)
    },
    [close],
  )

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <dialog
        ref={dialogRef}
        onCancel={onCancel}
        onClick={(e) => {
          // Click on the backdrop (the dialog element itself) cancels.
          if (e.target === e.currentTarget) close(false)
        }}
        className={cn(
          'm-auto rounded-xl border border-border bg-surface p-0 text-foreground shadow-xl',
          'max-w-md w-[calc(100%-2rem)]',
          'backdrop:bg-black/40 backdrop:backdrop-blur-sm',
          'animate-fade-in',
        )}
      >
        {state ? (
          <div className="space-y-4 p-6">
            <div className="flex items-start gap-3">
              {state.destructive ? (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                  <AlertTriangle className="h-5 w-5" aria-hidden />
                </div>
              ) : null}
              <div className="flex-1 space-y-1">
                <h3 className="text-lg font-semibold text-foreground">{state.title}</h3>
                {state.description ? (
                  <p className="text-sm text-muted">{state.description}</p>
                ) : null}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => close(false)} autoFocus>
                {state.cancelLabel ?? 'Cancel'}
              </Button>
              <Button
                variant={state.destructive ? 'destructive' : 'default'}
                onClick={() => close(true)}
              >
                {state.confirmLabel ?? 'Confirm'}
              </Button>
            </div>
          </div>
        ) : null}
      </dialog>
    </ConfirmCtx.Provider>
  )
}

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = React.useContext(ConfirmCtx)
  if (!ctx) {
    throw new Error('useConfirm() must be used inside <ConfirmProvider>')
  }
  return ctx
}
