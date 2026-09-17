-- ─── 0031: digest prep — watchlist counts ───────────────────────────
-- 0030 persists the prepared picks, chart count and AI commentary but not
-- `considered`/`belowCutoff` (see Selection in src/lib/score.ts) — the
-- watchlist-wide counts the digest email's header uses for "N of M
-- watchlist names cleared the entry gate...; K more passed the gate but
-- fell short on score." Without them, the digest route's prepared-row path
-- (Task 7) has no denominator to report and the header collapses to a
-- shorter sentence.
--
-- Additive to 0030, not folded into it: 0030 may already be applied to the
-- live database, so this migration only ADDs columns rather than editing
-- 0030's CREATE TABLE. Nullable, not NOT NULL DEFAULT 0 — a 0 would be
-- indistinguishable from "nothing considered", a false claim, whereas every
-- row written before this migration genuinely has no value here (the
-- upsert in prepareDigest() didn't populate these columns yet) and NULL
-- says exactly that. src/lib/digest.ts's readPrep() and the digest route's
-- header copy both already treat a null considered/belowCutoff as "unknown"
-- rather than "zero" for this reason. Idempotent, no RLS, conventions
-- follow 0026/0030.

ALTER TABLE public.screener_digest_prep
  ADD COLUMN IF NOT EXISTS considered   integer,
  ADD COLUMN IF NOT EXISTS below_cutoff integer;
