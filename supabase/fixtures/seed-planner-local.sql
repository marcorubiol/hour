-- Synthetic Planner data for the LOCAL dev database only.
-- It seeds the PLAYWRIGHT FIXTURE's own workspace — never Marco's `note-a`
-- rows, never production — so the Planner's four drawings have something to
-- draw when they are verified visually. Idempotent: fixed ids, upserts.
\set ws '019fc5c4-7e59-7950-8c60-76d47ca4a588'
\set by '968b14a5-5355-4b71-93a0-97a5c6664ef4'

BEGIN;

INSERT INTO public.project (id, workspace_id, slug, name, status, accent, created_by) VALUES
  ('bbbb0001-0000-4000-8000-000000000001', :'ws', 'fira-nova',  'Fira Nova',  'active', '4', :'by'),
  ('bbbb0002-0000-4000-8000-000000000002', :'ws', 'duo-cendra', 'Duo Cendra', 'active', '7', :'by')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, accent = EXCLUDED.accent, status = EXCLUDED.status;

INSERT INTO public.person (id, full_name, slug, created_by) VALUES
  ('cccc0001-0000-4000-8000-000000000001', 'Anouk Villé', 'anouk-ville', :'by'),
  ('cccc0002-0000-4000-8000-000000000002', 'Nils Bru',    'nils-bru',    :'by'),
  ('cccc0003-0000-4000-8000-000000000003', 'Mia Serra',   'mia-serra',   :'by')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;

INSERT INTO public.workspace_person (workspace_id, person_id, slug, full_name, created_by) VALUES
  (:'ws', 'cccc0001-0000-4000-8000-000000000001', 'anouk-ville', 'Anouk Villé', :'by'),
  (:'ws', 'cccc0002-0000-4000-8000-000000000002', 'nils-bru',    'Nils Bru',    :'by'),
  (:'ws', 'cccc0003-0000-4000-8000-000000000003', 'mia-serra',   'Mia Serra',   :'by')
ON CONFLICT (workspace_id, person_id) DO UPDATE SET full_name = EXCLUDED.full_name;

-- Anouk is in BOTH projects: that is what makes the day-2 pair a PEOPLE clash
-- (red), while everything else stays a call to make (blue).
INSERT INTO public.cast_member (id, workspace_id, project_id, person_id, role, created_by) VALUES
  ('dddd0001-0000-4000-8000-000000000001', :'ws', 'bbbb0001-0000-4000-8000-000000000001', 'cccc0001-0000-4000-8000-000000000001', 'performer', :'by'),
  ('dddd0002-0000-4000-8000-000000000002', :'ws', 'bbbb0001-0000-4000-8000-000000000001', 'cccc0002-0000-4000-8000-000000000002', 'performer', :'by'),
  ('dddd0003-0000-4000-8000-000000000003', :'ws', 'bbbb0002-0000-4000-8000-000000000002', 'cccc0001-0000-4000-8000-000000000001', 'performer', :'by'),
  ('dddd0004-0000-4000-8000-000000000004', :'ws', 'bbbb0002-0000-4000-8000-000000000002', 'cccc0003-0000-4000-8000-000000000003', 'performer', :'by')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.venue (id, workspace_id, name, city, country, slug, timezone, created_by) VALUES
  ('eeee0001-0000-4000-8000-000000000001', :'ws', 'Teatre Nou',  'Girona', 'ES', 'teatre-nou',  'Europe/Madrid', :'by'),
  ('eeee0002-0000-4000-8000-000000000002', :'ws', 'Sala Ferro',  'Lisboa', 'PT', 'sala-ferro',  'Europe/Lisbon', :'by')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO public.performance
  (id, workspace_id, project_id, performed_at, venue_id, venue_name, city, country, status, slug,
   created_by, load_in_at, soundcheck_at, start_at, loadout_at, hold_notice_days)
VALUES
  -- today · a firm gig with the whole run sheet
  ('ffff0001-0000-4000-8000-000000000001', :'ws', 'bbbb0001-0000-4000-8000-000000000001', CURRENT_DATE,
   'eeee0001-0000-4000-8000-000000000001', 'Teatre Nou', 'Girona', 'ES', 'confirmed', 'teatre-nou-hoy', :'by',
   CURRENT_DATE + time '15:30', CURRENT_DATE + time '18:00', CURRENT_DATE + time '20:00', CURRENT_DATE + time '23:00', NULL),
  -- +2 · the pair that clashes (both hold Anouk)
  ('ffff0002-0000-4000-8000-000000000002', :'ws', 'bbbb0001-0000-4000-8000-000000000001', CURRENT_DATE + 2,
   NULL, 'Ateneu', 'Manresa', 'ES', 'hold_1', 'ateneu-hold', :'by',
   NULL, NULL, CURRENT_DATE + 2 + time '20:00', NULL, 7),
  ('ffff0003-0000-4000-8000-000000000003', :'ws', 'bbbb0002-0000-4000-8000-000000000002', CURRENT_DATE + 2,
   NULL, 'La Bòbila', 'Vic', 'ES', 'hold_2', 'bobila-hold', :'by',
   NULL, NULL, CURRENT_DATE + 2 + time '21:30', NULL, NULL),
  -- +9 · abroad: the second clock and the country code
  ('ffff0004-0000-4000-8000-000000000004', :'ws', 'bbbb0002-0000-4000-8000-000000000002', CURRENT_DATE + 9,
   'eeee0002-0000-4000-8000-000000000002', 'Sala Ferro', 'Lisboa', 'PT', 'confirmed', 'sala-ferro-gig', :'by',
   CURRENT_DATE + 9 + time '17:00', NULL, CURRENT_DATE + 9 + time '21:00', NULL, NULL),
  -- +21 · a lone proposal, so the fold and the horizon have work to do
  ('ffff0005-0000-4000-8000-000000000005', :'ws', 'bbbb0001-0000-4000-8000-000000000001', CURRENT_DATE + 21,
   NULL, 'Cafè Nòmada', 'Palma', 'ES', 'proposed', 'nomada-prop', :'by', NULL, NULL, NULL, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET
  performed_at = EXCLUDED.performed_at, status = EXCLUDED.status,
  start_at = EXCLUDED.start_at, load_in_at = EXCLUDED.load_in_at,
  soundcheck_at = EXCLUDED.soundcheck_at, loadout_at = EXCLUDED.loadout_at;

INSERT INTO public.date
  (id, workspace_id, project_id, kind, title, starts_at, ends_at, city, country, travel_direction, created_by)
VALUES
  -- a rehearsal RUN of two days → the prep band
  ('a1a10001-0000-4000-8000-000000000001', :'ws', 'bbbb0001-0000-4000-8000-000000000001', 'rehearsal', 'Assaig general',
   CURRENT_DATE + 1 + time '10:00', CURRENT_DATE + 1 + time '14:00', 'Barcelona', 'ES', NULL, :'by'),
  ('a1a10002-0000-4000-8000-000000000002', :'ws', 'bbbb0001-0000-4000-8000-000000000001', 'rehearsal', 'Assaig general',
   CURRENT_DATE + 2 + time '10:00', CURRENT_DATE + 2 + time '13:00', 'Barcelona', 'ES', NULL, :'by'),
  -- a travel leg, with its direction
  ('a1a10003-0000-4000-8000-000000000003', :'ws', 'bbbb0002-0000-4000-8000-000000000002', 'travel_day', 'Vol BCN → LIS',
   CURRENT_DATE + 9 + time '09:30', NULL, 'Lisboa', 'PT', 'outbound', :'by'),
  -- a press call: the class that must never draw a cast
  ('a1a10004-0000-4000-8000-000000000004', :'ws', 'bbbb0001-0000-4000-8000-000000000001', 'press', 'Entrevista · Ràdio Nova',
   CURRENT_DATE + 3 + time '11:00', CURRENT_DATE + 3 + time '11:30', 'Barcelona', 'ES', NULL, :'by')
ON CONFLICT (id) DO UPDATE SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at;

-- Mia away across the clash week: the measured band, and the door the
-- person-axis inference has to stop at.
INSERT INTO public.availability_block (id, workspace_id, person_id, starts_on, ends_on, certainty, note, created_by) VALUES
  ('b2b20001-0000-4000-8000-000000000001', :'ws', 'cccc0003-0000-4000-8000-000000000003',
   CURRENT_DATE + 1, CURRENT_DATE + 4, 'unavailable', 'fora', :'by')
ON CONFLICT (id) DO UPDATE SET starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on;

COMMIT;

SELECT 'projects' AS what, count(*) FROM public.project WHERE workspace_id = :'ws'
UNION ALL SELECT 'performances', count(*) FROM public.performance WHERE workspace_id = :'ws'
UNION ALL SELECT 'dates', count(*) FROM public.date WHERE workspace_id = :'ws'
UNION ALL SELECT 'cast', count(*) FROM public.cast_member WHERE workspace_id = :'ws'
UNION ALL SELECT 'away', count(*) FROM public.availability_block WHERE workspace_id = :'ws';
-- More of the same synthetic season for the LOCAL fixture workspace: enough
-- weight that the Planner can be judged against something that behaves like
-- a real month — past and future, a tour with its two legs, a residency, a
-- clash with no team data (the honest «possible»), a tentative absence, and
-- a third project so a rail has more than two lanes under it.
\set ws '019fc5c4-7e59-7950-8c60-76d47ca4a588'
\set by '968b14a5-5355-4b71-93a0-97a5c6664ef4'

BEGIN;

INSERT INTO public.project (id, workspace_id, slug, name, status, accent, created_by) VALUES
  ('bbbb0003-0000-4000-8000-000000000003', :'ws', 'nit-oberta', 'Nit Oberta', 'active', '9', :'by')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, accent = EXCLUDED.accent;

INSERT INTO public.person (id, full_name, slug, created_by) VALUES
  ('cccc0004-0000-4000-8000-000000000004', 'Pau Grau',   'pau-grau',   :'by'),
  ('cccc0005-0000-4000-8000-000000000005', 'Lena Roig',  'lena-roig',  :'by')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;

INSERT INTO public.workspace_person (workspace_id, person_id, slug, full_name, created_by) VALUES
  (:'ws', 'cccc0004-0000-4000-8000-000000000004', 'pau-grau',  'Pau Grau',  :'by'),
  (:'ws', 'cccc0005-0000-4000-8000-000000000005', 'lena-roig', 'Lena Roig', :'by')
ON CONFLICT (workspace_id, person_id) DO UPDATE SET full_name = EXCLUDED.full_name;

INSERT INTO public.cast_member (id, workspace_id, project_id, person_id, role, created_by) VALUES
  ('dddd0005-0000-4000-8000-000000000005', :'ws', 'bbbb0003-0000-4000-8000-000000000003', 'cccc0004-0000-4000-8000-000000000004', 'performer', :'by'),
  ('dddd0006-0000-4000-8000-000000000006', :'ws', 'bbbb0003-0000-4000-8000-000000000003', 'cccc0005-0000-4000-8000-000000000005', 'performer', :'by'),
  ('dddd0007-0000-4000-8000-000000000007', :'ws', 'bbbb0002-0000-4000-8000-000000000002', 'cccc0004-0000-4000-8000-000000000004', 'technician', :'by')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.venue (id, workspace_id, name, city, country, slug, timezone, created_by) VALUES
  ('eeee0003-0000-4000-8000-000000000003', :'ws', 'Ateneu Popular', 'Manresa', 'ES', 'ateneu-popular', 'Europe/Madrid', :'by'),
  ('eeee0004-0000-4000-8000-000000000004', :'ws', 'La Fàbrica',     'Girona',  'ES', 'la-fabrica',     'Europe/Madrid', :'by')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO public.performance
  (id, workspace_id, project_id, performed_at, venue_id, venue_name, city, country, status, slug,
   created_by, load_in_at, soundcheck_at, start_at, loadout_at, hold_notice_days)
VALUES
  -- THE PAST: two played dates, so travelling backwards has somewhere to land
  ('ffff0006-0000-4000-8000-000000000006', :'ws', 'bbbb0001-0000-4000-8000-000000000001', CURRENT_DATE - 12,
   'eeee0004-0000-4000-8000-000000000004', 'La Fàbrica', 'Girona', 'ES', 'confirmed', 'fabrica-past', :'by',
   CURRENT_DATE - 12 + time '16:00', NULL, CURRENT_DATE - 12 + time '20:30', NULL, NULL),
  ('ffff0007-0000-4000-8000-000000000007', :'ws', 'bbbb0003-0000-4000-8000-000000000003', CURRENT_DATE - 4,
   'eeee0003-0000-4000-8000-000000000003', 'Ateneu Popular', 'Manresa', 'ES', 'confirmed', 'ateneu-past', :'by',
   NULL, NULL, CURRENT_DATE - 4 + time '19:00', NULL, NULL),
  -- A THREE-NIGHT RUN at one venue: consecutive days, the shape of a real week
  ('ffff0008-0000-4000-8000-000000000008', :'ws', 'bbbb0003-0000-4000-8000-000000000003', CURRENT_DATE + 4,
   'eeee0004-0000-4000-8000-000000000004', 'La Fàbrica', 'Girona', 'ES', 'confirmed', 'fabrica-n1', :'by',
   CURRENT_DATE + 4 + time '15:00', CURRENT_DATE + 4 + time '18:00', CURRENT_DATE + 4 + time '20:30', CURRENT_DATE + 4 + time '23:30', NULL),
  ('ffff0009-0000-4000-8000-000000000009', :'ws', 'bbbb0003-0000-4000-8000-000000000003', CURRENT_DATE + 5,
   'eeee0004-0000-4000-8000-000000000004', 'La Fàbrica', 'Girona', 'ES', 'confirmed', 'fabrica-n2', :'by',
   NULL, CURRENT_DATE + 5 + time '18:00', CURRENT_DATE + 5 + time '20:30', NULL, NULL),
  ('ffff000a-0000-4000-8000-00000000000a', :'ws', 'bbbb0003-0000-4000-8000-000000000003', CURRENT_DATE + 6,
   'eeee0004-0000-4000-8000-000000000004', 'La Fàbrica', 'Girona', 'ES', 'hold_1', 'fabrica-n3', :'by',
   NULL, NULL, CURRENT_DATE + 6 + time '20:30', NULL, 10),
  -- A CLASH WITH NO TEAM DATA: the honest «possible» (blue), against the
  -- people clash on +2 (red) — the two registers side by side.
  ('ffff000b-0000-4000-8000-00000000000b', :'ws', 'bbbb0003-0000-4000-8000-000000000003', CURRENT_DATE + 14,
   NULL, 'Sala Zero', 'Tarragona', 'ES', 'hold_2', 'zero-hold', :'by', NULL, NULL, CURRENT_DATE + 14 + time '21:00', NULL, 5)
ON CONFLICT (id) DO UPDATE SET performed_at = EXCLUDED.performed_at, status = EXCLUDED.status;

INSERT INTO public.date
  (id, workspace_id, project_id, kind, status, title, starts_at, ends_at, city, country, travel_direction, created_by)
VALUES
  -- the return leg: with the outbound already seeded, the tour band appears
  ('a1a10005-0000-4000-8000-000000000005', :'ws', 'bbbb0002-0000-4000-8000-000000000002', 'travel_day', 'confirmed', 'Vol LIS → BCN',
   CURRENT_DATE + 10 + time '18:00', NULL, 'Barcelona', 'ES', 'return', :'by'),
  -- a residency of four days: the prep run at its longest
  ('a1a10006-0000-4000-8000-000000000006', :'ws', 'bbbb0003-0000-4000-8000-000000000003', 'residency', 'confirmed', 'Residència La Fàbrica',
   CURRENT_DATE + 1 + time '09:00', CURRENT_DATE + 1 + time '18:00', 'Girona', 'ES', NULL, :'by'),
  ('a1a10007-0000-4000-8000-000000000007', :'ws', 'bbbb0003-0000-4000-8000-000000000003', 'residency', 'confirmed', 'Residència La Fàbrica',
   CURRENT_DATE + 2 + time '09:00', CURRENT_DATE + 2 + time '18:00', 'Girona', 'ES', NULL, :'by'),
  ('a1a10008-0000-4000-8000-000000000008', :'ws', 'bbbb0003-0000-4000-8000-000000000003', 'residency', 'confirmed', 'Residència La Fàbrica',
   CURRENT_DATE + 3 + time '09:00', CURRENT_DATE + 3 + time '18:00', 'Girona', 'ES', NULL, :'by'),
  -- a day off, and a press call for the third project
  ('a1a10009-0000-4000-8000-000000000009', :'ws', 'bbbb0001-0000-4000-8000-000000000001', 'day_off', 'confirmed', NULL,
   CURRENT_DATE + 7 + time '00:00', NULL, NULL, NULL, NULL, :'by'),
  ('a1a1000a-0000-4000-8000-00000000000a', :'ws', 'bbbb0003-0000-4000-8000-000000000003', 'press', 'confirmed', 'Roda de premsa · Girona',
   CURRENT_DATE + 3 + time '12:00', CURRENT_DATE + 3 + time '13:00', 'Girona', 'ES', NULL, :'by')
ON CONFLICT (id) DO UPDATE SET starts_at = EXCLUDED.starts_at, status = EXCLUDED.status;

-- a TENTATIVE absence beside the settled one: the two registers of doubt
INSERT INTO public.availability_block (id, workspace_id, person_id, starts_on, ends_on, certainty, note, created_by) VALUES
  ('b2b20002-0000-4000-8000-000000000002', :'ws', 'cccc0002-0000-4000-8000-000000000002',
   CURRENT_DATE + 15, CURRENT_DATE + 18, 'tentative', 'possible viatge', :'by'),
  -- and one for the whole company (person_id NULL): the space's own band
  ('b2b20003-0000-4000-8000-000000000003', :'ws', NULL,
   CURRENT_DATE + 24, CURRENT_DATE + 26, 'unavailable', 'tancat per festes', :'by')
ON CONFLICT (id) DO UPDATE SET starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on;

COMMIT;

SELECT 'projects' AS what, count(*) FROM public.project WHERE workspace_id = :'ws'
UNION ALL SELECT 'people', count(*) FROM public.workspace_person WHERE workspace_id = :'ws'
UNION ALL SELECT 'performances', count(*) FROM public.performance WHERE workspace_id = :'ws'
UNION ALL SELECT 'dates', count(*) FROM public.date WHERE workspace_id = :'ws'
UNION ALL SELECT 'cast', count(*) FROM public.cast_member WHERE workspace_id = :'ws'
UNION ALL SELECT 'away', count(*) FROM public.availability_block WHERE workspace_id = :'ws';
