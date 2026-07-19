-- ADR-084 §3 — the readiness checklist on a gig's month card.
--
-- "Hotel sorted", "tech sorted" is a JUDGEMENT the operator makes. It is not
-- a consequence of some text existing in the logistics/technical jsonb — a
-- derived tick would lie in both directions (a note reading "hotel: pendent"
-- would render as done). So the ticks are explicit and operator-owned.
--
-- ONE jsonb rather than a column per item: the checklist will grow (visa,
-- transport, contract) and a new item must not cost a migration. The KEY
-- VOCABULARY lives app-side in $lib/performance.ts, exactly the way the
-- status vocabulary does — schema holds the shape, the app holds the words.
--
-- Distinct from `logistics` / `hospitality` / `technical`, which hold the
-- CONTENT (access codes, riders, per-diems). This column holds only the
-- "is it sorted?" answer.
--
-- Shape: { "hotel": true, "technical": false } — an absent key = not ticked.

ALTER TABLE public.performance
  ADD COLUMN IF NOT EXISTS readiness jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.performance
  DROP CONSTRAINT IF EXISTS performance_readiness_is_object;

ALTER TABLE public.performance
  ADD CONSTRAINT performance_readiness_is_object
  CHECK (jsonb_typeof(readiness) = 'object');

COMMENT ON COLUMN public.performance.readiness IS
  'Operator-ticked readiness checklist shown on the gig card (hotel, technical, …). Key vocabulary lives app-side; absent key = not ticked. Holds the answer, not the content — the content stays in logistics/hospitality/technical.';
