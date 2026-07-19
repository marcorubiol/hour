-- ADR-084 §1 — multi-day blocks in the Planner.
--
-- A week of rehearsals is N `date` rows, ONE PER DAY, sharing a series_id.
-- It is deliberately NOT one row with a range, even though `date.ends_at`
-- exists: per-day rows are the whole point, because each day keeps its own
-- hours AND its own status. "Propose five weeks, confirm two" is a sentence
-- a single spanning row cannot say (Marco, 2026-07-19).
--
-- `ends_at` keeps its own job: the end time WITHIN a day.
--
-- The Planner renders consecutive rows of one series as a single band, each
-- day printing its own time range — the block is a rendering of the rows,
-- never a separate entity. Nothing to keep in sync, nothing to expire.
--
-- No FK and no `date_series` table on purpose: the series has no attributes
-- of its own (its label is the rows' title), so the shared key IS the whole
-- concept. Rows of a series are written together by the app.
--
-- Additive and reversible: NULL series_id = a standalone date, which is what
-- every existing row is. Nothing to backfill.

ALTER TABLE public.date
  ADD COLUMN IF NOT EXISTS series_id uuid;

CREATE INDEX IF NOT EXISTS date_series_idx
  ON public.date (series_id)
  WHERE deleted_at IS NULL AND series_id IS NOT NULL;

COMMENT ON COLUMN public.date.series_id IS
  'Groups the per-day rows of one multi-day block (e.g. a week of rehearsals). NULL = standalone date. Deliberately not an FK: the series has no row of its own, the shared key is the concept.';
