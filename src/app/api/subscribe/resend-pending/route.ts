import { NextResponse, type NextRequest } from 'next/server'
import { renderConfirm } from '@/lib/email/confirm'
import { sendEmails, type EmailMessage } from '@/lib/email/send'
import { listPending } from '@/lib/subscribers'
import { siteUrl } from '@/lib/site'

// Re-send confirmation links to everyone stuck in 'pending'.
//
// Recovery for a delivery outage. Double opt-in means a subscriber who never
// receives the confirmation mail is stranded permanently: they are not
// 'confirmed', so no digest ever reaches them, and nothing in the normal flow
// retries. That is exactly what happened when the sending domain was
// unverified — people registered in good faith and heard nothing back.
//
// Deliberately NOT a cron target. This is a hand-run recovery tool, invoked
// once after the underlying delivery problem is fixed; running it on a timer
// would pester people who simply chose not to confirm.
//
// POST only. A GET would let a link-crawling mail gateway or a browser preload
// trigger a mass re-send, which is the same class of bug the confirm flow's
// POST interstitial exists to prevent.
export const maxDuration = 60

/** Fail closed, like /api/digest and unlike /api/ingest: this endpoint spends
 *  real send quota and mails real people, so an unset secret disables it
 *  rather than opening it. */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Refuse rather than silently no-op: sendEmails treats a missing key as
  // "log and return", which would report a clean run while mailing nobody —
  // the precise failure this route exists to recover from.
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ ok: false, error: 'RESEND_API_KEY is not set' }, { status: 503 })
  }

  try {
    const pending = await listPending()
    if (pending.length === 0) {
      return NextResponse.json({ ok: true, pending: 0, sent: 0, failed: 0, recipients: [] })
    }

    const origin = siteUrl()
    // Reuse each row's existing confirm_token rather than minting a new one:
    // any link already in flight stays valid, so a subscriber who eventually
    // finds the original mail in a spam folder is not sent to a dead link.
    const messages: EmailMessage[] = pending
      .filter((s) => s.confirmToken)
      .map((s) => {
        const confirmUrl = `${origin}/daily/confirm?token=${encodeURIComponent(s.confirmToken as string)}`
        const mail = renderConfirm({ firstName: s.firstName, confirmUrl })
        return { to: s.email, subject: mail.subject, html: mail.html, text: mail.text }
      })

    const report = await sendEmails(messages)
    if (report.failed > 0 || report.errors.length > 0) {
      console.error(
        `[resend-pending] ${report.failed}/${messages.length} failed: ${report.errors.join('; ')}`,
      )
    }

    return NextResponse.json({
      ok: report.failed === 0,
      pending: pending.length,
      attempted: messages.length,
      sent: report.sent,
      failed: report.failed,
      errors: report.errors,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 })
  }
}
