-- ADR-002 (§hold semantics) finally implemented — the knob was decided when
-- the status enum was designed and never built, so the UI printed ranked
-- holds ("1st hold") at every workspace including theatre companies that do
-- not run a priority queue (found 2026-07-20).
--
-- Two conventions, one enum, and this setting picks which one the UI speaks:
--   simple       theatre/dance — holds are unranked; two coexist on a slot
--                until one resolves. hold_1/2/3 all read as "hold".
--   prioritized  music — hold 1 has first right to convert; 2 promotes when
--                1 releases. The rank is shown.
--
-- No new column: `workspace.settings jsonb` exists for exactly this — knobs
-- the code reads. (Contrast `custom_fields`, which is user data the system
-- does not interpret; the two columns are separate on purpose.) What was
-- missing is the guard: a free-form jsonb would happily store a typo, and a
-- misspelled mode silently falls back to `simple` forever.
--
-- Absent key = simple. A company that never said otherwise is not running a
-- priority queue, so the safe default is the one that invents no hierarchy.

ALTER TABLE public.workspace
  DROP CONSTRAINT IF EXISTS workspace_booking_mode_valid;

ALTER TABLE public.workspace
  ADD CONSTRAINT workspace_booking_mode_valid
  CHECK (
    settings->>'booking_mode' IS NULL
    OR settings->>'booking_mode' IN ('simple', 'prioritized')
  );

COMMENT ON COLUMN public.workspace.settings IS
  'Workspace knobs the app reads. Known keys: booking_mode (simple|prioritized, ADR-002 — which hold convention the UI speaks; absent = simple).';
