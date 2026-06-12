'use client'

import * as React from 'react'
import * as RS from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '../lib/cn'

// Radix-based Select with a fully styleable open menu (the #1 reason
// native HTML <select> looks bad — browsers render the option list
// with OS chrome that CSS can't reach).
//
// API: pass children as <option value="x">Label</option> exactly like
// a native select. We parse them at render time and feed the values
// into Radix. This keeps every call site one find-replace away from
// the old native Select (onChange={e=>fn(e.target.value)} →
// onValueChange={fn}).
//
// Forms: an internal <input type="hidden"> mirrors `value` so the
// Select still participates in <form action={...}> submissions.

export interface SelectOptionData {
  value: string
  label: React.ReactNode
  disabled?: boolean
}

export interface SelectProps {
  /** Controlled value. */
  value?: string
  /** Uncontrolled default. */
  defaultValue?: string
  /** Fires with the selected value (not an Event). */
  onValueChange?: (value: string) => void
  /** Native form name — handled via an internal hidden input. */
  name?: string
  /** Field id (attached to the trigger). */
  id?: string
  /** Placeholder when no value is selected. */
  placeholder?: string
  /** Validation/error state. */
  error?: boolean
  /** Disable the whole control. */
  disabled?: boolean
  /** Make the field required for native form validation. */
  required?: boolean
  /** Default variant has a border + surface bg; ghost is for inline
   *  table cells where the parent already provides the surface. */
  variant?: 'default' | 'ghost'
  /** Optional: provide options directly instead of via children. */
  options?: SelectOptionData[]
  /** Children as <option value="x">Label</option>. */
  children?: React.ReactNode
  /** Trigger className override. */
  className?: string
}

interface ParsedOption {
  value: string
  label: React.ReactNode
  disabled: boolean
}

// Radix Select forbids empty-string values on Items, but our codebase
// uses <option value=""> as an "All / unset" sentinel in filter rows.
// We translate '' ↔ EMPTY_SENTINEL internally so call sites can keep
// using the natural shape.
const EMPTY_SENTINEL = '__rs_empty__'

function toInternal(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return value === '' ? EMPTY_SENTINEL : value
}

function fromInternal(value: string): string {
  return value === EMPTY_SENTINEL ? '' : value
}

function parseOptions(
  children: React.ReactNode,
  optionsProp: SelectOptionData[] | undefined,
): ParsedOption[] {
  if (optionsProp && optionsProp.length > 0) {
    return optionsProp.map((o) => ({
      value: o.value === '' ? EMPTY_SENTINEL : o.value,
      label: o.label,
      disabled: o.disabled ?? false,
    }))
  }
  const out: ParsedOption[] = []
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    // Native <option>, OptGroup ignored (rare in HOA UI; can add later).
    if (child.type === 'option') {
      const props = child.props as {
        value?: string | number
        children?: React.ReactNode
        disabled?: boolean
      }
      if (props.value == null) return
      const raw = String(props.value)
      out.push({
        value: raw === '' ? EMPTY_SENTINEL : raw,
        label: props.children ?? raw,
        disabled: !!props.disabled,
      })
    }
  })
  return out
}

export function Select({
  value,
  defaultValue,
  onValueChange,
  name,
  id,
  placeholder,
  error,
  disabled,
  required,
  variant = 'default',
  options,
  children,
  className,
}: SelectProps) {
  const parsed = React.useMemo(
    () => parseOptions(children, options),
    [children, options],
  )

  // Controlled vs uncontrolled. We mirror internal state for the
  // hidden form input even when the parent controls value.
  const [internal, setInternal] = React.useState<string | undefined>(
    value ?? defaultValue,
  )
  const currentValue = value ?? internal

  function handleChange(next: string) {
    const emit = fromInternal(next)
    setInternal(emit)
    onValueChange?.(emit)
  }

  const radixValue = toInternal(value ?? internal)
  const radixDefault = toInternal(defaultValue)

  return (
    <RS.Root
      value={radixValue ?? EMPTY_SENTINEL}
      defaultValue={radixDefault}
      onValueChange={handleChange}
      disabled={disabled}
      required={required}
      name={name}
    >
      <RS.Trigger
        id={id}
        aria-invalid={error || undefined}
        className={cn(
          'group flex w-full min-h-10 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'data-[placeholder]:text-muted',
          variant === 'default'
            ? 'border-border bg-surface text-foreground hover:border-foreground/30'
            : 'border-transparent bg-transparent text-foreground hover:bg-muted/40',
          error && 'border-destructive focus:border-destructive focus:ring-destructive',
          className,
        )}
      >
        <RS.Value placeholder={placeholder ?? 'Select…'} />
        <RS.Icon asChild>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted transition-transform group-data-[state=open]:rotate-180" />
        </RS.Icon>
      </RS.Trigger>

      <RS.Portal>
        <RS.Content
          position="popper"
          sideOffset={6}
          align="start"
          className={cn(
            // Match the trigger width so the popup doesn't snap to its content width
            'z-50 min-w-[var(--radix-select-trigger-width)] max-h-[var(--radix-select-content-available-height)] overflow-hidden rounded-lg border border-border bg-surface text-foreground shadow-xl ring-1 ring-black/5',
            // Enter animations — match the rest of the design language
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1',
          )}
        >
          <RS.Viewport className="p-1">
            {parsed.map((opt) => (
              <RS.Item
                key={opt.value}
                value={opt.value}
                disabled={opt.disabled}
                className={cn(
                  'relative flex w-full cursor-pointer select-none items-center gap-2 rounded-md py-1.5 pl-2 pr-8 text-sm outline-none',
                  'data-[highlighted]:bg-primary/10 data-[highlighted]:text-foreground',
                  'data-[state=checked]:font-medium',
                  'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
                )}
              >
                <RS.ItemText>{opt.label}</RS.ItemText>
                <RS.ItemIndicator className="absolute right-2 inline-flex items-center">
                  <Check className="h-4 w-4 text-primary" aria-hidden />
                </RS.ItemIndicator>
              </RS.Item>
            ))}
          </RS.Viewport>
        </RS.Content>
      </RS.Portal>

      {/* Hidden input keeps Select compatible with <form action={...}>
          when a `name` is provided. Radix's own form integration uses
          the Root's name prop but we mirror it explicitly to be sure
          server actions see the value across all callers. */}
      {name ? (
        <input type="hidden" name={name} value={currentValue ?? ''} />
      ) : null}
    </RS.Root>
  )
}
