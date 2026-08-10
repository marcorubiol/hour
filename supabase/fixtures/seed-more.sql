
-- ── THE FOLD-CROSSING ABSENCE ────────────────────────────────────────────
-- The one shape the fixtures never had, and the one that showed the bug
-- Marco caught on 2026-08-10: an absence long enough that the board folds
-- days INSIDE it. Cut at the fold it printed `away Anouk Villé` twice with a
-- blank between; it must draw ONE band whose line crosses the fold.
-- Lena Roig is deliberately left with a run that ENDS inside a fold — the
-- other half of the law (no arrowhead, no 58px of days nobody sees).
INSERT INTO public.availability_block (id, workspace_id, person_id, starts_on, ends_on, certainty, note, created_by) VALUES
  ('b2b20004-0000-4000-8000-000000000004', '019fc5c4-7e59-7950-8c60-76d47ca4a588',
   'cccc0001-0000-4000-8000-000000000001', CURRENT_DATE + 4, CURRENT_DATE + 17, 'unavailable', 'gira externa', '968b14a5-5355-4b71-93a0-97a5c6664ef4')
ON CONFLICT (id) DO UPDATE SET starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on;
