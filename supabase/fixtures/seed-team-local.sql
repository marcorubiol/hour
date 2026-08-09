-- Team for the LOCAL `note-a` workspace — the one Marco reads the Planner
-- with. Without cast_member rows the person axis can only draw its honest
-- silences («team · no data yet», «no cast»), so there was nothing to judge.
--
-- The shape is chosen so every law of the drawing has a case on screen:
--   · one person cast in BOTH projects → the people clash goes red
--   · a person in only one → a lane that is quiet while the other works
--   · a technician → a role that is not a performer
--   · one project left THINNER than the other → the tallies differ
-- Local only, idempotent (fixed ids, upserts). Never production.
\set ws '019fb6da-5111-7b21-80c2-a0ead19e0e9e'
\set mm 'aaaa0001-0000-4000-8000-000000000001'
\set uo 'aaaa0002-0000-4000-8000-000000000002'
\set by 'cd9e3669-46bd-4893-9966-fa9ba2026306'

BEGIN;

INSERT INTO public.person (id, full_name, slug, created_by) VALUES
  ('a0000001-0000-4000-8000-000000000001', 'Anouk Villé', 'anouk-ville-na', :'by'),
  ('a0000002-0000-4000-8000-000000000002', 'Jordi Sala',  'jordi-sala-na',  :'by'),
  ('a0000003-0000-4000-8000-000000000003', 'Mia Serra',   'mia-serra-na',   :'by'),
  ('a0000004-0000-4000-8000-000000000004', 'Nils Bru',    'nils-bru-na',    :'by'),
  ('a0000005-0000-4000-8000-000000000005', 'Laia Cendra', 'laia-cendra-na', :'by')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;

INSERT INTO public.workspace_person (workspace_id, person_id, slug, full_name, created_by) VALUES
  (:'ws', 'a0000001-0000-4000-8000-000000000001', 'anouk-ville', 'Anouk Villé', :'by'),
  (:'ws', 'a0000002-0000-4000-8000-000000000002', 'jordi-sala',  'Jordi Sala',  :'by'),
  (:'ws', 'a0000003-0000-4000-8000-000000000003', 'mia-serra',   'Mia Serra',   :'by'),
  (:'ws', 'a0000004-0000-4000-8000-000000000004', 'nils-bru',    'Nils Bru',    :'by'),
  (:'ws', 'a0000005-0000-4000-8000-000000000005', 'laia-cendra', 'Laia Cendra', :'by')
ON CONFLICT (workspace_id, person_id) DO UPDATE SET full_name = EXCLUDED.full_name;

INSERT INTO public.cast_member (id, workspace_id, project_id, person_id, role, created_by) VALUES
  -- MaMeMi: three on stage, one on the desk
  ('c0000001-0000-4000-8000-000000000001', :'ws', :'mm', 'a0000001-0000-4000-8000-000000000001', 'performer',  :'by'),
  ('c0000002-0000-4000-8000-000000000002', :'ws', :'mm', 'a0000002-0000-4000-8000-000000000002', 'performer',  :'by'),
  ('c0000003-0000-4000-8000-000000000003', :'ws', :'mm', 'a0000005-0000-4000-8000-000000000005', 'technician', :'by'),
  -- Última òrbita: Anouk again (that is what makes a same-day pair a PEOPLE
  -- clash), plus two of its own
  ('c0000004-0000-4000-8000-000000000004', :'ws', :'uo', 'a0000001-0000-4000-8000-000000000001', 'performer',  :'by'),
  ('c0000005-0000-4000-8000-000000000005', :'ws', :'uo', 'a0000003-0000-4000-8000-000000000003', 'performer',  :'by'),
  ('c0000006-0000-4000-8000-000000000006', :'ws', :'uo', 'a0000004-0000-4000-8000-000000000004', 'performer',  :'by')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- An absence, so the band has someone to be about: Mia is out for a week.
INSERT INTO public.availability_block (id, workspace_id, person_id, starts_on, ends_on, certainty, note, created_by) VALUES
  ('d0000001-0000-4000-8000-000000000001', :'ws', 'a0000003-0000-4000-8000-000000000003',
   CURRENT_DATE + 5, CURRENT_DATE + 11, 'unavailable', 'fora', :'by')
ON CONFLICT (id) DO UPDATE SET starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on;

COMMIT;

SELECT p.name AS project, wp.full_name AS person, cm.role
FROM public.cast_member cm
JOIN public.project p ON p.id = cm.project_id
JOIN public.workspace_person wp ON wp.person_id = cm.person_id AND wp.workspace_id = cm.workspace_id
WHERE cm.workspace_id = :'ws'
ORDER BY p.name, wp.full_name;
