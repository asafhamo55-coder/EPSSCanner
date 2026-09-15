import { NextResponse, type NextRequest } from 'next/server'
import { unsubscribeByToken } from '@/lib/subscribers'
import { siteUrl } from '@/lib/site'

async function run(token: string | null): Promise<boolean> {
  if (!token) return false
  try {
    return await unsubscribeByToken(token)
  } catch {
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
