import { NextResponse, type NextRequest } from 'next/server'
import { confirmSubscriber } from '@/lib/subscribers'
import { siteUrl } from '@/lib/site'

// Double opt-in landing. An unknown or already-used token is not an error the
// recipient can act on, so it redirects to the same page with a different flag
// rather than rendering a stack trace at someone who clicked a link twice.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.redirect(`${siteUrl()}/daily?confirmed=0`)
  try {
    const ok = await confirmSubscriber(token)
    return NextResponse.redirect(`${siteUrl()}/daily?confirmed=${ok ? '1' : '0'}`)
  } catch {
    return NextResponse.redirect(`${siteUrl()}/daily?confirmed=0`)
  }
}
