-- ─── 0030: digest preparation artifacts ─────────────────────────────
-- Vercel Hobby allows 2 cron jobs and 60s per function, and both slots are
-- taken. So the expensive half of the digest — scoring, chart rendering, and
-- the one Claude call — runs in the 09:30 UTC ingest cron and lands here; the
-- 11:00 UTC digest cron reads this row and only renders and sends.
--
-- UNLIKE screener_digest_sends, this table UPSERTS on its date key. That row
-- is a send ledger where a second write would mean a second email; this one is
-- a cache of work, and re-running preparation before anything is mailed is a
-- legitimate retry that should overwrite. Idempotent, no RLS, conventions
-- follow 0026.

CREATE TABLE IF NOT EXISTS public.screener_digest_prep (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prep_on      date NOT NULL,
  picks        jsonb,
  market_read  text,
  per_stock    jsonb,
  chart_count  integer NOT NULL DEFAULT 0,
  ai_ok        boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT screener_digest_prep_day_key UNIQUE (prep_on)
);

DROP TRIGGER IF EXISTS trg_screener_digest_prep_updated ON public.screener_digest_prep;
CREATE TRIGGER trg_screener_digest_prep_updated
  BEFORE UPDATE ON public.screener_digest_prep
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
