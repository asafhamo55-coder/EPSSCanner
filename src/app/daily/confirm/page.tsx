import { Mail } from 'lucide-react'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from '@/ui'

// The double opt-in interstitial. GET /api/subscribe/confirm redirects here
// instead of confirming directly, specifically so a link-scanning mail
// gateway (Defender Safe Links, Proofpoint, Mimecast) that GETs this page
// cannot auto-confirm anyone — only the POST below, which requires an actual
// click, touches the database.
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams

  return (
    <div className="space-y-6">
      <PageHeader
        title="Confirm your subscription"
        description="One click and the TripleQ Daily Maily starts arriving at 6:00 AM Eastern, every morning before the open."
      />
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            One click to go
          </CardTitle>
          <CardDescription>
            {token
              ? "Confirm your address and you're on the list — the watchlist names that cleared our entry gate, ranked by the TripleQ Score."
              : 'This confirmation link is missing its token — sign up again from the Daily Maily tab and we’ll send a fresh one.'}
          </CardDescription>
        </CardHeader>
        {token ? (
          <CardContent>
            <form action="/api/subscribe/confirm" method="POST">
              <input type="hidden" name="token" value={token} />
              <Button type="submit">Confirm my subscription</Button>
            </form>
          </CardContent>
        ) : null}
      </Card>
    </div>
  )
}
