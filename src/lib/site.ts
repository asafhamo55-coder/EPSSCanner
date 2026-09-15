/** Absolute origin for links that leave the app (emails). Never has a trailing
 *  slash. `NEXT_PUBLIC_SITE_URL` is the explicit setting; `VERCEL_PROJECT_
 *  PRODUCTION_URL` is Vercel's stable production hostname, which beats
 *  `VERCEL_URL` because that one changes with every deployment and a link in a
 *  sent email must outlive the deploy that sent it. */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/+$/, '')
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (vercel) return `https://${vercel}`
  return 'http://localhost:3000'
}
