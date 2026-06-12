import { createClient } from '@supabase/supabase-js'

// Service-role Supabase client for the screener. The screener_* tables live in
// the same Postgres but aren't in the generated database.types.ts (separate
// product surface), so we use the schema-less client and type results at the
// call site. No RLS — this is a free, single shared watchlist; all access is
// server-side (route handlers, server actions, server components).
export function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the screener DB client.',
    )
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
