// The double opt-in confirmation email. Deliberately plain: one sentence and
// one button. Nothing about the digest's content goes out before the address
// is confirmed.

import { escapeHtml, FONT, PALETTE, shell } from './primitives'

export function renderConfirm(data: { firstName: string; confirmUrl: string }): {
  subject: string
  html: string
  text: string
} {
  const subject = 'Confirm your TripleQ Daily Maily subscription'
  const body = `
<tr><td style="padding:0 0 18px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.brandDeep};border-radius:14px;">
    <tr><td style="padding:22px 24px;font:700 19px ${FONT};color:#ffffff;">✉️ One click to go</td></tr>
  </table>
</td></tr>
<tr><td style="padding:0 2px 18px 2px;font:400 14px ${FONT};color:${PALETTE.body};line-height:1.7;">
  Hi ${escapeHtml(data.firstName)}, confirm your address and the TripleQ Daily Maily will land in
  your inbox at 6:00 AM Eastern every morning — the watchlist names that cleared our entry gate,
  ranked by the TripleQ Score.<br><br>
  <a href="${escapeHtml(data.confirmUrl)}" style="display:inline-block;background:${PALETTE.brand};color:#ffffff;font:700 14px ${FONT};text-decoration:none;padding:12px 22px;border-radius:10px;">Confirm my subscription</a><br><br>
  <span style="font:400 12px ${FONT};color:${PALETTE.muted};">If you did not request this, ignore this email — nothing will be sent.</span>
</td></tr>`
  const text = [
    `Hi ${data.firstName},`,
    ``,
    `Confirm your TripleQ Daily Maily subscription:`,
    data.confirmUrl,
    ``,
    `If you did not request this, ignore this email — nothing will be sent.`,
    ``,
    `Fundamental signals only — not investment advice.`,
    ``,
    `TripleQ Group`,
  ].join('\n')
  return {
    subject,
    html: shell({
      title: subject,
      preheader: 'Confirm your address to start receiving the 6 AM digest.',
      bodyHtml: body,
      footerLinksHtml: 'You received this because someone entered this address on our signup form.',
    }),
    text,
  }
}
