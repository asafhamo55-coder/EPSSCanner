'use client'

import { useState, useTransition } from 'react'
import { Mail } from 'lucide-react'
import { Button, Input, useToast } from '@/ui'
import { subscribeAction } from '@/app/actions'

// Signup for the 6 AM ET digest. Double opt-in, so a successful submit means
// "we sent you a link", never "you are subscribed".
export function SubscribeForm() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [pending, startTransition] = useTransition()
  const toast = useToast()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const res = await subscribeAction({ firstName, lastName, email })
      if (res.ok) {
        toast({ message: res.message ?? 'Check your inbox.', tone: 'success' })
        setFirstName('')
        setLastName('')
        setEmail('')
      } else {
        toast({ message: res.error ?? 'Could not subscribe.', tone: 'error' })
      }
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder="First name"
          aria-label="First name"
          maxLength={60}
          required
          disabled={pending}
        />
        <Input
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder="Last name"
          aria-label="Last name"
          maxLength={60}
          required
          disabled={pending}
        />
      </div>
      <Input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        aria-label="Email address"
        maxLength={254}
        required
        disabled={pending}
      />
      <Button type="submit" loading={pending} className="w-full sm:w-auto">
        <Mail className="h-4 w-4" />
        Send me the Daily Maily
      </Button>
      <p className="text-xs text-muted">
        We send one email a day at 6:00 AM Eastern and nothing else. Unsubscribe from any of them.
      </p>
    </form>
  )
}
