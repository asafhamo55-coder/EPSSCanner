// Every read and write against screener_subscribers / screener_digest_sends.
// Routes and server actions call these and hold no Supabase knowledge of their
// own, the way src/lib/queries.ts works for the watchlist.

import { db } from './db'

export type SubscriberStatus = 'pending' | 'confirmed' | 'unsubscribed'

export interface Subscriber {
  id: string
  email: string
  firstName: string
  lastName: string
  status: SubscriberStatus
  confirmToken: string | null
  unsubscribeToken: string
}

type Row = Record<string, unknown>

function toSubscriber(r: Row): Subscriber {
  return {
    id: r.id as string,
    email: r.email as string,
    firstName: r.first_name as string,
    lastName: r.last_name as string,
    status: r.status as SubscriberStatus,
    confirmToken: (r.confirm_token as string | null) ?? null,
    unsubscribeToken: r.unsubscribe_token as string,
  }
}

/** Postgres unique-violation. Surfaced by supabase-js in `error.code`. */
const UNIQUE_VIOLATION = '23505'

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export type UpsertOutcome = 'created' | 'resent' | 'reactivated' | 'already-confirmed'
export interface UpsertResult {
  outcome: UpsertOutcome
  subscriber: Subscriber
}

/**
 * Register or re-register an address.
 *
 *   no row          → created, pending, fresh confirm token
 *   pending row     → resent, fresh confirm token (the old link may be lost)
 *   unsubscribed    → reactivated back to pending, fresh confirm token
 *   confirmed row   → already-confirmed; the row is NOT touched. Re-confirming
 *                     someone who is already on the list would let a stranger
 *                     knock them off it by submitting their address.
 *
 * The name is refreshed on every path except already-confirmed, so a typo the
 * subscriber corrects on a second attempt takes effect.
 */
export async function upsertSubscriber(input: {
  email: string
  firstName: string
  lastName: string
}): Promise<UpsertResult> {
  const supabase = db()
  const email = normalizeEmail(input.email)

  const { data: existing, error: readErr } = await supabase
    .from('screener_subscribers')
    .select('*')
    .eq('email', email)
    .maybeSingle()
  if (readErr) throw new Error(readErr.message)

  if (existing) {
    const current = toSubscriber(existing as Row)
    if (current.status === 'confirmed') {
      return { outcome: 'already-confirmed', subscriber: current }
    }
    const confirmToken = crypto.randomUUID()
    const { data, error } = await supabase
      .from('screener_subscribers')
      .update({
        first_name: input.firstName,
        last_name: input.lastName,
        status: 'pending',
        confirm_token: confirmToken,
        unsubscribed_at: null,
      })
      .eq('id', current.id)
      .select('*')
      .single()
    if (error) throw new Error(error.message)
    return {
      outcome: current.status === 'unsubscribed' ? 'reactivated' : 'resent',
      subscriber: toSubscriber(data as Row),
    }
  }

  const { data, error } = await supabase
    .from('screener_subscribers')
    .insert({
      email,
      first_name: input.firstName,
      last_name: input.lastName,
      status: 'pending',
      confirm_token: crypto.randomUUID(),
      unsubscribe_token: crypto.randomUUID(),
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return { outcome: 'created', subscriber: toSubscriber(data as Row) }
}

/** Token → confirmed. Returns false for an unknown or already-used token; the
 *  caller shows a friendly page rather than an error either way. */
export async function confirmSubscriber(token: string): Promise<boolean> {
  const supabase = db()
  const { data, error } = await supabase
    .from('screener_subscribers')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      confirm_token: null,
    })
    .eq('confirm_token', token)
    .select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

/** Token → unsubscribed. The token stays valid so a second click (Gmail's
 *  native control posts as well as gets) is a harmless no-op that still
 *  reports success. */
export async function unsubscribeByToken(token: string): Promise<boolean> {
  const supabase = db()
  const { data, error } = await supabase
    .from('screener_subscribers')
    .update({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString() })
    .eq('unsubscribe_token', token)
    .select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

export async function listConfirmed(): Promise<Subscriber[]> {
  const supabase = db()
  const { data, error } = await supabase
    .from('screener_subscribers')
    .select('*')
    .eq('status', 'confirmed')
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => toSubscriber(r as Row))
}

/**
 * Claim today's send. Inserting BEFORE any mail goes out is what makes the
 * whole pipeline idempotent: the UNIQUE on sent_on means a second invocation
 * for the same Eastern day loses the race and gets null back, so a retried or
 * double-fired cron cannot mail the list twice.
 */
export async function claimDigestDay(sentOn: string): Promise<string | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('screener_digest_sends')
    .insert({ sent_on: sentOn })
    .select('id')
    .single()
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return null
    throw new Error(error.message)
  }
  return (data as Row).id as string
}

export async function recordDigestSend(
  id: string,
  recipientCount: number,
  pickCount: number,
  picks: unknown,
): Promise<void> {
  const supabase = db()
  const { error } = await supabase
    .from('screener_digest_sends')
    .update({ recipient_count: recipientCount, pick_count: pickCount, picks })
    .eq('id', id)
  if (error) throw new Error(error.message)
}
