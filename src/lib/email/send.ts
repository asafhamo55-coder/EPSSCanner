// Outbound email. One interface, one implementation (Resend's REST API via
// fetch — no SDK, no dependency), and a no-op fallback.
//
// The no-op is load-bearing, not a convenience: without RESEND_API_KEY set,
// `pnpm dev`, `pnpm build` and any mock-mode deploy would otherwise be one
// stray cron hit away from mailing real people. Absent credentials mean
// "log what you would have sent", never "send it".

export const DEFAULT_FROM = 'TripleQ Group <daily@tripleqgroup.com>'

/** Resend accepts at most 100 messages per batch call. */
const BATCH_SIZE = 100
/** Pause between batches. Resend's default account limit is 2 requests/second;
 *  600ms keeps us comfortably under it without serialising the whole send. */
const BATCH_PAUSE_MS = 600

const ENDPOINT = 'https://api.resend.com/emails/batch'

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
  headers?: Record<string, string>
}

export interface SendReport {
  sent: number
  failed: number
  errors: string[]
}

function from(): string {
  return process.env.DIGEST_FROM || DEFAULT_FROM
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Send every message. Batches are independent: one failing batch is recorded
 * and the rest still go out, because a partial digest reaching most of the
 * list beats none of it reaching any of it.
 */
export async function sendEmails(messages: EmailMessage[]): Promise<SendReport> {
  if (messages.length === 0) return { sent: 0, failed: 0, errors: [] }

  const key = process.env.RESEND_API_KEY
  if (!key) {
    console.warn(
      `[email] RESEND_API_KEY is not set — not sending ${messages.length} message(s). ` +
        `Recipients would have been: ${messages.map((m) => m.to).join(', ')}`,
    )
    return { sent: 0, failed: 0, errors: ['RESEND_API_KEY not set — send skipped'] }
  }

  const report: SendReport = { sent: 0, failed: 0, errors: [] }
  const batches = chunk(messages, BATCH_SIZE)

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          batch.map((m) => ({
            from: from(),
            to: [m.to],
            subject: m.subject,
            html: m.html,
            text: m.text,
            ...(m.headers ? { headers: m.headers } : {}),
          })),
        ),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        report.failed += batch.length
        report.errors.push(`batch ${i + 1}: HTTP ${res.status} ${body.slice(0, 300)}`)
      } else {
        report.sent += batch.length
      }
    } catch (e) {
      report.failed += batch.length
      report.errors.push(`batch ${i + 1}: ${(e as Error).message}`)
    }
    if (i < batches.length - 1) await sleep(BATCH_PAUSE_MS)
  }

  return report
}
