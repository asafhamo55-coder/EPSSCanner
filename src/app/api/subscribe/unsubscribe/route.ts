import { NextResponse, type NextRequest } from 'next/server'
import { unsubscribeByToken } from '@/lib/subscribers'
import { siteUrl } from '@/lib/site'

// Deliberately asymmetric with /api/subscribe/confirm: this GET keeps
// mutating. A link-scanner unsubscribing someone is annoying, not a security
// failure (unlike auto-confirming a signup nobody asked for), and breaking
// RFC 8058 one-click unsubscribe hurts deliverability more than the crawl
// costs. Logged either way — a mass auto-unsubscribe should be visible even
// though it isn't blocked.
async function run(token: string | null): Promise<boolean> {
  if (!token) return false
  try {
    const ok = await unsubscribeByToken(token)
    console.info(`[subscribe] unsubscribe ${ok ? 'succeeded' : 'failed'} for token ${token.slice(0, 8)}…`)
    return ok
  } catch (e) {
    console.error(`[subscribe] unsubscribe error for token ${token.slice(0, 8)}…:`, e)
    return false
  }
}

export async function GET(req: NextRequest) {
  const ok = await run(req.nextUrl.searchParams.get('token'))
  return NextResponse.redirect(`${siteUrl()}/daily?unsubscribed=${ok ? '1' : '0'}`)
}

// Gmail's native unsubscribe control POSTs rather than following the link
// (RFC 8058), and expects a plain 200 — not a redirect it cannot follow.
export async function POST(req: NextRequest) {
  await run(req.nextUrl.searchParams.get('token'))
  return new NextResponse(null, { status: 200 })
}
