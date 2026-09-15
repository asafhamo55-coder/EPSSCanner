import { Inbox } from 'lucide-react'
import { Badge, Card, CardContent, EmptyState } from '@/ui'
import { bigUsd, num, pct, usd } from '@/lib/format'
import { MIN_SCORE, type ScoredPick, type Selection } from '@/lib/score'

function FactorBar({ label, detail, points, max }: { label: string; detail: string; points: number; max: number }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (points / max) * 100)) : 0
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="text-xs tabular-nums text-muted">
          {points.toFixed(1)}/{max}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted/20">
        <div className="h-1.5 rounded-full bg-gradient-brand" style={{ width: `${w}%` }} />
      </div>
      <p className="text-[11px] text-muted">{detail}</p>
    </div>
  )
}

function PickCard({ pick, rank }: { pick: ScoredPick; rank: number }) {
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-brand text-xs font-bold text-white">
                {rank}
              </span>
              <span className="truncate text-base font-bold text-foreground">{pick.symbol}</span>
            </div>
            <p className="mt-1 truncate text-xs text-muted">{pick.name}</p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-2xl font-bold tabular-nums text-gradient-brand">
              {pick.score.toFixed(1)}
            </div>
            <div className="text-[11px] text-muted">/ 100</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant={(pick.yoyPct ?? 0) > 0 ? 'success' : 'destructive'}>
            YoY {pct(pick.yoyPct, 0)}
          </Badge>
          <Badge variant={(pick.ntmPct ?? 0) > 0 ? 'success' : 'destructive'}>
            NTM {pct(pick.ntmPct, 0)}
          </Badge>
          <Badge variant={(pick.epsCagr5yr ?? 0) > 0 ? 'success' : 'destructive'}>
            CAGR 5y {pct(pick.epsCagr5yr, 0)}
          </Badge>
          <Badge variant="neutral">{bigUsd(pick.marketCap)}</Badge>
          <Badge variant="neutral">{usd(pick.price)}</Badge>
          <Badge variant="neutral">P/E {num(pick.trailingPe, 1)}</Badge>
        </div>

        <div className="space-y-3">
          {pick.factors.map((f) => (
            <FactorBar key={f.key} label={f.label} detail={f.detail} points={f.points} max={f.max} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function DigestPreview({ selection }: { selection: Selection }) {
  if (selection.picks.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-8 w-8" />}
        title="Nothing cleared the bar today"
        description={`Of ${selection.considered} watchlist names, none both passed every entry gate and scored at least ${MIN_SCORE}/100. A short list is honest; a padded one is not.`}
      />
    )
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {selection.picks.length} of {selection.considered} watchlist names cleared the entry gate and
        scored {MIN_SCORE} or better
        {selection.gated > 0 ? `; ${selection.gated} more passed the gate but fell short on score` : ''}.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {selection.picks.map((p, i) => (
          <PickCard key={p.symbol} pick={p} rank={i + 1} />
        ))}
      </div>
    </div>
  )
}
