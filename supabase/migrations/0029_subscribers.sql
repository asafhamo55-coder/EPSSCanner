-- ─── 0029: Daily Maily subscribers ──────────────────────────────────
-- Subscribers to the 06:00 ET daily digest, plus a per-day send ledger.
--
-- Double opt-in: a row is created 'pending' and only becomes 'confirmed' when
-- the recipient clicks the link, so an address someone else typed never
-- receives mail. No RLS — all access is server-side through the service-role
-- client, matching 0026. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.screener_subscribers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL,
  first_name         text NOT NULL,
  last_name          text NOT NULL,
  status             text NOT NULL DEFAULT 'pending',
  confirm_token      text,
  unsubscribe_token  text NOT NULL,
  confirmed_at       timestamptz,
  unsubscribed_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT screener_subscribers_email_key UNIQUE (email),
  CONSTRAINT screener_subscribers_unsub_key UNIQUE (unsubscribe_token),
  CONSTRAINT screener_subscribers_confirm_key UNIQUE (confirm_token),
  CONSTRAINT screener_subscribers_status_chk
    CHECK (status IN ('pending', 'confirmed', 'unsubscribed'))
);

-- The send query's only filter, so it gets a partial index rather than a
-- full one over a column that is 'confirmed' for nearly every row that matters.
CREATE INDEX IF NOT EXISTS screener_subscribers_confirmed_idx
  ON public.screener_subscribers(email)
  WHERE status = 'confirmed';

DROP TRIGGER IF EXISTS trg_screener_subscribers_updated ON public.screener_subscribers;
CREATE TRIGGER trg_screener_subscribers_updated
  BEFORE UPDATE ON public.screener_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── screener_digest_sends ──────────────────────────────────────────
-- One row per Eastern calendar day. The UNIQUE on sent_on is the whole point:
-- the digest route inserts this row BEFORE any mail goes out, so a retried,
-- delayed or double-fired cron hits a unique violation and exits instead of
-- mailing the list twice.
CREATE TABLE IF NOT EXISTS public.screener_digest_sends (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_on          date NOT NULL,
  recipient_count  integer NOT NULL DEFAULT 0,
  pick_count       integer NOT NULL DEFAULT 0,
  picks            jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT screener_digest_sends_day_key UNIQUE (sent_on)
);
