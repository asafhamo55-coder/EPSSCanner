-- 0026_screener.sql
-- Fundamental EPS Screener — core tables.
--
-- A single shared watchlist (free app, no auth / RLS / multi-tenancy).
-- Writes happen via the service-role client (the /api/ingest route and the
-- Inngest weekly cron); reads are server-side. RLS is intentionally NOT
-- enabled on these tables.
--
-- Conventions follow 0024_tickets.sql: uuid PKs, timestamptz defaults,
-- set_updated_at trigger, CHECK constraints, partial indexes. Idempotent —
-- safe to re-run.

-- Shared updated_at trigger fn (already exists in the base schema; redefine
-- defensively so this migration stands alone).
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ─── screener_tickers ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.screener_tickers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol      text NOT NULL,
  name        text,
  currency    text NOT NULL DEFAULT 'USD',
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  UNIQUE (symbol)
);

CREATE INDEX IF NOT EXISTS screener_tickers_active_idx
  ON public.screener_tickers(active, symbol)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_screener_tickers_updated ON public.screener_tickers;
CREATE TRIGGER trg_screener_tickers_updated
  BEFORE UPDATE ON public.screener_tickers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── screener_quarterly_eps ─────────────────────────────────────────
-- The persistent trend line: one row per ticker per fiscal quarter. Estimates
-- (is_forecast = true) are overwritten by actuals when earnings land. Upsert
-- target is (ticker_id, fiscal_period) so re-running ingest never duplicates.
CREATE TABLE IF NOT EXISTS public.screener_quarterly_eps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker_id        uuid NOT NULL REFERENCES public.screener_tickers(id) ON DELETE CASCADE,
  fiscal_period    text NOT NULL,            -- '2026Q1'
  period_end       date NOT NULL,
  eps_actual       numeric,
  eps_estimate     numeric,
  revenue_actual   numeric,
  revenue_estimate numeric,
  is_forecast      boolean NOT NULL DEFAULT false,
  source           text,
  fetched_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticker_id, fiscal_period)
);

CREATE INDEX IF NOT EXISTS screener_quarterly_eps_ticker_period_idx
  ON public.screener_quarterly_eps(ticker_id, period_end);

-- ─── screener_valuation_snapshots ───────────────────────────────────
-- Point-in-time price + TTM ratios for steps 1 and 5. One row per ticker per
-- as_of date; the dashboard reads the most recent.
CREATE TABLE IF NOT EXISTS public.screener_valuation_snapshots (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker_id            uuid NOT NULL REFERENCES public.screener_tickers(id) ON DELETE CASCADE,
  as_of                date NOT NULL,
  price                numeric,
  trailing_pe          numeric,
  forward_pe           numeric,
  net_margin_ttm       numeric,
  gross_margin_ttm     numeric,
  operating_margin_ttm numeric,
  roi_ttm              numeric,
  market_cap           numeric,
  source               text,
  fetched_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticker_id, as_of)
);

CREATE INDEX IF NOT EXISTS screener_valuation_ticker_asof_idx
  ON public.screener_valuation_snapshots(ticker_id, as_of DESC);

-- ─── screener_annual_financials ─────────────────────────────────────
-- Step 2's 5-year revenue / net-income trend.
CREATE TABLE IF NOT EXISTS public.screener_annual_financials (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker_id   uuid NOT NULL REFERENCES public.screener_tickers(id) ON DELETE CASCADE,
  fiscal_year int NOT NULL,
  revenue     numeric,
  net_income  numeric,
  source      text,
  UNIQUE (ticker_id, fiscal_year)
);

CREATE INDEX IF NOT EXISTS screener_annual_ticker_year_idx
  ON public.screener_annual_financials(ticker_id, fiscal_year);
