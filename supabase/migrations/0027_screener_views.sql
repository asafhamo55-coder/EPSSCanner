-- 0027_screener_views.sql
-- Derived metrics for the EPS screener, computed on read via window functions
-- so the quarterly table stays the single source of truth for the trend line.
-- YoY uses LAG(eps, 4); QoQ uses LAG(eps, 1) over period_end. The QoQ-slope
-- label (accelerating / flat / decelerating) is computed in the app's
-- src/lib/signals.ts so the regression window N stays a config value.
--
-- Idempotent (CREATE OR REPLACE). No RLS — free, single shared watchlist.

-- ─── screener_eps_growth ────────────────────────────────────────────
-- One row per actual quarter with YoY ratio + QoQ delta + turnaround flag.
CREATE OR REPLACE VIEW public.screener_eps_growth AS
SELECT
  ticker_id,
  fiscal_period,
  period_end,
  eps_actual,
  LAG(eps_actual, 4) OVER w AS eps_year_ago,
  LAG(eps_actual, 1) OVER w AS eps_prev_q,
  CASE
    WHEN LAG(eps_actual, 4) OVER w IS NULL THEN NULL
    WHEN LAG(eps_actual, 4) OVER w = 0 THEN NULL
    ELSE eps_actual / LAG(eps_actual, 4) OVER w
  END AS yoy_ratio,
  eps_actual - LAG(eps_actual, 1) OVER w AS qoq_delta,
  -- Turnaround: sign flip vs the year-ago quarter makes the ratio meaningless.
  CASE
    WHEN LAG(eps_actual, 4) OVER w IS NULL THEN NULL
    WHEN sign(eps_actual) <> sign(LAG(eps_actual, 4) OVER w) THEN true
    ELSE false
  END AS yoy_sign_change
FROM public.screener_quarterly_eps
WHERE NOT is_forecast
WINDOW w AS (PARTITION BY ticker_id ORDER BY period_end);

-- ─── screener_latest_valuation ──────────────────────────────────────
-- Most recent valuation snapshot per ticker (DISTINCT ON by as_of DESC).
CREATE OR REPLACE VIEW public.screener_latest_valuation AS
SELECT DISTINCT ON (ticker_id)
  ticker_id, as_of, price, trailing_pe, forward_pe,
  net_margin_ttm, gross_margin_ttm, operating_margin_ttm, roi_ttm, market_cap
FROM public.screener_valuation_snapshots
ORDER BY ticker_id, as_of DESC;

-- ─── screener_annual_trend ──────────────────────────────────────────
-- Per-ticker step-2 booleans: are revenue and net income strictly increasing
-- across the available fiscal years? NULL when fewer than 2 years on file.
CREATE OR REPLACE VIEW public.screener_annual_trend AS
WITH ranked AS (
  SELECT
    ticker_id, fiscal_year, revenue, net_income,
    LAG(revenue) OVER w    AS prev_rev,
    LAG(net_income) OVER w AS prev_ni
  FROM public.screener_annual_financials
  WINDOW w AS (PARTITION BY ticker_id ORDER BY fiscal_year)
)
SELECT
  ticker_id,
  count(*)                                                  AS years_on_file,
  bool_and(prev_rev IS NULL OR revenue > prev_rev)          AS revenue_growing,
  bool_and(prev_ni  IS NULL OR net_income > prev_ni)        AS net_income_growing
FROM ranked
GROUP BY ticker_id;

-- ─── screener_latest_eps_growth ─────────────────────────────────────
-- Just the most recent actual quarter's growth row per ticker — the dashboard
-- scorecard's YoY signal source.
CREATE OR REPLACE VIEW public.screener_latest_eps_growth AS
SELECT DISTINCT ON (ticker_id)
  ticker_id, fiscal_period, period_end, eps_actual,
  eps_year_ago, eps_prev_q, yoy_ratio, qoq_delta, yoy_sign_change
FROM public.screener_eps_growth
ORDER BY ticker_id, period_end DESC;
