import * as React from 'react'
import { Badge, type BadgeProps } from './Badge'

// Couples the badge variant + a humanized label so list pages stop
// rendering raw enums like `notice_sent` or `prospect`. Pass a label
// map per kind so vendors / violations / dues / etc. each control
// their own status copy.

type Tone = NonNullable<BadgeProps['variant']>

export interface StatusBadgeProps {
  status: string
  /**
   * Status → tone mapping. Status keys not in the map fall back to `neutral`.
   */
  tones?: Record<string, Tone>
  /**
   * Status → display label mapping. Status keys not in the map are
   * humanized by replacing underscores with spaces and capitalizing.
   */
  labels?: Record<string, string>
  size?: BadgeProps['size']
  className?: string
}

function defaultHumanize(s: string): string {
  if (!s) return ''
  const cleaned = s.replace(/_/g, ' ').toLowerCase()
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

export function StatusBadge({ status, tones, labels, size, className }: StatusBadgeProps) {
  const tone: Tone = (tones && tones[status]) || 'neutral'
  const label = (labels && labels[status]) || defaultHumanize(status)
  return (
    <Badge variant={tone} size={size} className={className}>
      {label}
    </Badge>
  )
}

export { defaultHumanize as humanizeStatus }
