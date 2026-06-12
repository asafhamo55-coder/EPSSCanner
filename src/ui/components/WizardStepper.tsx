import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '../lib/cn'

export interface WizardStep {
  id: string
  label: string
  description?: string
  /** Status — 'done' shows a check, 'current' is highlighted, 'upcoming' is dimmed. */
  status?: 'done' | 'current' | 'upcoming'
}

interface WizardStepperProps {
  steps: WizardStep[]
  /** Index of the current step (0-based). Used to compute percent + statuses
   *  if individual step.status fields aren't set. */
  currentIndex?: number
  /** Use a vertical stepper. Defaults to vertical (matches a sidebar layout).
   *  Set to false for horizontal track. */
  vertical?: boolean
  className?: string
}

/**
 * Reusable wizard progress indicator. Two layout modes:
 *
 *   vertical (default) — fits a sidebar, 1 step per row. Each step shows
 *     numbered circle + label + description. Past/current/upcoming
 *     status drives color.
 *
 *   horizontal — fits the top of a page; small circles + tiny labels.
 *
 * Both modes show a "X of N" + percent below.
 *
 * The component is a pure renderer. Callers compute step status (or pass
 * currentIndex and let us derive it).
 */
export function WizardStepper({
  steps,
  currentIndex,
  vertical = true,
  className,
}: WizardStepperProps) {
  const resolved = steps.map((s, i) => ({
    ...s,
    status:
      s.status ??
      (currentIndex === undefined
        ? 'upcoming'
        : i < currentIndex
          ? 'done'
          : i === currentIndex
            ? 'current'
            : 'upcoming'),
  }))

  const doneCount = resolved.filter((s) => s.status === 'done').length
  const currentIdx = resolved.findIndex((s) => s.status === 'current')
  const positionFor = currentIdx === -1 ? doneCount : currentIdx
  const percent = Math.round(
    (steps.length > 0 ? Math.min(positionFor + (currentIdx === -1 ? 0 : 1), steps.length) / steps.length : 0) * 100,
  )
  const stepLabel =
    currentIdx === -1 && doneCount === steps.length
      ? `Done · ${steps.length}/${steps.length}`
      : `Step ${currentIdx === -1 ? doneCount + 1 : currentIdx + 1} of ${steps.length}`

  if (!vertical) {
    return (
      <div className={cn('space-y-2', className)}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">{stepLabel}</p>
          <p className="text-xs text-muted">{percent}% complete</p>
        </div>
        <div className="flex gap-1">
          {resolved.map((s) => (
            <div
              key={s.id}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                s.status === 'done' || s.status === 'current'
                  ? 'bg-primary'
                  : 'bg-border',
              )}
              title={s.label}
            />
          ))}
        </div>
        <p className="text-xs text-muted">
          {resolved[currentIdx === -1 ? Math.max(0, doneCount - 1) : currentIdx]?.label}
        </p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold text-foreground">Workflow</p>
        <p className="text-xs text-muted">
          {stepLabel} · {percent}%
        </p>
      </div>
      <ol className="space-y-1">
        {resolved.map((s, i) => (
          <li key={s.id} className="flex items-start gap-3 py-1">
            <div className="mt-0.5 flex flex-col items-center">
              <span
                aria-label={`Step ${i + 1}: ${s.status}`}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                  s.status === 'done'
                    ? 'border-emerald-300 bg-emerald-100 text-emerald-700'
                    : s.status === 'current'
                      ? 'border-primary bg-primary text-primary-fg'
                      : 'border-border bg-surface text-muted',
                )}
              >
                {s.status === 'done' ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              {i < resolved.length - 1 ? (
                <span
                  className={cn(
                    'mt-1 h-4 w-px',
                    s.status === 'done' ? 'bg-emerald-300' : 'bg-border',
                  )}
                  aria-hidden
                />
              ) : null}
            </div>
            <div className="min-w-0 flex-1 pb-2">
              <p
                className={cn(
                  'text-sm font-medium',
                  s.status === 'upcoming' ? 'text-muted' : 'text-foreground',
                )}
              >
                {s.label}
              </p>
              {s.description ? (
                <p className="text-xs text-muted">{s.description}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
