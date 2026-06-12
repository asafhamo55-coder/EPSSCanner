// Display formatters for the scorecard + charts.

export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)}%`
}

export function ratio(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v.toFixed(digits)}×`
}

export function num(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toFixed(digits)
}

export function usd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function marginPct(v: number | null | undefined): string {
  // Margins are stored as fractions (0.55 = 55%).
  if (v == null || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(1)}%`
}

export function bigUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  return usd(v)
}
