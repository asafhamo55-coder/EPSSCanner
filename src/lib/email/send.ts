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
    // Log the COUNT, never the addresses — this branch is exactly the
    // misconfiguration (no RESEND_API_KEY) that would otherwise dump the
    // full confirmed-subscriber list into Vercel logs on every digest run.
    console.warn(`[email] RESEND_API_KEY is not set — not sending ${messages.length} message(s).`)
    // `failed`, not `sent: 0, failed: 0`: the caller's only alarm is
    // `report.failed > 0` (and now `report.errors.length > 0`), so reporting
    // zero failures here would say nothing went wrong when nothing went out.
    return {
      sent: 0,
      failed: messages.length,
      errors: ['RESEND_API_KEY not set — send skipped'],
    }
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
        // HTTP 200 does not mean every message in the batch actually sent —
        // Resend's batch endpoint returns {"data":[{"id":...},...]}, one entry
        // per message that went out. Count that array when the body parses as
        // one, and treat a shortfall (data.length < batch.length) as partial
        // failures — `report.failed` is the route's only alarm, so silently
        // counting a partial batch as fully sent would be the exact class of
        // silent-data-loss bug this whole comment is about. Only fall back to
        // assuming the whole batch succeeded when the body is UNPARSEABLE —
        // and even then, push a warning into `errors` so the alarm still
        // fires rather than the count just quietly lying.
        const text = await res.text().catch(() => '')
        let parsed: unknown
        let dataLen: number | null = null
        try {
          parsed = JSON.parse(text)
          if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)) {
            dataLen = (parsed as { data: unknown[] }).data.length
          }
        } catch {
          parsed = undefined
        }
        if (dataLen != null) {
          report.sent += dataLen
          if (dataLen < batch.length) {
            const shortfall = batch.length - dataLen
            report.failed += shortfall
            report.errors.push(
              `batch ${i + 1}: HTTP 200 but data.length (${dataLen}) < batch size (${batch.length}) — ${shortfall} message(s) presumed unsent`,
            )
          }
        } else {
          // Body didn't parse as JSON, or parsed but had no `data` array —
          // either way the shape isn't the one we know how to trust, so this
          // is treated as unparseable: fall back to assuming the batch sent,
          // but flag it so it isn't a silent assumption.
          report.sent += batch.length
          report.errors.push(
            `batch ${i + 1}: HTTP 200 with an unparseable/unexpected body — assumed all ${batch.length} sent`,
          )
        }
      }
    } catch (e) {
      report.failed += batch.length
      report.errors.push(`batch ${i + 1}: ${(e as Error).message}`)
    }
    if (i < batches.length - 1) await sleep(BATCH_PAUSE_MS)
  }

  return report
}
