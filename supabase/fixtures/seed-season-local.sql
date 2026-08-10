-- A full six-month season for the LOCAL `note-a` workspace — the one Marco
-- reads the Planner with. Never production, never the Playwright fixture
-- workspace (that one has its own file, `seed-planner-local.sql`).
--
-- The point is COVERAGE: every branch the drawings can take should have a
-- case on screen, and the season should still read like a real company's
-- six months rather than a unit-test grid.
--
-- Anchors (so the season stays "the next six months" whenever it is run):
--   :t0 = today            → the near days, the fold, the past tail
--   :f0 = the coming Friday → every weekend gig hangs off this, so runs land
--                             on Fri/Sat/Sun the way a tour actually does
-- Offsets go from f0-1 to f0+175 ≈ six months.
--
-- Idempotent: fixed ids, upserts. Money rows never re-write `status` or
-- `number` on conflict — those are derived/immutable and their triggers
-- would (rightly) refuse.
\set ws '019fb6da-5111-7b21-80c2-a0ead19e0e9e'
\set by 'cd9e3669-46bd-4893-9966-fa9ba2026306'
\set mm 'aaaa0001-0000-4000-8000-000000000001'
\set uo 'aaaa0002-0000-4000-8000-000000000002'
\set op '019fb6da-5188-769f-be1b-f785f6c6fbbe'
\set ze '15150001-0000-4000-8000-000000000001'
\set t0 'CURRENT_DATE'
\set f0 '(CURRENT_DATE + (((5 - extract(isodow FROM CURRENT_DATE)::int) + 7) % 7))'

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · A fourth project, so the board has a lane in creation and a lane in
--     draft next to the two that tour.
-- ---------------------------------------------------------------------------
INSERT INTO public.project (id, workspace_id, slug, name, status, accent, created_by) VALUES
  (:'ze', :'ws', 'zoo-electric', 'Zoo Elèctric', 'active', '2', :'by')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, accent = EXCLUDED.accent, status = EXCLUDED.status;

-- ---------------------------------------------------------------------------
-- 2 · Lines — the operative grouping had ZERO rows in this workspace, so no
--     drawing that reads a line had anything to read. One of each kind that
--     matters, plus a closed one and an archived one.
-- ---------------------------------------------------------------------------
INSERT INTO public.line (id, workspace_id, project_id, slug, name, kind, status, territory, start_date, end_date, accent, description, created_by) VALUES
  ('22220001-0000-4000-8000-000000000001', :'ws', :'mm', 'gira-tardor-2026', 'Gira tardor 2026', 'tour',      'open',   'Catalunya i Europa', :f0 + 118, :f0 + 130, '4', 'Els dos bolos europeus de novembre.', :'by'),
  ('22220002-0000-4000-8000-000000000002', :'ws', :'mm', 'temporada-26-27',  'Temporada 26/27',  'season',    'open',   'Catalunya',          :f0 - 7,   :f0 + 175, '6', NULL, :'by'),
  ('22220003-0000-4000-8000-000000000003', :'ws', :'uo', 'circuit-xarxa',    'Circuit Xarxa',    'circuit',   'open',   'Catalunya',          :f0,       :f0 + 120, '8', 'Bolos de la Xarxa d''ateneus.', :'by'),
  ('22220004-0000-4000-8000-000000000004', :'ws', :'uo', 'gira-europa',      'Gira Europa',      'tour',      'open',   'Portugal',           :f0 + 62,  :f0 + 69,  '9', NULL, :'by'),
  ('22220005-0000-4000-8000-000000000005', :'ws', :'uo', 'cervantino-2027',  'Cervantino 2027',  'tour',      'open',   'Mèxic',              :f0 + 149, :f0 + 157, '1', 'Convidats al FIC.', :'by'),
  ('22220006-0000-4000-8000-000000000006', :'ws', :'ze', 'creacio-zoo',      'Creació Zoo',      'creation',  'open',   NULL,                 :f0 - 30,  :f0 + 56,  '2', 'Del laboratori a l''estrena.', :'by'),
  ('22220007-0000-4000-8000-000000000007', :'ws', :'ze', 'residencia-graner','Residència Graner','residency', 'closed', 'Barcelona',          :f0 + 3,   :f0 + 6,   '3', NULL, :'by'),
  ('22220008-0000-4000-8000-000000000008', :'ws', :'mm', 'campanya-premsa',  'Campanya premsa',  'campaign',  'archived', NULL,               :f0 - 60,  :f0 - 10,  '7', NULL, :'by')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, kind = EXCLUDED.kind, status = EXCLUDED.status,
  start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date;

-- ---------------------------------------------------------------------------
-- 3 · People. Four more of the company (one of them, Bea, is cast in TWO
--     projects — that is what makes a MaMeMi×Zoo pair go red) and seven
--     programmers on the other side of the phone, for Conversations.
--     Òscar is crew only: a person with no cast row anywhere.
-- ---------------------------------------------------------------------------
INSERT INTO public.person (id, full_name, slug, email, city, country, organization_name, title, created_by) VALUES
  ('12340001-0000-4000-8000-000000000001', 'Ivet Nogué',      'ivet-nogue-na',      NULL, 'Barcelona', 'ES', NULL, NULL, :'by'),
  ('12340002-0000-4000-8000-000000000002', 'Tomàs Ferrer',    'tomas-ferrer-na',    NULL, 'Girona',    'ES', NULL, NULL, :'by'),
  ('12340003-0000-4000-8000-000000000003', 'Bea Roure',       'bea-roure-na',       NULL, 'Barcelona', 'ES', NULL, 'Tècnica de so', :'by'),
  ('12340004-0000-4000-8000-000000000004', 'Òscar Pey',       'oscar-pey-na',       NULL, 'Manresa',   'ES', NULL, 'Regidor', :'by'),
  ('12350001-0000-4000-8000-000000000001', 'Marta Puig',      'marta-puig-na',      'marta.puig@example.test',   'Terrassa',  'ES', 'Teatre Principal',    'Programació', :'by'),
  ('12350002-0000-4000-8000-000000000002', 'Hélder Costa',    'helder-costa-na',    'helder.costa@example.test', 'Lisboa',    'PT', 'Teatro Maria Matos',  'Direção artística', :'by'),
  ('12350003-0000-4000-8000-000000000003', 'Claire Ostrowski','claire-ostrowski-na','claire.o@example.test',     'Paris',     'FR', 'La Villette',         'Programmation', :'by'),
  ('12350004-0000-4000-8000-000000000004', 'Gio Marconi',     'gio-marconi-na',     'gio.marconi@example.test',  'Roma',      'IT', 'Teatro India',        'Programmazione', :'by'),
  ('12350005-0000-4000-8000-000000000005', 'Sam Wren',        'sam-wren-na',        'sam.wren@example.test',     'London',    'GB', 'Cafe OTO',            'Bookings', :'by'),
  ('12350006-0000-4000-8000-000000000006', 'Ana Zubiri',      'ana-zubiri-na',      'ana.zubiri@example.test',   'Bilbao',    'ES', 'Azkuna Zentroa',      'Programación', :'by'),
  ('12350007-0000-4000-8000-000000000007', 'Lucía Ferreiro',  'lucia-ferreiro-na',  'lucia.f@example.test',      'Guanajuato','MX', 'Festival Cervantino', 'Programación', :'by')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, title = EXCLUDED.title;

INSERT INTO public.workspace_person (workspace_id, person_id, slug, full_name, email, city, country, title, notes, created_by) VALUES
  (:'ws', '12340001-0000-4000-8000-000000000001', 'ivet-nogue',   'Ivet Nogué',   NULL, 'Barcelona', 'ES', NULL, NULL, :'by'),
  (:'ws', '12340002-0000-4000-8000-000000000002', 'tomas-ferrer', 'Tomàs Ferrer', NULL, 'Girona',    'ES', NULL, 'Fa la substitució de la Laia quan cal.', :'by'),
  (:'ws', '12340003-0000-4000-8000-000000000003', 'bea-roure',    'Bea Roure',    NULL, 'Barcelona', 'ES', 'Tècnica de so', NULL, :'by'),
  (:'ws', '12340004-0000-4000-8000-000000000004', 'oscar-pey',    'Òscar Pey',    NULL, 'Manresa',   'ES', 'Regidor', 'Només gires; no fa assajos.', :'by'),
  (:'ws', '12350001-0000-4000-8000-000000000001', 'marta-puig',      'Marta Puig',       'marta.puig@example.test',   'Terrassa',  'ES', 'Programació', NULL, :'by'),
  (:'ws', '12350002-0000-4000-8000-000000000002', 'helder-costa',    'Hélder Costa',     'helder.costa@example.test', 'Lisboa',    'PT', 'Direção artística', NULL, :'by'),
  (:'ws', '12350003-0000-4000-8000-000000000003', 'claire-ostrowski','Claire Ostrowski', 'claire.o@example.test',     'Paris',     'FR', 'Programmation', 'Respon lent, però respon.', :'by'),
  (:'ws', '12350004-0000-4000-8000-000000000004', 'gio-marconi',     'Gio Marconi',      'gio.marconi@example.test',  'Roma',      'IT', 'Programmazione', NULL, :'by'),
  (:'ws', '12350005-0000-4000-8000-000000000005', 'sam-wren',        'Sam Wren',         'sam.wren@example.test',     'London',    'GB', 'Bookings', NULL, :'by'),
  (:'ws', '12350006-0000-4000-8000-000000000006', 'ana-zubiri',      'Ana Zubiri',       'ana.zubiri@example.test',   'Bilbao',    'ES', 'Programación', NULL, :'by'),
  (:'ws', '12350007-0000-4000-8000-000000000007', 'lucia-ferreiro',  'Lucía Ferreiro',   'lucia.f@example.test',      'Guanajuato','MX', 'Programación', NULL, :'by')
ON CONFLICT (workspace_id, person_id) DO UPDATE SET full_name = EXCLUDED.full_name, title = EXCLUDED.title;

-- Rosters, chosen so the conflict engine has one clean case per severity:
--   MaMeMi ∩ Última òrbita = Anouk  → 'people'
--   MaMeMi ∩ Zoo Elèctric  = Bea    → 'people'
--   Última òrbita ∩ Zoo    = ∅      → 'concurrence' (the quiet tier)
--   Obra de prueba          = ∅ cast → 'possible' (the honest no-data read)
INSERT INTO public.cast_member (id, workspace_id, project_id, person_id, role, joined_at, created_by) VALUES
  ('c0000007-0000-4000-8000-000000000007', :'ws', :'ze', '12340001-0000-4000-8000-000000000001', 'performer',  :f0 - 30, :'by'),
  ('c0000008-0000-4000-8000-000000000008', :'ws', :'ze', '12340002-0000-4000-8000-000000000002', 'performer',  :f0 - 30, :'by'),
  ('c0000009-0000-4000-8000-000000000009', :'ws', :'ze', '12340003-0000-4000-8000-000000000003', 'technician', :f0 - 20, :'by'),
  ('c000000a-0000-4000-8000-00000000000a', :'ws', :'mm', '12340003-0000-4000-8000-000000000003', 'technician', :f0 - 60, :'by')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- ---------------------------------------------------------------------------
-- 4 · Venues — twelve more, with real timezones so the second clock has
--     something to say (PT −1h, GB −1h, MX −7h/−8h) and capacities from 120
--     to 1200.
-- ---------------------------------------------------------------------------
INSERT INTO public.venue (id, workspace_id, name, city, country, slug, timezone, capacity, address, contacts, created_by) VALUES
  ('11110001-0000-4000-8000-000000000001', :'ws', 'Mercat de les Flors', 'Barcelona',  'ES', 'mercat-de-les-flors', 'Europe/Madrid',      800,  'Carrer de Lleida 59', '[{"name":"Roser Vidal","role":"Producció","email":"roser@example.test"}]', :'by'),
  ('11110002-0000-4000-8000-000000000002', :'ws', 'Teatre Municipal',    'Girona',     'ES', 'teatre-municipal-gi', 'Europe/Madrid',      400,  'Plaça del Vi 1', '[]', :'by'),
  ('11110003-0000-4000-8000-000000000003', :'ws', 'Kursaal',             'Manresa',    'ES', 'kursaal-manresa',     'Europe/Madrid',      700,  'Passeig de Pere III 35', '[{"name":"Jan Costa","role":"Tècnic","phone":"+34600000001"}]', :'by'),
  ('11110004-0000-4000-8000-000000000004', :'ws', 'Teatro Maria Matos',  'Lisboa',     'PT', 'maria-matos',         'Europe/Lisbon',      600,  'Av. Frei Miguel Contreiras 52', '[]', :'by'),
  ('11110005-0000-4000-8000-000000000005', :'ws', 'Teatro Rivoli',       'Porto',      'PT', 'rivoli-porto',        'Europe/Lisbon',      900,  'Praça D. João I', '[]', :'by'),
  ('11110006-0000-4000-8000-000000000006', :'ws', 'La Villette',         'Paris',      'FR', 'la-villette',         'Europe/Paris',       1200, '211 Av. Jean Jaurès', '[]', :'by'),
  ('11110007-0000-4000-8000-000000000007', :'ws', 'Teatro India',        'Roma',       'IT', 'teatro-india',        'Europe/Rome',        350,  'Lungotevere Vittorio Gassman 1', '[]', :'by'),
  ('11110008-0000-4000-8000-000000000008', :'ws', 'Kampnagel',           'Hamburg',    'DE', 'kampnagel',           'Europe/Berlin',      500,  'Jarrestraße 20', '[]', :'by'),
  ('11110009-0000-4000-8000-000000000009', :'ws', 'Gessnerallee',        'Zürich',     'CH', 'gessnerallee',        'Europe/Zurich',      300,  'Gessnerallee 8', '[]', :'by'),
  ('1111000a-0000-4000-8000-00000000000a', :'ws', 'Teatro Juárez',       'Guanajuato', 'MX', 'teatro-juarez',       'America/Mexico_City',1100, 'Calle de Sopeña s/n', '[{"name":"Lucía Ferreiro","role":"Programación"}]', :'by'),
  ('1111000b-0000-4000-8000-00000000000b', :'ws', 'Azkuna Zentroa',      'Bilbao',     'ES', 'azkuna-zentroa',      'Europe/Madrid',      450,  'Arriquibar Plaza 4', '[]', :'by'),
  ('1111000c-0000-4000-8000-00000000000c', :'ws', 'La Mutant',           'València',   'ES', 'la-mutant',           'Europe/Madrid',      250,  'Carrer de Joan Verdeguer 26', '[]', :'by'),
  ('1111000d-0000-4000-8000-00000000000d', :'ws', 'Sala Ártica',         'Zaragoza',   'ES', 'sala-artica',         'Europe/Madrid',      120,  NULL, '[]', :'by')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, capacity = EXCLUDED.capacity, timezone = EXCLUDED.timezone;

-- ---------------------------------------------------------------------------
-- 5 · The money frame: who issues and who pays.
-- ---------------------------------------------------------------------------
INSERT INTO public.fiscal_identity (id, workspace_id, kind, label, legal_name, tax_id, address_line_1, postal_code, city, country, iban, swift_bic, default_vat_pct, default_irpf_pct, created_by) VALUES
  ('13130001-0000-4000-8000-000000000001', :'ws', 'issuer',   'La cia',            'MüK Cia SCCL',            'F12345678', 'Carrer del Bruc 12', '08010', 'Barcelona', 'ES', 'ES9121000418450200051332', 'CAIXESBBXXX', 21, 15, :'by'),
  ('13130002-0000-4000-8000-000000000002', :'ws', 'receiver', 'Teatre Principal',  'Ajuntament de Terrassa',  'P0827900B', 'Raval de Montserrat 14', '08221', 'Terrassa', 'ES', NULL, NULL, 21, 15, :'by'),
  ('13130003-0000-4000-8000-000000000003', :'ws', 'receiver', 'Maria Matos',       'EGEAC EEM SA',            'PT504114218', 'Av. Frei Miguel Contreiras 52', '1700-213', 'Lisboa', 'PT', NULL, NULL, 6, NULL, :'by'),
  ('13130004-0000-4000-8000-000000000004', :'ws', 'receiver', 'Cafe OTO',          'Cafe OTO Ltd',            'GB123456789', '18-22 Ashwin Street', 'E8 3DL', 'London', 'GB', NULL, NULL, 20, NULL, :'by'),
  ('13130005-0000-4000-8000-000000000005', :'ws', 'receiver', 'Cervantino',        'Festival Internacional Cervantino AC', 'FIC800101AB1', 'Plaza San Fernando 1', '36000', 'Guanajuato', 'MX', NULL, NULL, 16, NULL, :'by'),
  ('13130006-0000-4000-8000-000000000006', :'ws', 'receiver', 'Kursaal',           'Fundació Kursaal',        'G65432198', 'Passeig de Pere III 35', '08241', 'Manresa', 'ES', NULL, NULL, 21, 15, :'by')
ON CONFLICT (id) DO UPDATE SET legal_name = EXCLUDED.legal_name, label = EXCLUDED.label;

INSERT INTO public.workspace_organization (id, workspace_id, slug, name, kind, email, phone, website, city, country, notes, created_by) VALUES
  ('14140001-0000-4000-8000-000000000001', :'ws', 'teatre-principal-org', 'Teatre Principal de Terrassa', 'theatre',   'info@example.test',    '+34937000001', 'https://example.test/tp',  'Terrassa',  'ES', NULL, :'by'),
  ('14140002-0000-4000-8000-000000000002', :'ws', 'egeac',                'EGEAC',                        'presenter', 'geral@example.test',   NULL,           NULL,                       'Lisboa',    'PT', NULL, :'by'),
  ('14140003-0000-4000-8000-000000000003', :'ws', 'cervantino',           'Festival Cervantino',          'festival',  'prog@example.test',    NULL,           'https://example.test/fic', 'Guanajuato','MX', 'Convit per 2027.', :'by'),
  ('14140004-0000-4000-8000-000000000004', :'ws', 'xarxa-ateneus',        'Xarxa d''Ateneus',             'presenter', 'xarxa@example.test',   NULL,           NULL,                       'Barcelona', 'ES', NULL, :'by'),
  ('14140005-0000-4000-8000-000000000005', :'ws', 'icec',                 'ICEC',                         'institution', NULL,                 NULL,           NULL,                       'Barcelona', 'ES', 'Justificació al gener.', :'by'),
  ('14140006-0000-4000-8000-000000000006', :'ws', 'agencia-nord',         'Agència Nord',                 'agency',   'hello@example.test',   NULL,           NULL,                       'Bilbao',    'ES', NULL, :'by')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind;

-- ---------------------------------------------------------------------------
-- 6 · Bolos — the unit of money (ADR-087): one room, one deal, 1..N
--     functions. Four of them carry two functions each; one carries none
--     yet (a deal before there is a date); currencies EUR/GBP/CHF/MXN so the
--     header has more than one column to add up.
-- ---------------------------------------------------------------------------
INSERT INTO public.bolo (id, workspace_id, project_id, line_id, venue_name, city, country, fee_amount, fee_currency, status, created_by) VALUES
  ('88880001-0000-4000-8000-000000000001', :'ws', :'mm', '22220002-0000-4000-8000-000000000002', 'Kursaal',            'Manresa',   'ES', 4200,   'EUR', 'paid',      :'by'),
  ('88880002-0000-4000-8000-000000000002', :'ws', :'uo', '22220003-0000-4000-8000-000000000003', 'La Mutant',          'València',  'ES', 2200,   'EUR', 'invoiced',  :'by'),
  ('88880003-0000-4000-8000-000000000003', :'ws', :'mm', NULL,                                   'Sala Ártica',        'Zaragoza',  'ES', 900,    'EUR', 'done',      :'by'),
  ('88880004-0000-4000-8000-000000000004', :'ws', :'mm', '22220002-0000-4000-8000-000000000002', 'Mercat de les Flors','Barcelona', 'ES', 4200,   'EUR', 'confirmed', :'by'),
  ('88880005-0000-4000-8000-000000000005', :'ws', :'uo', '22220003-0000-4000-8000-000000000003', 'Nau Ivanow',         'Barcelona', 'ES', 1800,   'EUR', 'confirmed', :'by'),
  ('88880006-0000-4000-8000-000000000006', :'ws', :'mm', '22220002-0000-4000-8000-000000000002', 'Teatre Principal',   'Terrassa',  'ES', 2600,   'EUR', 'confirmed', :'by'),
  ('88880007-0000-4000-8000-000000000007', :'ws', :'mm', NULL,                                   'Gessnerallee',       'Zürich',    'CH', 3200,   'CHF', 'hold_2',    :'by'),
  ('88880008-0000-4000-8000-000000000008', :'ws', :'mm', '22220002-0000-4000-8000-000000000002', 'Kursaal',            'Manresa',   'ES', 3100,   'EUR', 'confirmed', :'by'),
  ('88880009-0000-4000-8000-000000000009', :'ws', :'ze', '22220006-0000-4000-8000-000000000006', 'Mercat de les Flors','Barcelona', 'ES', 5000,   'EUR', 'confirmed', :'by'),
  ('8888000a-0000-4000-8000-00000000000a', :'ws', :'uo', '22220004-0000-4000-8000-000000000004', 'Teatro Maria Matos', 'Lisboa',    'PT', 3500,   'EUR', 'confirmed', :'by'),
  ('8888000b-0000-4000-8000-00000000000b', :'ws', :'uo', '22220004-0000-4000-8000-000000000004', 'Teatro Rivoli',      'Porto',     'PT', 3000,   'EUR', 'confirmed', :'by'),
  ('8888000c-0000-4000-8000-00000000000c', :'ws', :'uo', '22220003-0000-4000-8000-000000000003', 'Cafe OTO',           'London',    'GB', 2400,   'GBP', 'confirmed', :'by'),
  ('8888000d-0000-4000-8000-00000000000d', :'ws', :'mm', '22220001-0000-4000-8000-000000000001', 'La Villette',        'Paris',     'FR', 4800,   'EUR', 'confirmed', :'by'),
  ('8888000e-0000-4000-8000-00000000000e', :'ws', :'mm', '22220001-0000-4000-8000-000000000001', 'Kampnagel',          'Hamburg',   'DE', 4400,   'EUR', 'confirmed', :'by'),
  ('8888000f-0000-4000-8000-00000000000f', :'ws', :'uo', '22220005-0000-4000-8000-000000000005', 'Teatro Juárez',      'Guanajuato','MX', 120000, 'MXN', 'confirmed', :'by'),
  ('88880010-0000-4000-8000-000000000010', :'ws', :'mm', '22220002-0000-4000-8000-000000000002', 'Teatre Principal',   'Terrassa',  'ES', 2600,   'EUR', 'confirmed', :'by'),
  ('88880011-0000-4000-8000-000000000011', :'ws', :'ze', '22220006-0000-4000-8000-000000000006', 'Kursaal',            'Manresa',   'ES', 2000,   'EUR', 'confirmed', :'by'),
  ('88880012-0000-4000-8000-000000000012', :'ws', :'uo', '22220003-0000-4000-8000-000000000003', 'Nau Ivanow',         'Barcelona', 'ES', 1900,   'EUR', 'confirmed', :'by'),
  -- a deal with no function yet: the row Books must still be able to draw
  ('88880013-0000-4000-8000-000000000013', :'ws', :'mm', NULL,                                   'Festival Grec',      'Barcelona', 'ES', 6500,   'EUR', 'proposed',  :'by')
ON CONFLICT (id) DO UPDATE SET fee_amount = EXCLUDED.fee_amount, fee_currency = EXCLUDED.fee_currency, status = EXCLUDED.status;

-- ---------------------------------------------------------------------------
-- 7 · Performances. Every status of the enum has a row; the conflict cases
--     are laid out on purpose and each one is named where it sits.
-- ---------------------------------------------------------------------------
INSERT INTO public.performance
  (id, workspace_id, project_id, line_id, bolo_id, performed_at, venue_id, venue_name, city, country, status, slug,
   created_by, load_in_at, soundcheck_at, start_at, loadout_at, wrap_at, hold_notice_days, readiness, notes)
VALUES
  -- ── the tail that already happened: Books needs history to have collected
  ('33330001-0000-4000-8000-000000000001', :'ws', :'mm', '22220002-0000-4000-8000-000000000002', '88880001-0000-4000-8000-000000000001', :t0 - 35,
   '11110003-0000-4000-8000-000000000003', 'Kursaal', 'Manresa', 'ES', 'paid', 'kursaal-passat', :'by',
   :t0 - 35 + time '15:00', :t0 - 35 + time '18:00', :t0 - 35 + time '20:00', :t0 - 35 + time '22:45', :t0 - 35 + time '23:30', NULL, '{"hotel":true,"technical":true}', NULL),
  ('33330002-0000-4000-8000-000000000002', :'ws', :'uo', '22220003-0000-4000-8000-000000000003', '88880002-0000-4000-8000-000000000002', :t0 - 21,
   '1111000c-0000-4000-8000-00000000000c', 'La Mutant', 'València', 'ES', 'invoiced', 'mutant-passat', :'by',
   NULL, :t0 - 21 + time '17:30', :t0 - 21 + time '20:00', NULL, NULL, NULL, '{"hotel":true,"technical":true}', NULL),
  ('33330003-0000-4000-8000-000000000003', :'ws', :'mm', NULL, '88880003-0000-4000-8000-000000000003', :t0 - 10,
   '1111000d-0000-4000-8000-00000000000d', 'Sala Ártica', 'Zaragoza', 'ES', 'done', 'artica-passat', :'by',
   NULL, NULL, :t0 - 10 + time '21:00', NULL, NULL, NULL, '{}', 'Van pagar en efectiu la mateixa nit.'),

  -- ── weekend 1 · a two-night run on ONE bolo, with the whole run sheet
  ('33330004-0000-4000-8000-000000000004', :'ws', :'mm', '22220002-0000-4000-8000-000000000002', '88880004-0000-4000-8000-000000000004', :f0,
   '11110001-0000-4000-8000-000000000001', 'Mercat de les Flors', 'Barcelona', 'ES', 'confirmed', 'flors-n1', :'by',
   :f0 + time '14:00', :f0 + time '17:30', :f0 + time '20:00', :f0 + time '22:30', :f0 + time '23:30', NULL, '{"hotel":true,"technical":false}', 'Càmera fixa al fons de la sala.'),
  ('33330005-0000-4000-8000-000000000005', :'ws', :'mm', '22220002-0000-4000-8000-000000000002', '88880004-0000-4000-8000-000000000004', :f0 + 1,
   '11110001-0000-4000-8000-000000000001', 'Mercat de les Flors', 'Barcelona', 'ES', 'confirmed', 'flors-n2', :'by',
   NULL, :f0 + 1 + time '16:00', :f0 + 1 + time '18:00', NULL, NULL, NULL, '{"hotel":true,"technical":true}', NULL),

  -- ── f0+7 · PEOPLE / RELEASE, urgent (one side confirmed, the other a hold
  --    that shares Anouk; notice 14 ⇒ decideBy already past)
  ('33330006-0000-4000-8000-000000000006', :'ws', :'uo', '22220003-0000-4000-8000-000000000003', '88880005-0000-4000-8000-000000000005', :f0 + 7,
   'bbbb0003-0000-4000-8000-000000000003', 'Nau Ivanow', 'Barcelona', 'ES', 'confirmed', 'ivanow-n1', :'by',
   :f0 + 7 + time '16:00', NULL, :f0 + 7 + time '20:30', NULL, NULL, NULL, '{"technical":true}', NULL),
  ('33330007-0000-4000-8000-000000000007', :'ws', :'mm', NULL, NULL, :f0 + 7,
   '11110002-0000-4000-8000-000000000002', 'Teatre Municipal', 'Girona', 'ES', 'hold_1', 'girona-hold', :'by',
   NULL, NULL, :f0 + 7 + time '20:00', NULL, NULL, 14, '{}', NULL),
  ('33330008-0000-4000-8000-000000000008', :'ws', :'uo', '22220003-0000-4000-8000-000000000003', '88880005-0000-4000-8000-000000000005', :f0 + 8,
   'bbbb0003-0000-4000-8000-000000000003', 'Nau Ivanow', 'Barcelona', 'ES', 'confirmed', 'ivanow-n2', :'by',
   NULL, NULL, :f0 + 8 + time '20:30', NULL, NULL, NULL, '{}', NULL),

  -- ── f0+14 · PEOPLE / CHOOSE, urgent (both hold, standard 30-day notice)
  ('33330009-0000-4000-8000-000000000009', :'ws', :'mm', NULL, NULL, :f0 + 14,
   '11110008-0000-4000-8000-000000000008', 'Kampnagel', 'Hamburg', 'DE', 'hold_1', 'kampnagel-hold', :'by',
   NULL, NULL, :f0 + 14 + time '20:00', NULL, NULL, NULL, '{}', NULL),
  ('3333000a-0000-4000-8000-00000000000a', :'ws', :'uo', NULL, NULL, :f0 + 14,
   '11110007-0000-4000-8000-000000000007', 'Teatro India', 'Roma', 'IT', 'hold_2', 'india-hold', :'by',
   NULL, NULL, :f0 + 14 + time '21:00', NULL, NULL, NULL, '{}', NULL),

  -- ── f0+21 · DOUBLE / RELEASE — one project, two rooms, one already firm
  ('3333000b-0000-4000-8000-00000000000b', :'ws', :'mm', '22220002-0000-4000-8000-000000000002', '88880006-0000-4000-8000-000000000006', :f0 + 21,
   'bbbb0001-0000-4000-8000-000000000001', 'Teatre Principal', 'Terrassa', 'ES', 'confirmed', 'terrassa-n1', :'by',
   :f0 + 21 + time '15:30', :f0 + 21 + time '18:00', :f0 + 21 + time '20:00', :f0 + 21 + time '22:30', NULL, NULL, '{"hotel":false,"technical":true}', NULL),
  ('3333000c-0000-4000-8000-00000000000c', :'ws', :'mm', NULL, NULL, :f0 + 21,
   '1111000b-0000-4000-8000-00000000000b', 'Azkuna Zentroa', 'Bilbao', 'ES', 'hold_2', 'azkuna-hold', :'by',
   NULL, NULL, :f0 + 21 + time '19:00', NULL, NULL, 45, '{}', NULL),

  -- ── f0+28 · POSSIBLE / CHOOSE, urgent — the draft project has no cast, so
  --    the engine refuses to assert people friction and says "possible"
  ('3333000d-0000-4000-8000-00000000000d', :'ws', :'op', NULL, NULL, :f0 + 28,
   '1111000d-0000-4000-8000-00000000000d', 'Sala Ártica', 'Zaragoza', 'ES', 'hold_1', 'artica-hold', :'by',
   NULL, NULL, :f0 + 28 + time '20:00', NULL, NULL, 120, '{}', NULL),
  ('3333000e-0000-4000-8000-00000000000e', :'ws', :'mm', NULL, '88880007-0000-4000-8000-000000000007', :f0 + 28,
   '11110009-0000-4000-8000-000000000009', 'Gessnerallee', 'Zürich', 'CH', 'hold_2', 'gessner-hold', :'by',
   NULL, NULL, :f0 + 28 + time '20:00', NULL, NULL, 0, '{}', 'Notice 0: un hold que no caduca mai sol.'),

  -- ── f0+42 · CONCURRENCE — two holds, known and DISJOINT teams. No crew
  --    here on purpose: one shared regidor would turn this red.
  ('3333000f-0000-4000-8000-00000000000f', :'ws', :'ze', NULL, NULL, :f0 + 42,
   '11110002-0000-4000-8000-000000000002', 'Teatre Municipal', 'Girona', 'ES', 'hold_1', 'zoo-girona-hold', :'by',
   NULL, NULL, :f0 + 42 + time '19:00', NULL, NULL, 30, '{}', NULL),
  ('33330010-0000-4000-8000-000000000010', :'ws', :'uo', NULL, NULL, :f0 + 42,
   '11110003-0000-4000-8000-000000000003', 'Kursaal', 'Manresa', 'ES', 'hold_3', 'kursaal-hold', :'by',
   NULL, NULL, :f0 + 42 + time '21:00', NULL, NULL, 30, '{}', NULL),

  -- ── f0+49/50 · DOUBLE / CHOOSE, and the day after a BLACKOUT (Jordi away)
  ('33330011-0000-4000-8000-000000000011', :'ws', :'mm', NULL, NULL, :f0 + 49,
   '1111000d-0000-4000-8000-00000000000d', 'Sala Ártica', 'Zaragoza', 'ES', 'hold_1', 'artica-hold-2', :'by',
   NULL, NULL, :f0 + 49 + time '20:30', NULL, NULL, 20, '{}', NULL),
  ('33330012-0000-4000-8000-000000000012', :'ws', :'mm', NULL, NULL, :f0 + 49,
   '11110002-0000-4000-8000-000000000002', 'Teatre Municipal', 'Girona', 'ES', 'hold_3', 'girona-hold-2', :'by',
   NULL, NULL, :f0 + 49 + time '20:00', NULL, NULL, 20, '{}', NULL),
  ('33330013-0000-4000-8000-000000000013', :'ws', :'mm', '22220002-0000-4000-8000-000000000002', '88880008-0000-4000-8000-000000000008', :f0 + 50,
   '11110003-0000-4000-8000-000000000003', 'Kursaal', 'Manresa', 'ES', 'confirmed', 'kursaal-n1', :'by',
   :f0 + 50 + time '15:00', :f0 + 50 + time '18:00', :f0 + 50 + time '20:00', :f0 + 50 + time '23:00', NULL, NULL, '{"hotel":true,"technical":true}', NULL),

  -- ── f0+56..58 · the première: two firm nights and a third still proposed
  ('33330014-0000-4000-8000-000000000014', :'ws', :'ze', '22220006-0000-4000-8000-000000000006', '88880009-0000-4000-8000-000000000009', :f0 + 56,
   '11110001-0000-4000-8000-000000000001', 'Mercat de les Flors', 'Barcelona', 'ES', 'confirmed', 'zoo-estrena', :'by',
   :f0 + 56 + time '10:00', :f0 + 56 + time '17:00', :f0 + 56 + time '20:00', :f0 + 56 + time '23:00', :f0 + 56 + time '23:59', NULL, '{"hotel":true,"technical":true}', 'Estrena. Ve tothom.'),
  ('33330015-0000-4000-8000-000000000015', :'ws', :'ze', '22220006-0000-4000-8000-000000000006', '88880009-0000-4000-8000-000000000009', :f0 + 57,
   '11110001-0000-4000-8000-000000000001', 'Mercat de les Flors', 'Barcelona', 'ES', 'confirmed', 'zoo-n2', :'by',
   NULL, :f0 + 57 + time '17:00', :f0 + 57 + time '20:00', NULL, NULL, NULL, '{"technical":true}', NULL),
  ('33330016-0000-4000-8000-000000000016', :'ws', :'ze', '22220006-0000-4000-8000-000000000006', NULL, :f0 + 58,
   NULL, NULL, NULL, NULL, 'proposed', 'zoo-n3', :'by',
   NULL, NULL, NULL, NULL, NULL, NULL, '{}', 'Tercera funció encara sense sala ni hora.'),

  -- ── f0+63..68 · the Europe tour: outbound, gig, leg, gig, return
  ('33330017-0000-4000-8000-000000000017', :'ws', :'uo', '22220004-0000-4000-8000-000000000004', '8888000a-0000-4000-8000-00000000000a', :f0 + 64,
   '11110004-0000-4000-8000-000000000004', 'Teatro Maria Matos', 'Lisboa', 'PT', 'confirmed', 'matos-gig', :'by',
   :f0 + 64 + time '14:00', :f0 + 64 + time '18:00', :f0 + 64 + time '21:00', NULL, NULL, NULL, '{"hotel":true,"technical":true}', NULL),
  ('33330018-0000-4000-8000-000000000018', :'ws', :'uo', '22220004-0000-4000-8000-000000000004', '8888000b-0000-4000-8000-00000000000b', :f0 + 66,
   '11110005-0000-4000-8000-000000000005', 'Teatro Rivoli', 'Porto', 'PT', 'confirmed', 'rivoli-gig', :'by',
   :f0 + 66 + time '13:00', :f0 + 66 + time '17:00', :f0 + 66 + time '21:30', NULL, NULL, NULL, '{"hotel":true,"technical":false}', NULL),

  -- ── f0+72 · BLACKOUT-TENTATIVE (Nils has a maybe that week)
  ('33330019-0000-4000-8000-000000000019', :'ws', :'uo', '22220003-0000-4000-8000-000000000003', '8888000c-0000-4000-8000-00000000000c', :f0 + 72,
   'bbbb0002-0000-4000-8000-000000000002', 'Cafe OTO', 'London', 'GB', 'confirmed', 'oto-gig', :'by',
   :f0 + 72 + time '15:00', NULL, :f0 + 72 + time '20:00', NULL, NULL, NULL, '{"hotel":false,"technical":true}', NULL),

  -- ── f0+77 · POSSIBLE / CHOOSE, NOT urgent (notice 14 ⇒ decideBy in the future)
  ('3333001a-0000-4000-8000-00000000001a', :'ws', :'op', NULL, NULL, :f0 + 77,
   'bbbb0003-0000-4000-8000-000000000003', 'Nau Ivanow', 'Barcelona', 'ES', 'hold_1', 'ivanow-hold', :'by',
   NULL, NULL, :f0 + 77 + time '20:00', NULL, NULL, 14, '{}', NULL),
  ('3333001b-0000-4000-8000-00000000001b', :'ws', :'mm', NULL, NULL, :f0 + 77,
   '1111000c-0000-4000-8000-00000000000c', 'La Mutant', 'València', 'ES', 'hold_2', 'mutant-hold', :'by',
   NULL, NULL, :f0 + 77 + time '19:30', NULL, NULL, 14, '{}', NULL),

  -- ── f0+88 · inside the company-wide blackout
  ('3333001c-0000-4000-8000-00000000001c', :'ws', :'mm', NULL, NULL, :f0 + 88,
   '11110006-0000-4000-8000-000000000006', 'La Villette', 'Paris', 'FR', 'hold_1', 'villette-hold', :'by',
   NULL, NULL, :f0 + 88 + time '20:30', NULL, NULL, 30, '{}', NULL),

  -- ── f0+90 · PEOPLE / CHOOSE, NOT urgent
  ('3333001d-0000-4000-8000-00000000001d', :'ws', :'mm', NULL, NULL, :f0 + 90,
   'bbbb0001-0000-4000-8000-000000000001', 'Teatre Principal', 'Terrassa', 'ES', 'hold_1', 'terrassa-hold', :'by',
   NULL, NULL, :f0 + 90 + time '20:00', NULL, NULL, 30, '{}', NULL),
  ('3333001e-0000-4000-8000-00000000001e', :'ws', :'uo', NULL, NULL, :f0 + 90,
   '11110003-0000-4000-8000-000000000003', 'Kursaal', 'Manresa', 'ES', 'hold_2', 'kursaal-hold-2', :'by',
   NULL, NULL, :f0 + 90 + time '21:00', NULL, NULL, 30, '{}', NULL),

  -- ── a cancelled gig: it is drawn, and it is not a decision
  ('3333001f-0000-4000-8000-00000000001f', :'ws', :'mm', NULL, NULL, :f0 + 95,
   '1111000d-0000-4000-8000-00000000000d', 'Sala Ártica', 'Zaragoza', 'ES', 'cancelled', 'artica-cancel', :'by',
   NULL, NULL, :f0 + 95 + time '20:00', NULL, NULL, NULL, '{}', 'La sala va tancar per obres.'),

  ('33330020-0000-4000-8000-000000000020', :'ws', :'ze', '22220006-0000-4000-8000-000000000006', '88880011-0000-4000-8000-000000000011', :f0 + 105,
   '11110003-0000-4000-8000-000000000003', 'Kursaal', 'Manresa', 'ES', 'confirmed', 'zoo-kursaal', :'by',
   :f0 + 105 + time '15:00', NULL, :f0 + 105 + time '19:00', NULL, NULL, NULL, '{"hotel":false,"technical":true}', NULL),
  ('33330021-0000-4000-8000-000000000021', :'ws', :'mm', '22220002-0000-4000-8000-000000000002', '88880010-0000-4000-8000-000000000010', :f0 + 112,
   'bbbb0001-0000-4000-8000-000000000001', 'Teatre Principal', 'Terrassa', 'ES', 'confirmed', 'terrassa-n2', :'by',
   NULL, :f0 + 112 + time '18:00', :f0 + 112 + time '20:00', NULL, NULL, NULL, '{"hotel":true,"technical":true}', NULL),

  -- ── f0+120..127 · the autumn tour: two outbounds and ONE return (the
  --    bracket rule — only the second outbound gets paired)
  ('33330022-0000-4000-8000-000000000022', :'ws', :'mm', '22220001-0000-4000-8000-000000000001', '8888000d-0000-4000-8000-00000000000d', :f0 + 121,
   '11110006-0000-4000-8000-000000000006', 'La Villette', 'Paris', 'FR', 'confirmed', 'villette-gig', :'by',
   :f0 + 121 + time '13:00', :f0 + 121 + time '17:00', :f0 + 121 + time '20:30', NULL, NULL, NULL, '{"hotel":true,"technical":true}', NULL),
  ('33330023-0000-4000-8000-000000000023', :'ws', :'mm', '22220001-0000-4000-8000-000000000001', '8888000e-0000-4000-8000-00000000000e', :f0 + 126,
   '11110008-0000-4000-8000-000000000008', 'Kampnagel', 'Hamburg', 'DE', 'confirmed', 'kampnagel-gig', :'by',
   :f0 + 126 + time '12:00', :f0 + 126 + time '17:00', :f0 + 126 + time '20:00', NULL, NULL, NULL, '{"hotel":true,"technical":true}', NULL),

  ('33330024-0000-4000-8000-000000000024', :'ws', :'uo', '22220003-0000-4000-8000-000000000003', '88880012-0000-4000-8000-000000000012', :f0 + 133,
   'bbbb0003-0000-4000-8000-000000000003', 'Nau Ivanow', 'Barcelona', 'ES', 'confirmed', 'ivanow-n3', :'by',
   NULL, NULL, :f0 + 133 + time '20:30', NULL, NULL, NULL, '{"technical":true}', NULL),
  ('33330025-0000-4000-8000-000000000025', :'ws', :'ze', NULL, NULL, :f0 + 140,
   '11110009-0000-4000-8000-000000000009', 'Gessnerallee', 'Zürich', 'CH', 'proposed', 'zoo-zurich', :'by',
   NULL, NULL, NULL, NULL, NULL, NULL, '{}', NULL),
  ('33330026-0000-4000-8000-000000000026', :'ws', :'ze', NULL, NULL, :f0 + 147,
   '11110007-0000-4000-8000-000000000007', 'Teatro India', 'Roma', 'IT', 'proposed', 'zoo-roma', :'by',
   NULL, NULL, NULL, NULL, NULL, NULL, '{}', NULL),

  -- ── f0+152/153 · Mexico: two functions on one bolo, seven hours away
  ('33330027-0000-4000-8000-000000000027', :'ws', :'uo', '22220005-0000-4000-8000-000000000005', '8888000f-0000-4000-8000-00000000000f', :f0 + 152,
   '1111000a-0000-4000-8000-00000000000a', 'Teatro Juárez', 'Guanajuato', 'MX', 'confirmed', 'juarez-n1', :'by',
   :f0 + 152 + time '10:00', :f0 + 152 + time '16:00', :f0 + 152 + time '20:00', NULL, NULL, NULL, '{"hotel":true,"technical":false}', NULL),
  ('33330028-0000-4000-8000-000000000028', :'ws', :'uo', '22220005-0000-4000-8000-000000000005', '8888000f-0000-4000-8000-00000000000f', :f0 + 153,
   '1111000a-0000-4000-8000-00000000000a', 'Teatro Juárez', 'Guanajuato', 'MX', 'confirmed', 'juarez-n2', :'by',
   NULL, NULL, :f0 + 153 + time '18:00', NULL, NULL, NULL, '{"hotel":true,"technical":true}', NULL),

  -- ── the far horizon: the bare 'hold' status, a long-notice hold, a proposal
  ('33330029-0000-4000-8000-000000000029', :'ws', :'mm', NULL, NULL, :f0 + 161,
   '11110002-0000-4000-8000-000000000002', 'Teatre Municipal', 'Girona', 'ES', 'hold', 'girona-hold-3', :'by',
   NULL, NULL, :f0 + 161 + time '20:00', NULL, NULL, 30, '{}', NULL),
  ('3333002a-0000-4000-8000-00000000002a', :'ws', :'uo', NULL, NULL, :f0 + 168,
   '1111000b-0000-4000-8000-00000000000b', 'Azkuna Zentroa', 'Bilbao', 'ES', 'hold_1', 'azkuna-hold-2', :'by',
   NULL, NULL, :f0 + 168 + time '19:30', NULL, NULL, 60, '{}', NULL),
  ('3333002b-0000-4000-8000-00000000002b', :'ws', :'mm', '22220002-0000-4000-8000-000000000002', NULL, :f0 + 175,
   '11110001-0000-4000-8000-000000000001', 'Mercat de les Flors', 'Barcelona', 'ES', 'proposed', 'flors-2027', :'by',
   NULL, NULL, NULL, NULL, NULL, NULL, '{}', 'Proposta per tancar la temporada.')
ON CONFLICT (id) DO UPDATE SET
  performed_at = EXCLUDED.performed_at, status = EXCLUDED.status, line_id = EXCLUDED.line_id,
  bolo_id = EXCLUDED.bolo_id, venue_id = EXCLUDED.venue_id, venue_name = EXCLUDED.venue_name,
  city = EXCLUDED.city, country = EXCLUDED.country,
  load_in_at = EXCLUDED.load_in_at, soundcheck_at = EXCLUDED.soundcheck_at,
  start_at = EXCLUDED.start_at, loadout_at = EXCLUDED.loadout_at, wrap_at = EXCLUDED.wrap_at,
  hold_notice_days = EXCLUDED.hold_notice_days, readiness = EXCLUDED.readiness, notes = EXCLUDED.notes;

-- ---------------------------------------------------------------------------
-- 8 · Dates — every kind, every status, and the travel legs that make (and
--     deliberately fail to make) away bands.
-- ---------------------------------------------------------------------------
INSERT INTO public.date
  (id, workspace_id, project_id, line_id, kind, status, title, starts_at, ends_at, all_day, city, country, travel_direction, notes, created_by)
VALUES
  ('44440001-0000-4000-8000-000000000001', :'ws', :'mm', '22220002-0000-4000-8000-000000000002', 'rehearsal', 'done',      'Assaig de repàs',        :t0 - 3 + time '10:00', :t0 - 3 + time '14:00', false, 'Barcelona', 'ES', NULL, NULL, :'by'),
  ('44440002-0000-4000-8000-000000000002', :'ws', :'mm', NULL, 'other',     'confirmed', 'Reunió de producció',    :t0 + time '10:00',     :t0 + time '11:30',     false, 'Barcelona', 'ES', NULL, 'Pressupost del trimestre.', :'by'),
  ('44440003-0000-4000-8000-000000000003', :'ws', :'uo', '22220003-0000-4000-8000-000000000003', 'rehearsal', 'confirmed', 'Assaig',                 :t0 + 1 + time '10:00', :t0 + 1 + time '14:00', false, 'Barcelona', 'ES', NULL, NULL, :'by'),
  ('44440004-0000-4000-8000-000000000004', :'ws', :'uo', '22220003-0000-4000-8000-000000000003', 'rehearsal', 'confirmed', 'Assaig',                 :t0 + 2 + time '10:00', :t0 + 2 + time '14:00', false, 'Barcelona', 'ES', NULL, NULL, :'by'),
  ('44440005-0000-4000-8000-000000000005', :'ws', :'mm', NULL, 'press',     'tentative', 'Entrevista · Núvol',     :t0 + 3 + time '12:00', :t0 + 3 + time '12:45', false, 'Barcelona', 'ES', NULL, NULL, :'by'),
  ('44440006-0000-4000-8000-000000000006', :'ws', :'mm', '22220002-0000-4000-8000-000000000002', 'rehearsal', 'confirmed', 'Assaig general',         :f0 - 1 + time '10:00', :f0 - 1 + time '15:00', false, 'Barcelona', 'ES', NULL, NULL, :'by'),
  ('44440007-0000-4000-8000-000000000007', :'ws', :'mm', NULL, 'day_off',   'confirmed', NULL,                     :f0 + 2 + time '00:00', NULL,                   true,  NULL, NULL, NULL, NULL, :'by'),
  -- a four-day residency: the prep run at its longest
  ('44440008-0000-4000-8000-000000000008', :'ws', :'ze', '22220007-0000-4000-8000-000000000007', 'residency', 'confirmed', 'Residència Graner',      :f0 + 3 + time '09:30', :f0 + 3 + time '18:00', false, 'Barcelona', 'ES', NULL, NULL, :'by'),
  ('44440009-0000-4000-8000-000000000009', :'ws', :'ze', '22220007-0000-4000-8000-000000000007', 'residency', 'confirmed', 'Residència Graner',      :f0 + 4 + time '09:30', :f0 + 4 + time '18:00', false, 'Barcelona', 'ES', NULL, NULL, :'by'),
  ('4444000a-0000-4000-8000-00000000000a', :'ws', :'ze', '22220007-0000-4000-8000-000000000007', 'residency', 'confirmed', 'Residència Graner',      :f0 + 5 + time '09:30', :f0 + 5 + time '18:00', false, 'Barcelona', 'ES', NULL, NULL, :'by'),
  ('4444000b-0000-4000-8000-00000000000b', :'ws', :'ze', '22220007-0000-4000-8000-000000000007', 'residency', 'confirmed', 'Residència Graner',      :f0 + 6 + time '09:30', :f0 + 6 + time '14:00', false, 'Barcelona', 'ES', NULL, 'Mostra oberta a les 12.', :'by'),
  ('4444000c-0000-4000-8000-00000000000c', :'ws', :'ze', '22220006-0000-4000-8000-000000000006', 'rehearsal', 'confirmed', 'Assaig Zoo',             :f0 + 10 + time '10:00', :f0 + 10 + time '15:00', false, 'Barcelona', 'ES', NULL, NULL, :'by'),
  ('4444000d-0000-4000-8000-00000000000d', :'ws', :'ze', '22220006-0000-4000-8000-000000000006', 'rehearsal', 'tentative', 'Assaig Zoo',             :f0 + 17 + time '10:00', :f0 + 17 + time '15:00', false, 'Barcelona', 'ES', NULL, NULL, :'by'),
  ('4444000e-0000-4000-8000-00000000000e', :'ws', :'ze', '22220006-0000-4000-8000-000000000006', 'rehearsal', 'cancelled', 'Assaig Zoo',             :f0 + 24 + time '10:00', :f0 + 24 + time '15:00', false, 'Barcelona', 'ES', NULL, 'Anul·lat: la sala no estava.', :'by'),
  ('4444000f-0000-4000-8000-00000000000f', :'ws', :'mm', NULL, 'press',     'confirmed', 'Sessió de fotos',        :f0 + 30 + time '11:00', :f0 + 30 + time '13:00', false, 'Barcelona', 'ES', NULL, NULL, :'by'),
  -- a line-less pair of travel days: the band pairs per project
  ('44440010-0000-4000-8000-000000000010', :'ws', :'mm', NULL, 'travel_day','confirmed', 'Viatge d''anada',        :f0 + 35 + time '08:00', NULL,                    true,  'Madrid', 'ES', 'outbound', NULL, :'by'),
  ('44440011-0000-4000-8000-000000000011', :'ws', :'mm', NULL, 'travel_day','confirmed', 'Tornada',                :f0 + 38 + time '19:00', NULL,                    true,  'Barcelona', 'ES', 'return', NULL, :'by'),
  ('44440012-0000-4000-8000-000000000012', :'ws', :'ze', NULL, 'day_off',   'confirmed', NULL,                     :f0 + 44 + time '00:00', NULL,                    true,  NULL, NULL, NULL, NULL, :'by'),
  ('44440013-0000-4000-8000-000000000013', :'ws', :'ze', '22220006-0000-4000-8000-000000000006', 'press',     'confirmed', 'Roda de premsa · estrena', :f0 + 54 + time '11:00', :f0 + 54 + time '12:00', false, 'Barcelona', 'ES', NULL, NULL, :'by'),
  ('44440014-0000-4000-8000-000000000014', :'ws', :'ze', '22220006-0000-4000-8000-000000000006', 'other',     'confirmed', 'Muntatge i tècnica',     :f0 + 55 + time '09:00', :f0 + 55 + time '20:00', false, 'Barcelona', 'ES', NULL, NULL, :'by'),
  -- the Europe tour: outbound · gig · leg · gig · return  ⇒ two split bands
  ('44440015-0000-4000-8000-000000000015', :'ws', :'uo', '22220004-0000-4000-8000-000000000004', 'travel_day','confirmed', 'Vol BCN → LIS',          :f0 + 63 + time '07:30', NULL,                    true,  'Lisboa', 'PT', 'outbound', NULL, :'by'),
  ('44440016-0000-4000-8000-000000000016', :'ws', :'uo', '22220004-0000-4000-8000-000000000004', 'travel_day','confirmed', 'Lisboa → Porto',         :f0 + 65 + time '11:00', NULL,                    true,  'Porto', 'PT', 'leg', 'Tren. Un leg ni obre ni tanca viatge.', :'by'),
  ('44440017-0000-4000-8000-000000000017', :'ws', :'uo', '22220004-0000-4000-8000-000000000004', 'travel_day','confirmed', 'Vol OPO → BCN',          :f0 + 68 + time '18:00', NULL,                    true,  'Barcelona', 'ES', 'return', NULL, :'by'),
  ('44440018-0000-4000-8000-000000000018', :'ws', :'uo', NULL, 'day_off',   'confirmed', NULL,                     :f0 + 70 + time '00:00', NULL,                    true,  NULL, NULL, NULL, NULL, :'by'),
  ('44440019-0000-4000-8000-000000000019', :'ws', :'mm', '22220002-0000-4000-8000-000000000002', 'rehearsal', 'confirmed', 'Assaig de recuperació',  :f0 + 80 + time '10:00', :f0 + 80 + time '14:00', false, 'Barcelona', 'ES', NULL, NULL, :'by'),
  ('4444001a-0000-4000-8000-00000000001a', :'ws', :'mm', '22220002-0000-4000-8000-000000000002', 'rehearsal', 'confirmed', 'Assaig de recuperació',  :f0 + 81 + time '10:00', :f0 + 81 + time '14:00', false, 'Barcelona', 'ES', NULL, NULL, :'by'),
  ('4444001b-0000-4000-8000-00000000001b', :'ws', :'mm', '22220002-0000-4000-8000-000000000002', 'rehearsal', 'tentative', 'Assaig de recuperació',  :f0 + 82 + time '10:00', :f0 + 82 + time '14:00', false, 'Barcelona', 'ES', NULL, NULL, :'by'),
  ('4444001c-0000-4000-8000-00000000001c', :'ws', :'uo', NULL, 'other',     'confirmed', 'Assemblea de la cia',    :f0 + 92 + time '17:00', :f0 + 92 + time '20:00', false, 'Barcelona', 'ES', NULL, NULL, :'by'),
  -- an outbound with NO return: honest silence, no band
  ('4444001d-0000-4000-8000-00000000001d', :'ws', :'mm', NULL, 'travel_day','tentative', 'Anada sense tornada encara', :f0 + 100 + time '09:00', NULL,               true,  'Sevilla', 'ES', 'outbound', 'Falta la tornada: el planner NO ha de dibuixar banda.', :'by'),
  ('4444001e-0000-4000-8000-00000000001e', :'ws', :'ze', '22220006-0000-4000-8000-000000000006', 'residency', 'confirmed', 'Residència de revisió',  :f0 + 110 + time '10:00', :f0 + 110 + time '18:00', false, 'Girona', 'ES', NULL, NULL, :'by'),
  ('4444001f-0000-4000-8000-00000000001f', :'ws', :'ze', '22220006-0000-4000-8000-000000000006', 'residency', 'confirmed', 'Residència de revisió',  :f0 + 111 + time '10:00', :f0 + 111 + time '18:00', false, 'Girona', 'ES', NULL, NULL, :'by'),
  ('44440020-0000-4000-8000-000000000020', :'ws', :'ze', '22220006-0000-4000-8000-000000000006', 'residency', 'confirmed', 'Residència de revisió',  :f0 + 112 + time '10:00', :f0 + 112 + time '18:00', false, 'Girona', 'ES', NULL, NULL, :'by'),
  -- two outbounds, one return: brackets — only the SECOND one gets paired
  ('44440021-0000-4000-8000-000000000021', :'ws', :'mm', '22220001-0000-4000-8000-000000000001', 'travel_day','confirmed', 'Vol BCN → CDG',          :f0 + 120 + time '07:00', NULL,                   true,  'Paris', 'FR', 'outbound', 'Aquesta anada es queda òrfena a propòsit.', :'by'),
  ('44440022-0000-4000-8000-000000000022', :'ws', :'mm', '22220001-0000-4000-8000-000000000001', 'travel_day','confirmed', 'Tren CDG → HAM',         :f0 + 124 + time '08:00', NULL,                   true,  'Hamburg', 'DE', 'outbound', NULL, :'by'),
  ('44440023-0000-4000-8000-000000000023', :'ws', :'mm', '22220001-0000-4000-8000-000000000001', 'travel_day','confirmed', 'Vol HAM → BCN',          :f0 + 127 + time '17:00', NULL,                   true,  'Barcelona', 'ES', 'return', NULL, :'by'),
  ('44440024-0000-4000-8000-000000000024', :'ws', :'uo', '22220003-0000-4000-8000-000000000003', 'rehearsal', 'confirmed', 'Assaig de represa',      :f0 + 134 + time '10:00', :f0 + 134 + time '14:00', false, 'Barcelona', 'ES', NULL, NULL, :'by'),
  ('44440025-0000-4000-8000-000000000025', :'ws', :'uo', '22220005-0000-4000-8000-000000000005', 'press',     'tentative', 'Presentació a premsa MX',:f0 + 145 + time '12:00', :f0 + 145 + time '13:00', false, 'Barcelona', 'ES', NULL, NULL, :'by'),
  -- the long-haul: outbound, two gigs, return ⇒ a band with holes
  ('44440026-0000-4000-8000-000000000026', :'ws', :'uo', '22220005-0000-4000-8000-000000000005', 'travel_day','confirmed', 'Vol BCN → BJX',          :f0 + 150 + time '06:00', NULL,                   true,  'Guanajuato', 'MX', 'outbound', NULL, :'by'),
  ('44440027-0000-4000-8000-000000000027', :'ws', :'uo', '22220005-0000-4000-8000-000000000005', 'travel_day','confirmed', 'Vol BJX → BCN',          :f0 + 156 + time '15:00', NULL,                   true,  'Barcelona', 'ES', 'return', NULL, :'by'),
  ('44440028-0000-4000-8000-000000000028', :'ws', :'mm', NULL, 'other',     'tentative', 'Reunió amb l''ICEC',     :f0 + 170 + time '10:00', :f0 + 170 + time '11:00', false, 'Barcelona', 'ES', NULL, 'Justificació de la subvenció.', :'by')
ON CONFLICT (id) DO UPDATE SET
  starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, status = EXCLUDED.status,
  kind = EXCLUDED.kind, line_id = EXCLUDED.line_id, all_day = EXCLUDED.all_day,
  travel_direction = EXCLUDED.travel_direction, title = EXCLUDED.title, notes = EXCLUDED.notes;

-- ---------------------------------------------------------------------------
-- 9 · Absences. Both certainties, one for the whole company, one that spans
--     today, one single day, three that overlap (so the bands have to stack
--     into lanes) and one 26-day band that crosses weeks, the month edge and
--     the fold.
-- ---------------------------------------------------------------------------
INSERT INTO public.availability_block (id, workspace_id, person_id, starts_on, ends_on, certainty, note, created_by) VALUES
  ('55550001-0000-4000-8000-000000000001', :'ws', 'a0000002-0000-4000-8000-000000000002', :f0 + 47,  :f0 + 52,  'unavailable', 'gira amb una altra cia', :'by'),
  ('55550002-0000-4000-8000-000000000002', :'ws', 'a0000004-0000-4000-8000-000000000004', :f0 + 70,  :f0 + 76,  'tentative',   'possible boda',          :'by'),
  ('55550003-0000-4000-8000-000000000003', :'ws', NULL,                                   :f0 + 85,  :f0 + 93,  'unavailable', 'tancat per vacances',    :'by'),
  ('55550004-0000-4000-8000-000000000004', :'ws', 'a0000005-0000-4000-8000-000000000005', :f0 + 103, :f0 + 128, 'unavailable', 'baixa mèdica',           :'by'),
  ('55550005-0000-4000-8000-000000000005', :'ws', '12340001-0000-4000-8000-000000000001', :f0 + 60,  :f0 + 66,  'unavailable', 'fora',                   :'by'),
  ('55550006-0000-4000-8000-000000000006', :'ws', '12340002-0000-4000-8000-000000000002', :f0 + 63,  :f0 + 70,  'tentative',   'potser un rodatge',      :'by'),
  ('55550007-0000-4000-8000-000000000007', :'ws', '12340003-0000-4000-8000-000000000003', :f0 + 64,  :f0 + 65,  'unavailable', 'curs',                   :'by'),
  ('55550008-0000-4000-8000-000000000008', :'ws', '12340004-0000-4000-8000-000000000004', :f0 + 33,  :f0 + 33,  'unavailable', 'metge',                  :'by'),
  ('55550009-0000-4000-8000-000000000009', :'ws', 'a0000004-0000-4000-8000-000000000004', :t0 - 2,   :t0 + 4,   'unavailable', 'assumptes personals',    :'by'),
  ('5555000a-0000-4000-8000-00000000000a', :'ws', 'a0000001-0000-4000-8000-000000000001', :f0 + 160, :f0 + 166, 'tentative',   'possible projecte propi',:'by'),
  ('5555000b-0000-4000-8000-00000000000b', :'ws', 'a0000003-0000-4000-8000-000000000003', :f0 + 137, :f0 + 141, 'unavailable', 'fora',                   :'by')
ON CONFLICT (id) DO UPDATE SET
  starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on,
  certainty = EXCLUDED.certainty, note = EXCLUDED.note;

-- ---------------------------------------------------------------------------
-- 10 · Crew and substitutions. NOTE: the f0+42 pair carries no crew on
--      purpose — a single shared regidor would turn its concurrence red.
-- ---------------------------------------------------------------------------
INSERT INTO public.crew_assignment (id, workspace_id, performance_id, person_id, role, notes, created_by) VALUES
  ('9e9e0001-0000-4000-8000-000000000001', :'ws', '33330004-0000-4000-8000-000000000004', '12340003-0000-4000-8000-000000000003', 'sound',     NULL, :'by'),
  ('9e9e0002-0000-4000-8000-000000000002', :'ws', '33330004-0000-4000-8000-000000000004', '12340004-0000-4000-8000-000000000004', 'stage_manager', NULL, :'by'),
  ('9e9e0003-0000-4000-8000-000000000003', :'ws', '33330005-0000-4000-8000-000000000005', '12340003-0000-4000-8000-000000000003', 'sound',     NULL, :'by'),
  ('9e9e0004-0000-4000-8000-000000000004', :'ws', '33330014-0000-4000-8000-000000000014', '12340004-0000-4000-8000-000000000004', 'stage_manager', 'Estrena: arriba a les 9.', :'by'),
  ('9e9e0005-0000-4000-8000-000000000005', :'ws', '33330015-0000-4000-8000-000000000015', '12340004-0000-4000-8000-000000000004', 'stage_manager', NULL, :'by'),
  ('9e9e0006-0000-4000-8000-000000000006', :'ws', '33330017-0000-4000-8000-000000000017', '12340004-0000-4000-8000-000000000004', 'stage_manager', NULL, :'by'),
  ('9e9e0007-0000-4000-8000-000000000007', :'ws', '33330018-0000-4000-8000-000000000018', '12340004-0000-4000-8000-000000000004', 'stage_manager', NULL, :'by'),
  ('9e9e0008-0000-4000-8000-000000000008', :'ws', '33330013-0000-4000-8000-000000000013', '12340003-0000-4000-8000-000000000003', 'sound',     NULL, :'by')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, notes = EXCLUDED.notes;

INSERT INTO public.cast_override (id, workspace_id, performance_id, person_id, role, replaces_person_id, reason, created_by) VALUES
  ('9f9f0001-0000-4000-8000-000000000001', :'ws', '3333000b-0000-4000-8000-00000000000b', '12340001-0000-4000-8000-000000000001', 'performer',
   'a0000001-0000-4000-8000-000000000001', 'L''Anouk té un compromís familiar', :'by'),
  -- the substitution that CANCELS a blackout: Laia is on sick leave f0+103..128,
  -- so Tomàs covers f0+126 — the Hamburg gig stops being red, Paris stays red.
  ('9f9f0002-0000-4000-8000-000000000002', :'ws', '33330023-0000-4000-8000-000000000023', '12340002-0000-4000-8000-000000000002', 'technician',
   'a0000005-0000-4000-8000-000000000005', 'Baixa de la Laia', :'by')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, reason = EXCLUDED.reason;

-- ---------------------------------------------------------------------------
-- 11 · Conversations — the seven statuses, with last contact and next action
--      spread across overdue, today and future.
-- ---------------------------------------------------------------------------
INSERT INTO public.conversation
  (id, workspace_id, project_id, person_id, slug, status, role, first_contacted_at, last_contacted_at, next_action_at, next_action_note, line_id, created_by)
VALUES
  ('9d9d0001-0000-4000-8000-000000000001', :'ws', :'mm', '12350001-0000-4000-8000-000000000001', 'marta-puig-mamemi',   'confirmed',       'programadora', :t0 - 90 + time '10:00', :t0 + time '09:30',      :t0 + 14 + time '10:00', 'Enviar road sheet i fitxa tècnica.', '22220002-0000-4000-8000-000000000002', :'by'),
  ('9d9d0002-0000-4000-8000-000000000002', :'ws', :'uo', '12350002-0000-4000-8000-000000000002', 'helder-costa-orbita', 'in_conversation', 'director',     :t0 - 60 + time '11:00', :t0 - 5 + time '17:00',  :t0 + 2 + time '10:00',  'Confirmar dietes i hotel per la gira.', '22220004-0000-4000-8000-000000000004', :'by'),
  ('9d9d0003-0000-4000-8000-000000000003', :'ws', :'mm', '12350003-0000-4000-8000-000000000003', 'claire-villette',     'hold',            'programmation',:t0 - 120 + time '09:00',:t0 - 20 + time '12:00', :t0 - 3 + time '10:00',  'Fa tres dies que havia de respondre.', '22220001-0000-4000-8000-000000000001', :'by'),
  ('9d9d0004-0000-4000-8000-000000000004', :'ws', :'uo', '12350004-0000-4000-8000-000000000004', 'gio-india',           'contacted',       NULL,           :t0 - 8 + time '16:00',  :t0 - 8 + time '16:00',  :t0 + 7 + time '10:00',  'Segona trucada si no respon.', NULL, :'by'),
  ('9d9d0005-0000-4000-8000-000000000005', :'ws', :'uo', '12350005-0000-4000-8000-000000000005', 'sam-oto',             'confirmed',       'bookings',     :t0 - 150 + time '10:00',:t0 - 30 + time '10:00', NULL, NULL, '22220003-0000-4000-8000-000000000003', :'by'),
  ('9d9d0006-0000-4000-8000-000000000006', :'ws', :'mm', '12350006-0000-4000-8000-000000000006', 'ana-azkuna',          'declined',        'programación', :t0 - 200 + time '10:00',:t0 - 45 + time '10:00', NULL, 'Aquesta temporada no hi ha pressupost.', NULL, :'by'),
  ('9d9d0007-0000-4000-8000-000000000007', :'ws', :'uo', '12350007-0000-4000-8000-000000000007', 'lucia-cervantino',    'recurring',       'programación', :t0 - 400 + time '10:00',:t0 - 12 + time '18:00', :t0 + 30 + time '10:00', 'Tancar contracte del FIC.', '22220005-0000-4000-8000-000000000005', :'by'),
  ('9d9d0008-0000-4000-8000-000000000008', :'ws', :'ze', '12350001-0000-4000-8000-000000000001', 'marta-puig-zoo',      'dormant',         'programadora', :t0 - 300 + time '10:00',:t0 - 180 + time '10:00',NULL, 'Reprendre quan hi hagi vídeo de l''estrena.', NULL, :'by')
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status, last_contacted_at = EXCLUDED.last_contacted_at,
  next_action_at = EXCLUDED.next_action_at, next_action_note = EXCLUDED.next_action_note;

-- ---------------------------------------------------------------------------
-- 12 · Invoices, taxes and payments. Numbers are correlative and the series
--      counter is left where the next `issue_invoice` would continue.
--      `status` is never re-written on conflict: paid is DERIVED from
--      payments and its trigger would refuse the downgrade.
-- ---------------------------------------------------------------------------
INSERT INTO public.invoice
  (id, workspace_id, project_id, number, doc_type, issued_on, due_on, expected_on, status, subtotal, total, currency,
   issuer_fiscal_identity_id, payer_fiscal_identity_id, issuer_snapshot, payer_snapshot, payment_condition, country, notes, created_by)
VALUES
  -- paid in full (the payment below flips it)
  ('99990001-0000-4000-8000-000000000001', :'ws', :'mm', 'FAC 2026-0001', 'factura', :t0 - 33, :t0 - 3,  :t0 - 3,  'issued', 4200, 4452, 'EUR',
   '13130001-0000-4000-8000-000000000001', '13130006-0000-4000-8000-000000000006',
   '{"legal_name":"MüK Cia SCCL","tax_id":"F12345678"}', '{"legal_name":"Fundació Kursaal","tax_id":"G65432198"}', '30 dies', 'ES', NULL, :'by'),
  -- ISSUED AND OVERDUE: this is what feeds "Vencido" and the task on Desk
  ('99990002-0000-4000-8000-000000000002', :'ws', :'uo', 'FAC 2026-0002', 'factura', :t0 - 20, :t0 - 1,  :t0 - 1,  'issued', 2200, 2332, 'EUR',
   '13130001-0000-4000-8000-000000000001', '13130002-0000-4000-8000-000000000002',
   '{"legal_name":"MüK Cia SCCL","tax_id":"F12345678"}', '{"legal_name":"Ajuntament de Terrassa","tax_id":"P0827900B"}', '20 dies', 'ES', 'Van dir que el registre es va perdre.', :'by'),
  -- issued, still inside its term
  ('99990003-0000-4000-8000-000000000003', :'ws', :'mm', 'FAC 2026-0003', 'factura', :f0 + 2,  :f0 + 32, :f0 + 32, 'issued', 4200, 4452, 'EUR',
   '13130001-0000-4000-8000-000000000001', '13130002-0000-4000-8000-000000000002',
   '{"legal_name":"MüK Cia SCCL","tax_id":"F12345678"}', '{"legal_name":"Ajuntament de Terrassa","tax_id":"P0827900B"}', '30 dies', 'ES', NULL, :'by'),
  -- issued with a PARTIAL payment: stays issued
  ('99990004-0000-4000-8000-000000000004', :'ws', :'uo', 'FAC 2026-0004', 'factura', :f0 + 9,  :f0 + 39, :f0 + 39, 'issued', 1800, 1908, 'EUR',
   '13130001-0000-4000-8000-000000000001', '13130002-0000-4000-8000-000000000002',
   '{"legal_name":"MüK Cia SCCL","tax_id":"F12345678"}', '{"legal_name":"Ajuntament de Terrassa","tax_id":"P0827900B"}', 'Bestreta 30%', 'ES', NULL, :'by'),
  -- a draft: no number yet
  ('99990005-0000-4000-8000-000000000005', :'ws', :'mm', NULL,            'factura', :f0 + 22, :f0 + 52, :f0 + 52, 'draft',  2600, 2756, 'EUR',
   '13130001-0000-4000-8000-000000000001', '13130002-0000-4000-8000-000000000002',
   NULL, NULL, NULL, 'ES', 'Pendent de dades fiscals del teatre.', :'by'),
  -- a proforma, on its own numbering
  ('99990006-0000-4000-8000-000000000006', :'ws', :'ze', 'PRO 2026-0001', 'proforma',:f0 + 40, :f0 + 70, :f0 + 70, 'issued', 5000, 5300, 'EUR',
   '13130001-0000-4000-8000-000000000001', '13130002-0000-4000-8000-000000000002',
   '{"legal_name":"MüK Cia SCCL","tax_id":"F12345678"}', '{"legal_name":"Ajuntament de Terrassa","tax_id":"P0827900B"}', 'Proforma per tramitar', 'ES', NULL, :'by'),
  -- another currency altogether
  ('99990007-0000-4000-8000-000000000007', :'ws', :'uo', 'FAC 2026-0005', 'factura', :f0 + 73, :f0 + 103,:f0 + 103,'issued', 2400, 2880, 'GBP',
   '13130001-0000-4000-8000-000000000001', '13130004-0000-4000-8000-000000000004',
   '{"legal_name":"MüK Cia SCCL","tax_id":"F12345678"}', '{"legal_name":"Cafe OTO Ltd","tax_id":"GB123456789"}', '30 days', 'GB', NULL, :'by'),
  -- cancelled
  ('99990008-0000-4000-8000-000000000008', :'ws', :'mm', 'FAC 2026-0006', 'factura', :f0 + 12, :f0 + 42, :f0 + 42, 'cancelled', 900, 954, 'EUR',
   '13130001-0000-4000-8000-000000000001', '13130002-0000-4000-8000-000000000002',
   '{"legal_name":"MüK Cia SCCL","tax_id":"F12345678"}', '{"legal_name":"Ajuntament de Terrassa","tax_id":"P0827900B"}', NULL, 'ES', 'Emesa amb el NIF equivocat.', :'by')
ON CONFLICT (id) DO UPDATE SET
  issued_on = EXCLUDED.issued_on, due_on = EXCLUDED.due_on, expected_on = EXCLUDED.expected_on,
  subtotal = EXCLUDED.subtotal, total = EXCLUDED.total, notes = EXCLUDED.notes;

INSERT INTO public.invoice_line (id, workspace_id, invoice_id, bolo_id, description, quantity, unit_amount) VALUES
  ('9a9a0001-0000-4000-8000-000000000001', :'ws', '99990001-0000-4000-8000-000000000001', '88880001-0000-4000-8000-000000000001', 'Funció · Kursaal (Manresa)', 1, 4200),
  ('9a9a0002-0000-4000-8000-000000000002', :'ws', '99990002-0000-4000-8000-000000000002', '88880002-0000-4000-8000-000000000002', 'Funció · La Mutant (València)', 1, 2200),
  ('9a9a0003-0000-4000-8000-000000000003', :'ws', '99990003-0000-4000-8000-000000000003', '88880004-0000-4000-8000-000000000004', 'Dues funcions · Mercat de les Flors', 2, 2100),
  ('9a9a0004-0000-4000-8000-000000000004', :'ws', '99990004-0000-4000-8000-000000000004', '88880005-0000-4000-8000-000000000005', 'Dues funcions · Nau Ivanow', 2, 900),
  ('9a9a0005-0000-4000-8000-000000000005', :'ws', '99990005-0000-4000-8000-000000000005', '88880006-0000-4000-8000-000000000006', 'Funció · Teatre Principal (Terrassa)', 1, 2600),
  ('9a9a0006-0000-4000-8000-000000000006', :'ws', '99990006-0000-4000-8000-000000000006', '88880009-0000-4000-8000-000000000009', 'Estrena · dues funcions', 2, 2500),
  ('9a9a0007-0000-4000-8000-000000000007', :'ws', '99990007-0000-4000-8000-000000000007', '8888000c-0000-4000-8000-00000000000c', 'Performance · Cafe OTO', 1, 2400),
  ('9a9a0008-0000-4000-8000-000000000008', :'ws', '99990008-0000-4000-8000-000000000008', '88880003-0000-4000-8000-000000000003', 'Funció · Sala Ártica (Zaragoza)', 1, 900)
ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description, quantity = EXCLUDED.quantity, unit_amount = EXCLUDED.unit_amount;

-- The tax layer is generic (ADR-088): 'add' for VAT, 'withhold' for IRPF,
-- 'exempt' with a reason for the intra-community case.
INSERT INTO public.invoice_tax_line (id, workspace_id, invoice_id, label, kind, rate_pct, base_amount, amount, exempt_reason, ordinal) VALUES
  ('9aaa0001-0000-4000-8000-000000000001', :'ws', '99990001-0000-4000-8000-000000000001', 'IVA 21%',  'add',      21, 4200,  882,  NULL, 1),
  ('9aaa0002-0000-4000-8000-000000000002', :'ws', '99990001-0000-4000-8000-000000000001', 'IRPF 15%', 'withhold', 15, 4200, -630,  NULL, 2),
  ('9aaa0003-0000-4000-8000-000000000003', :'ws', '99990002-0000-4000-8000-000000000002', 'IVA 21%',  'add',      21, 2200,  462,  NULL, 1),
  ('9aaa0004-0000-4000-8000-000000000004', :'ws', '99990002-0000-4000-8000-000000000002', 'IRPF 15%', 'withhold', 15, 2200, -330,  NULL, 2),
  ('9aaa0005-0000-4000-8000-000000000005', :'ws', '99990003-0000-4000-8000-000000000003', 'IVA 21%',  'add',      21, 4200,  882,  NULL, 1),
  ('9aaa0006-0000-4000-8000-000000000006', :'ws', '99990003-0000-4000-8000-000000000003', 'IRPF 15%', 'withhold', 15, 4200, -630,  NULL, 2),
  ('9aaa0007-0000-4000-8000-000000000007', :'ws', '99990004-0000-4000-8000-000000000004', 'IVA 21%',  'add',      21, 1800,  378,  NULL, 1),
  ('9aaa0008-0000-4000-8000-000000000008', :'ws', '99990004-0000-4000-8000-000000000004', 'IRPF 15%', 'withhold', 15, 1800, -270,  NULL, 2),
  ('9aaa0009-0000-4000-8000-000000000009', :'ws', '99990006-0000-4000-8000-000000000006', 'IVA 6%',   'add',       6, 5000,  300,  NULL, 1),
  ('9aaa000a-0000-4000-8000-00000000000a', :'ws', '99990007-0000-4000-8000-000000000007', 'VAT 20%',  'add',      20, 2400,  480,  NULL, 1),
  ('9aaa000b-0000-4000-8000-00000000000b', :'ws', '99990005-0000-4000-8000-000000000005', 'Exempt',   'exempt',    0, 2600,    0, 'Operació intracomunitària', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.invoice_number_series (id, workspace_id, scope_kind, fiscal_identity_id, scope_ref, year, next_seq) VALUES
  ('9ab00001-0000-4000-8000-000000000001', :'ws', 'legal',    '13130001-0000-4000-8000-000000000001', '13130001-0000-4000-8000-000000000001', extract(year FROM CURRENT_DATE)::int, 7),
  ('9ab00002-0000-4000-8000-000000000002', :'ws', 'proforma', NULL,                                   :'ws',                                  extract(year FROM CURRENT_DATE)::int, 2)
ON CONFLICT (scope_kind, scope_ref, year) DO NOTHING;

INSERT INTO public.payment (id, workspace_id, invoice_id, bolo_id, project_id, amount, received_on, method, reference, counterparty, category, notes, created_by) VALUES
  -- full payment ⇒ the trigger derives invoice 0001 to 'paid'
  ('9b9b0001-0000-4000-8000-000000000001', :'ws', '99990001-0000-4000-8000-000000000001', NULL, NULL, 4452, :t0 - 20, 'transfer', 'TRF-90211', 'Fundació Kursaal', NULL, NULL, :'by'),
  -- a partial one: invoice 0004 stays issued and Books shows the gap
  ('9b9b0002-0000-4000-8000-000000000002', :'ws', '99990004-0000-4000-8000-000000000004', NULL, NULL, 573,  :f0 + 10, 'transfer', 'TRF-90455', 'Ajuntament de Terrassa', NULL, 'Bestreta del 30%.', :'by'),
  -- collected with NO invoice at all: anchored straight to the bolo
  ('9b9b0003-0000-4000-8000-000000000003', :'ws', NULL, '88880003-0000-4000-8000-000000000003', NULL, 900,  :t0 - 10, 'cash',     NULL, 'Sala Ártica', NULL, 'Pagat en efectiu la mateixa nit.', :'by'),
  ('9b9b0004-0000-4000-8000-000000000004', :'ws', NULL, '88880009-0000-4000-8000-000000000009', NULL, 1500, :f0 + 45, 'transfer', 'TRF-91003', 'Mercat de les Flors', NULL, 'Bestreta de l''estrena.', :'by'),
  ('9b9b0005-0000-4000-8000-000000000005', :'ws', NULL, NULL, :'mm', 350,  :t0 - 6,  'card',  NULL, 'Venda de programes', 'other', NULL, :'by'),
  ('9b9b0006-0000-4000-8000-000000000006', :'ws', NULL, NULL, :'uo', 1200, :t0 - 40, 'other', 'ICEC-2026-118', 'ICEC', 'grant', 'Primer pagament de la subvenció.', :'by')
ON CONFLICT (id) DO UPDATE SET received_on = EXCLUDED.received_on, notes = EXCLUDED.notes;

-- ---------------------------------------------------------------------------
-- 13 · Expenses — one of every category, some already reimbursed. A cost
--      hangs from EXACTLY ONE parent: the bolo it belongs to, or the line
--      when it is the whole tour's and no single room owns it.
-- ---------------------------------------------------------------------------
INSERT INTO public.expense (id, workspace_id, bolo_id, line_id, category, description, amount, currency, incurred_on, reimbursed, counterparty, paid_by_user_id, notes, created_by) VALUES
  ('9c9c0001-0000-4000-8000-000000000001', :'ws', NULL, '22220004-0000-4000-8000-000000000004', 'travel',     'Vols BCN → LIS (4 pax)',        684.20, 'EUR', :f0 + 40, false, 'TAP', :'by', NULL, :'by'),
  ('9c9c0002-0000-4000-8000-000000000002', :'ws', '8888000a-0000-4000-8000-00000000000a', NULL, 'lodging',    'Hotel Lisboa · 2 nits',         420.00, 'EUR', :f0 + 64, false, 'Hotel Alif', :'by', NULL, :'by'),
  ('9c9c0003-0000-4000-8000-000000000003', :'ws', '8888000b-0000-4000-8000-00000000000b', NULL, 'per_diem',   'Dietes gira Portugal',          320.00, 'EUR', :f0 + 66, true,  NULL, :'by', 'Pagades en efectiu a cadascú.', :'by'),
  ('9c9c0004-0000-4000-8000-000000000004', :'ws', '8888000d-0000-4000-8000-00000000000d', NULL, 'freight',    'Camió escenografia · Paris',   1150.00, 'EUR', :f0 + 120, false, 'Transports Vidal', :'by', NULL, :'by'),
  ('9c9c0005-0000-4000-8000-000000000005', :'ws', NULL, '22220006-0000-4000-8000-000000000006', 'production', 'Material escenografia estrena', 2380.55, 'EUR', :f0 + 20, false, 'Ferreteria Sants', :'by', NULL, :'by'),
  ('9c9c0006-0000-4000-8000-000000000006', :'ws', '88880009-0000-4000-8000-000000000009', NULL, 'fees',       'Caché tècnic extern · estrena',  600.00, 'EUR', :f0 + 56, false, 'Bea Roure', NULL, NULL, :'by'),
  ('9c9c0007-0000-4000-8000-000000000007', :'ws', NULL, '22220002-0000-4000-8000-000000000002', 'other',      'Assegurança de la temporada',   410.00, 'EUR', :t0 - 15, true,  'Mútua', :'by', NULL, :'by'),
  ('9c9c0008-0000-4000-8000-000000000008', :'ws', '8888000c-0000-4000-8000-00000000000c', NULL, 'travel',     'Tren Eurostar · London',        390.00, 'GBP', :f0 + 71, false, 'Eurostar', :'by', NULL, :'by'),
  ('9c9c0009-0000-4000-8000-000000000009', :'ws', NULL, '22220005-0000-4000-8000-000000000005', 'travel',     'Vols BCN → BJX (5 pax)',       4820.00, 'EUR', :f0 + 140, false, 'Iberia', :'by', NULL, :'by'),
  ('9c9c000a-0000-4000-8000-00000000000a', :'ws', '8888000f-0000-4000-8000-00000000000f', NULL, 'lodging',    'Hotel Guanajuato · 6 nits',   18000.00, 'MXN', :f0 + 150, false, 'Hotel Real', :'by', NULL, :'by'),
  ('9c9c000b-0000-4000-8000-00000000000b', :'ws', '88880001-0000-4000-8000-000000000001', NULL, 'per_diem',   'Dietes Manresa',                 120.00, 'EUR', :t0 - 35, true,  NULL, :'by', NULL, :'by'),
  ('9c9c000c-0000-4000-8000-00000000000c', :'ws', '88880004-0000-4000-8000-000000000004', NULL, 'freight',    'Furgoneta llogada · Flors',      180.00, 'EUR', :f0,      false, 'Sixt', :'by', NULL, :'by'),
  ('9c9c000d-0000-4000-8000-00000000000d', :'ws', NULL, '22220006-0000-4000-8000-000000000006', 'production', 'Fotògraf de l''estrena',         550.00, 'EUR', :f0 + 56, false, 'Estudi Nord', NULL, NULL, :'by'),
  ('9c9c000e-0000-4000-8000-00000000000e', :'ws', '88880007-0000-4000-8000-000000000007', NULL, 'travel',     'Tren Zürich (reserva)',          210.00, 'CHF', :f0 + 27, false, 'SBB', :'by', 'Encara és un hold: reemborsable.', :'by')
ON CONFLICT (id) DO UPDATE SET amount = EXCLUDED.amount, incurred_on = EXCLUDED.incurred_on, reimbursed = EXCLUDED.reimbursed;

-- ---------------------------------------------------------------------------
-- 14 · Tasks — open and done, overdue and future, every origin, and one of
--      each anchor (project, line, performance, conversation, and none).
-- ---------------------------------------------------------------------------
INSERT INTO public.task (id, workspace_id, project_id, line_id, performance_id, conversation_id, title, note, due_at, from_at, lead_days, status, origin, created_by) VALUES
  ('77770001-0000-4000-8000-000000000001', :'ws', NULL, NULL, NULL, NULL, 'Reclamar la factura vençuda del Teatre Principal', 'FAC 2026-0002, vençuda ahir.', :t0 + time '09:00', NULL, NULL, 'open', 'protocol', :'by'),
  ('77770002-0000-4000-8000-000000000002', :'ws', :'mm', NULL, NULL, NULL, 'Enviar fitxa tècnica actualitzada', NULL, :t0 - 4 + time '12:00', NULL, NULL, 'open', 'manual', :'by'),
  ('77770003-0000-4000-8000-000000000003', :'ws', NULL, NULL, '33330004-0000-4000-8000-000000000004', NULL, 'Confirmar hotel per la nit del Mercat', NULL, :f0 - 3 + time '12:00', :f0 - 10 + time '09:00', 7, 'open', 'protocol', :'by'),
  ('77770004-0000-4000-8000-000000000004', :'ws', NULL, NULL, '33330004-0000-4000-8000-000000000004', NULL, 'Passar el rider al tècnic de sala', NULL, :f0 - 5 + time '12:00', NULL, NULL, 'done', 'manual', :'by'),
  ('77770005-0000-4000-8000-000000000005', :'ws', NULL, NULL, NULL, '9d9d0003-0000-4000-8000-000000000003', 'Insistir a La Villette', 'Fa 20 dies del últim contacte.', :t0 + 1 + time '10:00', NULL, NULL, 'open', 'ai', :'by'),
  ('77770006-0000-4000-8000-000000000006', :'ws', NULL, '22220004-0000-4000-8000-000000000004', NULL, NULL, 'Tancar els vols de la gira Europa', NULL, :f0 + 40 + time '12:00', NULL, NULL, 'open', 'manual', :'by'),
  ('77770007-0000-4000-8000-000000000007', :'ws', NULL, '22220005-0000-4000-8000-000000000005', NULL, NULL, 'Visats i carnet ATA per Mèxic', 'Tarda 6 setmanes.', :f0 + 110 + time '12:00', :f0 + 80 + time '09:00', 30, 'open', 'protocol', :'by'),
  ('77770008-0000-4000-8000-000000000008', :'ws', :'ze', NULL, NULL, NULL, 'Contractar el fotògraf de l''estrena', NULL, :f0 + 45 + time '12:00', NULL, NULL, 'open', 'manual', :'by'),
  ('77770009-0000-4000-8000-000000000009', :'ws', :'ze', NULL, NULL, NULL, 'Escriure el dossier de Zoo Elèctric', NULL, :f0 + 25 + time '12:00', NULL, NULL, 'open', 'manual', :'by'),
  ('7777000a-0000-4000-8000-00000000000a', :'ws', NULL, NULL, '3333000d-0000-4000-8000-00000000000d', NULL, 'Decidir el hold de Zaragoza', 'El termini ja ha passat.', :t0 - 1 + time '10:00', NULL, NULL, 'open', 'ai', :'by'),
  ('7777000b-0000-4000-8000-00000000000b', :'ws', :'mm', NULL, NULL, NULL, 'Justificació ICEC', NULL, :f0 + 168 + time '12:00', NULL, NULL, 'open', 'protocol', :'by'),
  ('7777000c-0000-4000-8000-00000000000c', :'ws', NULL, NULL, NULL, NULL, 'Renovar l''assegurança de responsabilitat civil', NULL, :f0 + 60 + time '12:00', NULL, NULL, 'open', 'manual', :'by'),
  ('7777000d-0000-4000-8000-00000000000d', :'ws', :'uo', NULL, NULL, NULL, 'Comprar les cintes de leds de recanvi', NULL, :f0 + 5 + time '12:00', NULL, NULL, 'done', 'manual', :'by'),
  ('7777000e-0000-4000-8000-00000000000e', :'ws', NULL, NULL, '33330014-0000-4000-8000-000000000014', NULL, 'Convidar programadors a l''estrena', NULL, :f0 + 42 + time '12:00', NULL, NULL, 'open', 'ai', :'by'),
  ('7777000f-0000-4000-8000-00000000000f', :'ws', NULL, NULL, NULL, '9d9d0007-0000-4000-8000-000000000007', 'Enviar contracte signat al Cervantino', NULL, :f0 + 100 + time '12:00', NULL, NULL, 'open', 'manual', :'by'),
  ('77770010-0000-4000-8000-000000000010', :'ws', NULL, NULL, NULL, NULL, 'Pagar les dietes de Portugal', NULL, :f0 + 69 + time '12:00', NULL, NULL, 'open', 'protocol', :'by'),
  ('77770011-0000-4000-8000-000000000011', :'ws', :'mm', NULL, NULL, NULL, 'Actualitzar el vídeo de promoció', NULL, NULL, NULL, NULL, 'open', 'manual', :'by'),
  ('77770012-0000-4000-8000-000000000012', :'ws', NULL, NULL, '33330023-0000-4000-8000-000000000023', NULL, 'Buscar substitut tècnic per Hamburg', 'La Laia està de baixa.', :f0 + 115 + time '12:00', NULL, NULL, 'done', 'ai', :'by')
ON CONFLICT (id) DO UPDATE SET due_at = EXCLUDED.due_at, from_at = EXCLUDED.from_at, status = EXCLUDED.status, note = EXCLUDED.note;

-- ---------------------------------------------------------------------------
-- 15 · Notes — private post-its (ADR-093). Every anchor a note can carry,
--      days with three of them, days with nothing else, one long body and
--      one that is a single word.
-- ---------------------------------------------------------------------------
INSERT INTO public.note (id, workspace_id, author_id, on_day, visibility, body, project_id, line_id, performance_id, date_id, person_id) VALUES
  ('66660001-0000-4000-8000-000000000001', :'ws', :'by', :t0,      'private', 'Trucar a la Marta abans de les 12.', NULL, NULL, NULL, NULL, NULL),
  ('66660002-0000-4000-8000-000000000002', :'ws', :'by', :t0,      'private', 'Portar el cable XLR llarg.', NULL, NULL, NULL, NULL, NULL),
  ('66660003-0000-4000-8000-000000000003', :'ws', :'by', :t0,      'private', 'Preguntar per les dietes.', NULL, NULL, NULL, NULL, NULL),
  ('66660004-0000-4000-8000-000000000004', :'ws', :'by', :f0,      'private', 'El camió no cap pel carrer: descàrrega per darrere, i avisar la Guàrdia Urbana el dia abans.', NULL, NULL, '33330004-0000-4000-8000-000000000004', NULL, NULL),
  ('66660005-0000-4000-8000-000000000005', :'ws', :'by', :f0 + 1,  'private', 'Matinal: la sala obre a les 16h, no abans.', NULL, NULL, '33330005-0000-4000-8000-000000000005', NULL, NULL),
  ('66660006-0000-4000-8000-000000000006', :'ws', :'by', :f0 + 4,  'private', 'A la residència hi ha piano de cua. Provar-lo.', NULL, NULL, NULL, '44440009-0000-4000-8000-000000000009', NULL),
  ('66660007-0000-4000-8000-000000000007', :'ws', :'by', :f0 + 9,  'private', 'L''Anouk prefereix tornar en tren, no en avió. Tenir-ho en compte a la gira.', NULL, NULL, NULL, NULL, 'a0000001-0000-4000-8000-000000000001'),
  ('66660008-0000-4000-8000-000000000008', :'ws', :'by', :f0 + 15, 'private', 'Pensar si la temporada aguanta un tercer projecte o si estem estirant massa. Si el Zoo estrena al novembre i la gira de tardor cau al mateix mes, la Bea no pot ser a dos llocs i no tenim ningú més que sàpiga el so. O contractem, o movem l''estrena, o desdoblem funcions. No decidir-ho a corre-cuita al gener.', :'mm', NULL, NULL, NULL, NULL),
  ('66660009-0000-4000-8000-000000000009', :'ws', :'by', :f0 + 21, 'private', 'Bilbao encara no ha dit res del hold.', NULL, NULL, '3333000c-0000-4000-8000-00000000000c', NULL, NULL),
  ('6666000a-0000-4000-8000-00000000000a', :'ws', :'by', :f0 + 34, 'private', 'Res.', NULL, NULL, NULL, NULL, NULL),
  ('6666000b-0000-4000-8000-00000000000b', :'ws', :'by', :f0 + 56, 'private', 'ESTRENA. Respirar.', :'ze', NULL, NULL, NULL, NULL),
  ('6666000c-0000-4000-8000-00000000000c', :'ws', :'by', :f0 + 63, 'private', 'Facturació portuguesa: cal el número de contribuinte abans de sortir.', NULL, '22220004-0000-4000-8000-000000000004', NULL, NULL, NULL),
  ('6666000d-0000-4000-8000-00000000000d', :'ws', :'by', :f0 + 88, 'private', 'Tanquem per vacances i tot i així hi ha un hold a París. Alguna cosa no quadra.', NULL, NULL, NULL, NULL, NULL),
  ('6666000e-0000-4000-8000-00000000000e', :'ws', :'by', :f0 + 104,'private', 'Baixa de la Laia: revisar TOTS els bolos de novembre.', NULL, NULL, NULL, NULL, 'a0000005-0000-4000-8000-000000000005'),
  ('6666000f-0000-4000-8000-00000000000f', :'ws', :'by', :f0 + 150,'private', 'Mèxic: portar adaptadors i la documentació de duana per partida doble. 🇲🇽', NULL, '22220005-0000-4000-8000-000000000005', NULL, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, on_day = EXCLUDED.on_day;

-- ---------------------------------------------------------------------------
-- 16 · A few assets so the document tabs are not empty.
-- ---------------------------------------------------------------------------
INSERT INTO public.asset_version (id, workspace_id, project_id, performance_id, kind, direction, url, slug, notes, uploaded_by) VALUES
  ('9d0d0001-0000-4000-8000-000000000001', :'ws', :'mm', NULL, 'rider',      'outbound', 'https://example.test/mamemi-rider-v4.pdf',   'mamemi-rider-v4', 'v4 · gener', :'by'),
  ('9d0d0002-0000-4000-8000-000000000002', :'ws', :'mm', NULL, 'stage_plot', 'outbound', 'https://example.test/mamemi-plot.pdf',       'mamemi-plot',     NULL, :'by'),
  ('9d0d0003-0000-4000-8000-000000000003', :'ws', :'uo', NULL, 'dossier',    'outbound', 'https://example.test/orbita-dossier-ca.pdf', 'orbita-dossier',  'Versió catalana.', :'by'),
  ('9d0d0004-0000-4000-8000-000000000004', :'ws', :'ze', NULL, 'dossier',    'outbound', 'https://example.test/zoo-dossier.pdf',       'zoo-dossier',     'Encara provisional.', :'by'),
  ('9d0d0005-0000-4000-8000-000000000005', :'ws', NULL, '33330017-0000-4000-8000-000000000017', 'tech_sheet', 'inbound', 'https://example.test/matos-tech.pdf', 'matos-tech', 'Fitxa de la sala.', :'by')
ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url, notes = EXCLUDED.notes;

COMMIT;

-- ---------------------------------------------------------------------------
-- What landed.
-- ---------------------------------------------------------------------------
\echo '— window —'
SELECT CURRENT_DATE AS today,
       min(performed_at) AS first_gig,
       max(performed_at) AS last_gig,
       count(*) AS performances
FROM public.performance WHERE workspace_id = :'ws' AND deleted_at IS NULL;

\echo '— counts —'
SELECT 'project' AS what, count(*) FROM public.project WHERE workspace_id = :'ws'
UNION ALL SELECT 'line',         count(*) FROM public.line               WHERE workspace_id = :'ws'
UNION ALL SELECT 'venue',        count(*) FROM public.venue              WHERE workspace_id = :'ws'
UNION ALL SELECT 'person(ws)',   count(*) FROM public.workspace_person   WHERE workspace_id = :'ws'
UNION ALL SELECT 'cast',         count(*) FROM public.cast_member        WHERE workspace_id = :'ws'
UNION ALL SELECT 'crew',         count(*) FROM public.crew_assignment    WHERE workspace_id = :'ws'
UNION ALL SELECT 'override',     count(*) FROM public.cast_override      WHERE workspace_id = :'ws'
UNION ALL SELECT 'performance',  count(*) FROM public.performance        WHERE workspace_id = :'ws'
UNION ALL SELECT 'date',         count(*) FROM public.date               WHERE workspace_id = :'ws'
UNION ALL SELECT 'absence',      count(*) FROM public.availability_block WHERE workspace_id = :'ws'
UNION ALL SELECT 'note',         count(*) FROM public.note               WHERE workspace_id = :'ws'
UNION ALL SELECT 'task',         count(*) FROM public.task               WHERE workspace_id = :'ws'
UNION ALL SELECT 'conversation', count(*) FROM public.conversation       WHERE workspace_id = :'ws'
UNION ALL SELECT 'bolo',         count(*) FROM public.bolo               WHERE workspace_id = :'ws'
UNION ALL SELECT 'invoice',      count(*) FROM public.invoice            WHERE workspace_id = :'ws'
UNION ALL SELECT 'payment',      count(*) FROM public.payment            WHERE workspace_id = :'ws'
UNION ALL SELECT 'expense',      count(*) FROM public.expense            WHERE workspace_id = :'ws'
UNION ALL SELECT 'organization', count(*) FROM public.workspace_organization WHERE workspace_id = :'ws'
UNION ALL SELECT 'fiscal id',    count(*) FROM public.fiscal_identity    WHERE workspace_id = :'ws'
UNION ALL SELECT 'asset',        count(*) FROM public.asset_version      WHERE workspace_id = :'ws';

\echo '— performance statuses covered —'
SELECT status, count(*) FROM public.performance
WHERE workspace_id = :'ws' AND deleted_at IS NULL GROUP BY status ORDER BY status;

\echo '— date kinds covered —'
SELECT kind, status, count(*) FROM public.date
WHERE workspace_id = :'ws' AND deleted_at IS NULL GROUP BY kind, status ORDER BY kind, status;
