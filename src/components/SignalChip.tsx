import { Badge, type BadgeProps } from '@/ui'
import type { SignalState } from '@/lib/signals'

// Maps a methodology signal state → a colored chip. Tones reuse the shared
// Badge variants so the screener matches the HOA status-chip language:
// success=green (pass/turnaround), warning=amber (flag), destructive=red
// (fail), neutral=grey (n/a).
const TONE: Record<SignalState, NonNullable<BadgeProps['variant']>> = {
  pass: 'success',
  turnaround: 'info',
  flag: 'warning',
  fail: 'destructive',
  na: 'neutral',
}

const DEFAULT_LABEL: Record<SignalState, string> = {
  pass: 'Pass',
  turnaround: 'Turnaround',
  flag: 'Flag',
  fail: 'Fail',
  na: 'N/A',
}

export function SignalChip({
  state,
  label,
  size = 'sm',
}: {
  state: SignalState
  /** Override the chip text (e.g. "+131%", "Decelerating"). */
  label?: string
  size?: BadgeProps['size']
}) {
  return (
    <Badge variant={TONE[state]} size={size}>
      {label ?? DEFAULT_LABEL[state]}
    </Badge>
  )
}
