'use client'

import * as React from 'react'
import { ShieldAlert, CheckCircle2 } from 'lucide-react'
import { Button } from './Button'
import { cn } from '../lib/cn'

export interface BarBGateProps {
  /** AI-generated content. The user can edit this before approving. */
  content: string

  /** Title shown above the warning copy. */
  title?: string

  /** Warning copy. Override if the default is too generic for the use case. */
  description?: string

  /** Approve action — receives the edited content (NOT the original). */
  onApprove: (editedContent: string) => void | Promise<void>

  /** Reject action. UI usually closes the wizard or kicks the user back to edit. */
  onReject?: () => void

  /** Loading state for the approve button (network call in progress). */
  isLoading?: boolean

  /** Label for the approve button. */
  approveLabel?: string

  /** Label for the reject button. */
  rejectLabel?: string

  className?: string
}

// BarBGate is the bar-raise gate every AI artifact must pass through before
// it leaves the system. Two non-negotiable behaviors:
//   1. Content is editable. The user owns the final wording.
//   2. Approve is disabled until the user scrolls the content to the bottom.
//      This forces them to actually read the draft.
export function BarBGate({
  content,
  title = 'Human Review Required',
  description = 'This content was drafted by AI. Read it carefully — you are responsible for what gets sent.',
  onApprove,
  onReject,
  isLoading,
  approveLabel = 'Approve & Send',
  rejectLabel = 'Request Changes',
  className,
}: BarBGateProps) {
  const [edited, setEdited] = React.useState(content)
  const [hasScrolledToBottom, setHasScrolledToBottom] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // Re-sync if the upstream content changes (e.g. user re-runs the AI).
  React.useEffect(() => {
    setEdited(content)
    setHasScrolledToBottom(false)
  }, [content])

  // Detect scroll-to-bottom on the editable textarea. Threshold of 4px to
  // account for sub-pixel rounding.
  function handleScroll(e: React.UIEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 4
    if (atBottom && !hasScrolledToBottom) setHasScrolledToBottom(true)
  }

  // If content is short enough that there's no scrollbar, the user has
  // already "seen the whole thing" — unlock immediately.
  React.useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const fitsWithoutScroll = el.scrollHeight <= el.clientHeight + 4
    if (fitsWithoutScroll) setHasScrolledToBottom(true)
  }, [edited])

  const canApprove = hasScrolledToBottom && !isLoading

  return (
    <div className={cn('overflow-hidden rounded-xl border-l-4 border-amber-500 bg-amber-50/40', className)}>
      <header className="flex items-start gap-3 border-b border-amber-200 bg-amber-50 p-4">
        <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-700" aria-hidden />
        <div className="flex-1">
          <p className="font-semibold text-amber-900">{title}</p>
          <p className="mt-1 text-sm text-amber-800">{description}</p>
        </div>
      </header>

      <div className="bg-surface p-4">
        <label htmlFor="bar-b-gate-content" className="sr-only">
          AI-generated content (editable)
        </label>
        <textarea
          id="bar-b-gate-content"
          ref={textareaRef}
          value={edited}
          onChange={(e) => setEdited(e.target.value)}
          onScroll={handleScroll}
          rows={16}
          className="w-full resize-y rounded-lg border border-border bg-background p-3 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {!hasScrolledToBottom ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
            <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-amber-500" />
            Scroll the draft to the bottom to enable the approve button.
          </p>
        ) : (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            Draft reviewed. Ready to approve.
          </p>
        )}
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-border bg-surface px-4 py-3">
        {onReject ? (
          <Button variant="outline" onClick={onReject} disabled={isLoading}>
            {rejectLabel}
          </Button>
        ) : null}
        <Button
          variant="default"
          onClick={() => onApprove(edited)}
          disabled={!canApprove}
          loading={isLoading}
          aria-disabled={!canApprove}
        >
          {approveLabel}
        </Button>
      </footer>
    </div>
  )
}
