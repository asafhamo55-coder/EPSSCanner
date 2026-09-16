// Outbound email. One interface, two interchangeable transports, and a no-op
// fallback.
//
//   'resend' — Resend's REST API over fetch. Needs a VERIFIED SENDING DOMAIN;
//              Resend refuses to mail anyone but the account owner without one.
//   'smtp'   — any SMTP server, via nodemailer. Used here with Gmail, which
//              needs no domain at all: an app password on a normal Google
//              account is enough.
//
// Gmail is not merely the easier option, it is the BETTER one while the From
// address is a gmail.com address. `gmail.com` publishes
// `v=spf1 redirect=_spf.google.com`, so only Google's own servers are
// authorised to send as it. Relaying gmail.com mail through any third party
// (Resend, Brevo, SendGrid) fails SPF and leaves DKIM signed by the relay's
// domain rather than gmail.com, so DMARC alignment fails on both counts and
// receivers — Gmail above all — treat it with suspicion. Sending through
// Google means SPF passes, DKIM is signed by gmail.com, and alignment holds.
//
// Once a real sending domain exists, switch EMAIL_PROVIDER back to 'resend':
// a branded From with proper authentication beats a personal Gmail address,
// and nothing outside this file has to change.
//
// The no-op is load-bearing, not a convenience: with no credentials at all,
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
 * Resend transport. Batches are independent: one failing batch is recorded and
 * the rest still go out, because a partial digest reaching most of the list
 * beats none of it reaching any of it.
 */
async function sendViaResend(messages: EmailMessage[]): Promise<SendReport> {
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

// ─── SMTP transport (Gmail) ─────────────────────────────────────────
/** Pause between individual SMTP sends. nodemailer opens one connection per
 *  message here (no pooling — a serverless invocation is too short-lived for a
 *  pool to pay off), and Gmail throttles aggressive bursts. At a list size of
 *  tens this costs a second or two in total. */
const SMTP_PAUSE_MS = 250

/** Gmail rewrites the From header to the authenticated account unless the
 *  address is a verified alias on it, so a DIGEST_FROM naming some other
 *  mailbox would be silently replaced — the recipient sees an address the
 *  sender never chose. Detect that here and say so, rather than letting the
 *  mismatch be discovered in someone's inbox. Returns the address portion of
 *  an RFC 5322 `Name <addr>` string, or the string itself if it is bare. */
function addressOf(from: string): string {
  const m = /<([^>]+)>/.exec(from)
  return (m ? m[1] : from).trim().toLowerCase()
}

/**
 * SMTP transport. Unlike Resend's batch endpoint this sends one message per
 * call, so failures are per-recipient rather than per-batch — which is
 * strictly better reporting: one bad address cannot mask the rest.
 */
async function sendViaSmtp(messages: EmailMessage[]): Promise<SendReport> {
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASSWORD
  if (!user || !pass) {
    console.warn(
      `[email] SMTP_USER/SMTP_PASSWORD not set — not sending ${messages.length} message(s).`,
    )
    return {
      sent: 0,
      failed: messages.length,
      errors: ['SMTP_USER/SMTP_PASSWORD not set — send skipped'],
    }
  }

  // Imported lazily so the Resend path — and every build that never sends —
  // pays nothing for a dependency it does not use.
  const nodemailer = (await import('nodemailer')).default
  const host = process.env.SMTP_HOST || 'smtp.gmail.com'
  const port = Number(process.env.SMTP_PORT || 465)

  const report: SendReport = { sent: 0, failed: 0, errors: [] }

  const fromHeader = from()
  if (host.endsWith('gmail.com') && addressOf(fromHeader) !== user.trim().toLowerCase()) {
    report.errors.push(
      `DIGEST_FROM address (${addressOf(fromHeader)}) does not match SMTP_USER — Gmail will rewrite the From header to ${user}`,
    )
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
    auth: { user, pass },
  })

  try {
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      try {
        await transport.sendMail({
          from: fromHeader,
          to: m.to,
          subject: m.subject,
          html: m.html,
          text: m.text,
          headers: m.headers,
        })
        report.sent++
      } catch (e) {
        report.failed++
        // The recipient address is deliberately included: unlike the no-key
        // branch above (which would dump the entire list), this names only the
        // one address that actually failed, which is what makes a bounce or a
        // typo actionable.
        report.errors.push(`${m.to}: ${(e as Error).message}`)
      }
      if (i < messages.length - 1) await sleep(SMTP_PAUSE_MS)
    }
  } finally {
    transport.close()
  }

  return report
}

// ─── Transport selection ────────────────────────────────────────────
/** Which transport to use. Explicit `EMAIL_PROVIDER` wins; otherwise infer
 *  from whichever credentials are present, preferring SMTP because it is the
 *  one that works without a verified domain. Inference exists so a deploy that
 *  sets only the credentials still sends, rather than silently no-opping on a
 *  missing selector. */
function provider(): 'resend' | 'smtp' | 'none' {
  const explicit = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase()
  if (explicit === 'smtp' || explicit === 'resend') return explicit
  if (process.env.SMTP_USER && process.env.SMTP_PASSWORD) return 'smtp'
  if (process.env.RESEND_API_KEY) return 'resend'
  return 'none'
}

/**
 * Send every message through the configured transport.
 *
 * The contract every caller depends on: this NEVER throws. A transport error,
 * a bad address, absent credentials — all of it comes back as counts and
 * strings in the report. `/api/digest` relies on that to decide whether it may
 * release a claimed day, so a throw escaping here would turn a failed send
 * into a lost day.
 */
export async function sendEmails(messages: EmailMessage[]): Promise<SendReport> {
  if (messages.length === 0) return { sent: 0, failed: 0, errors: [] }

  switch (provider()) {
    case 'smtp':
      return sendViaSmtp(messages)
    case 'resend':
      return sendViaResend(messages)
    default:
      console.warn(
        `[email] no transport configured — not sending ${messages.length} message(s).`,
      )
      return {
        sent: 0,
        failed: messages.length,
        errors: ['no email transport configured — set SMTP_USER/SMTP_PASSWORD or RESEND_API_KEY'],
      }
  }
}
