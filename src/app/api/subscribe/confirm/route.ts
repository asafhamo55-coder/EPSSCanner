import { NextResponse, type NextRequest } from 'next/server'
import { confirmSubscriber } from '@/lib/subscribers'
import { siteUrl } from '@/lib/site'

// Double opt-in confirmation.
//
// Corporate mail gateways (Defender Safe Links, Proofpoint, Mimecast) GET
// every URL in an incoming message before a human ever sees it. A GET here
// that mutated would let a scanner silently auto-confirm a signup with no
// person involved — defeating the entire reason double opt-in exists: proving
// a human, not a bot or a scanner, wants this address on the list.
//
// So the two verbs split asymmetrically:
//   GET  → never mutates. Redirects to the /daily/confirm interstitial page,
//          which requires a real click (a POST) before anything happens.
//   POST → the only path that touches the database.
//
// Contrast with /api/subscribe/unsubscribe, which deliberately keeps GET
// mutating — see that route for why the two are not symmetric.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const url = new URL('/daily/confirm', siteUrl())
  if (token) url.searchParams.set('token', token)
  return NextResponse.redirect(url)
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null)
  const token = form?.get('token')
  if (typeof token !== 'string' || !token) {
    return NextResponse.redirect(`${siteUrl()}/daily?confirmed=0`, { status: 303 })
  }
  // Log the outcome and a token prefix at most — never an email address. This
  // is the confirmation-side half of the visibility this feature needs: a
  // mass auto-unsubscribe (or, here, a mass failed/rejected confirm) should
  // show up somewhere.
  try {
    const ok = await confirmSubscriber(token)
    console.info(`[subscribe] confirm ${ok ? 'succeeded' : 'failed'} for token ${token.slice(0, 8)}…`)
    return NextResponse.redirect(`${siteUrl()}/daily?confirmed=${ok ? '1' : '0'}`, { status: 303 })
  } catch (e) {
    console.error(`[subscribe] confirm error for token ${token.slice(0, 8)}…:`, e)
    return NextResponse.redirect(`${siteUrl()}/daily?confirmed=0`, { status: 303 })
  }
}
