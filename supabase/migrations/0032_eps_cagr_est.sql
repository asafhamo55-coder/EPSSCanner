-- ─── 0032: Forward EPS CAGR estimate (fallback) ─────────────────────
-- Direct consensus-EPS-derived CAGR estimate, used as a fallback for
-- "EPS CAGR 5yr expected" only when peg_5yr (migration 0028) is
-- unavailable — see epsCagr5yr's call site in src/lib/digest.ts and
-- forwardEpsCagr in src/lib/derive.ts. Additive and idempotent.
ALTER TABLE public.screener_valuation_snapshots
  ADD COLUMN IF NOT EXISTS eps_cagr_5yr_est numeric;
