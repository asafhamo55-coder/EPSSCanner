-- ─── 0028: PEG ratio (5-yr expected) ────────────────────────────────
-- Adds the 5-yr-expected PEG ratio to valuation snapshots. The dashboard's
-- "EPS CAGR 5yr expected" indicator = trailing_pe / peg_5yr. Additive and
-- idempotent — safe to re-run.
ALTER TABLE public.screener_valuation_snapshots
  ADD COLUMN IF NOT EXISTS peg_5yr numeric;
