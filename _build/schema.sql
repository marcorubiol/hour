-- Hour — Phase 0 Schema (reset v2)
-- Target: Supabase Cloud (Postgres 15+)
-- Generated: 2026-04-19
-- Supersedes the 2026-04-19 polymorphic reset. See DECISIONS.md ADR-001..007.
-- 18 tables in public.
--
-- Convention:
--   - UUID v7 PKs on every tenant-scoped table.
--   - `workspace_id` on every tenant-scoped row; `person` is global.
--   - Soft-delete via `deleted_at`; triggers keep `updated_at` fresh.
--   - Anti-CRM vocabulary: `engagement`, `show`, `date`, `person`.
--   - `show` is the atomic performance primitive (project × performed_at × venue).
--   - `date` is the calendar primitive for non-performance events
--     (rehearsal, residency, travel_day, press, other).
--   - Money lives in its own tables (invoice, invoice_line, payment, expense).
--   - RBAC: flat `workspace_membership.role` enum governs workspace entry;
--     the editable `workspace_role` catalog + `project_membership.roles/grants/revokes`
--     govern per-project permissions. See ADR-006.

--------------------------------------------------------------------------------
-- 0. Drop + recreate public schema
--------------------------------------------------------------------------------

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT CREATE ON SCHEMA public TO postgres;

--------------------------------------------------------------------------------
-- 1. Extensions
--------------------------------------------------------------------------------

-- pgcrypto lives in pg_catalog or public by default on Supabase; we rely on
-- gen_random_bytes for the UUID v7 generator.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- citext and pg_trgm live in the `extensions` schema (silences the Supabase
-- advisor lint "extension in public schema"). The `extensions` schema
-- pre-exists on Supabase Cloud; nothing to create here.
CREATE EXTENSION IF NOT EXISTS citext  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

--------------------------------------------------------------------------------
-- 2. Generic helper functions
--------------------------------------------------------------------------------

-- 2.1 uuid_generate_v7 — RFC 9562 time-ordered UUID, PL/pgSQL implementation.
-- Replace with the native uuidv7() or the pg_uuidv7 extension when Supabase
-- ships either; value shape is identical so PKs remain valid.
CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid AS $$
DECLARE
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms := substring(
    int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint)
    FROM 3
  );
  uuid_bytes := unix_ts_ms || gen_random_bytes(10);
  uuid_bytes := set_byte(
    uuid_bytes, 6,
    (b'0111' || get_byte(uuid_bytes, 6)::bit(4))::bit(8)::integer
  );
  uuid_bytes := set_byte(
    uuid_bytes, 8,
    (b'10' || get_byte(uuid_bytes, 8)::bit(6))::bit(8)::integer
  );
  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE
SET search_path = extensions, public, pg_temp;

COMMENT ON FUNCTION uuid_generate_v7() IS
  'RFC 9562 UUID v7 — time-ordered. Shape-compatible with pg_uuidv7 and Postgres 18 native uuidv7().';


-- 2.2 set_updated_at — shared trigger function.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

--------------------------------------------------------------------------------
-- 3. Enums
--------------------------------------------------------------------------------

-- Workspace + workspace membership
CREATE TYPE workspace_kind              AS ENUM ('personal', 'team');
CREATE TYPE membership_role             AS ENUM ('owner', 'admin', 'member', 'viewer', 'guest');

-- Workspace-level role catalog (complements membership_role)
CREATE TYPE workspace_role_access_level AS ENUM ('owner', 'admin', 'producer', 'member', 'viewer');

-- Project
CREATE TYPE project_status              AS ENUM ('draft', 'active', 'archived');

-- Line (optional grouping between project and show)
CREATE TYPE line_kind                   AS ENUM ('tour', 'season', 'phase', 'circuit', 'residency', 'other');
CREATE TYPE line_status                 AS ENUM ('open', 'closed', 'archived');

-- Show (atomic performance)
CREATE TYPE show_status                 AS ENUM (
  'proposed',   -- initial state, under discussion
  'hold',       -- simple hold (theatre/dance): slot blocked, no priority
  'hold_1',     -- prioritized hold (music industry): first right to confirm
  'hold_2',
  'hold_3',
  'confirmed',  -- signed / committed
  'done',       -- performed, pre-invoice
  'invoiced',   -- invoice issued against this show
  'paid',       -- invoice paid (at least one payment received)
  'cancelled'
);

-- Date (calendar primitive for non-performance events)
CREATE TYPE date_kind                   AS ENUM ('rehearsal', 'residency', 'travel_day', 'press', 'other');
CREATE TYPE date_status                 AS ENUM ('tentative', 'confirmed', 'cancelled', 'done');

-- Engagement (conversation state, anti-CRM)
CREATE TYPE engagement_status           AS ENUM (
  'contacted',        -- first outreach sent
  'in_conversation',  -- active dialogue
  'hold',             -- tentative commitment from the other side, no date yet
  'confirmed',        -- agreed (shows should follow)
  'declined',         -- they said no
  'dormant',          -- no activity, not declined
  'recurring'         -- ongoing relationship across seasons
);

-- Person notes
CREATE TYPE person_note_visibility      AS ENUM ('workspace', 'private');

-- Money
CREATE TYPE invoice_status              AS ENUM ('draft', 'issued', 'paid', 'cancelled');
CREATE TYPE payment_method              AS ENUM ('transfer', 'card', 'cash', 'other');
CREATE TYPE expense_category            AS ENUM ('travel', 'lodging', 'per_diem', 'freight', 'production', 'fees', 'other');

--------------------------------------------------------------------------------
-- 4. Tables (dependency order)
--------------------------------------------------------------------------------

-- 4.1 workspace — tenant root. One personal workspace per user (auto-created).
CREATE TABLE workspace (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  kind          workspace_kind NOT NULL DEFAULT 'personal',
  country       char(2),
  timezone      text NOT NULL DEFAULT 'Europe/Madrid',
  settings      jsonb NOT NULL DEFAULT '{}'::jsonb,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT workspace_slug_format    CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  CONSTRAINT workspace_country_format CHECK (country IS NULL OR country ~ '^[A-Z]{2}$')
);

CREATE INDEX workspace_kind_idx       ON workspace (kind) WHERE deleted_at IS NULL;
CREATE INDEX workspace_deleted_at_idx ON workspace (deleted_at) WHERE deleted_at IS NOT NULL;

COMMENT ON TABLE  workspace       IS 'Top-level tenant. Personal (auto-created on signup) or team.';
COMMENT ON COLUMN workspace.kind  IS 'personal | team — drives UX defaults and Phase 1 billing scope.';


-- 4.2 user_profile — 1:1 mirror of auth.users.
CREATE TABLE user_profile (
  user_id    uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name  text NOT NULL,
  avatar_url text,
  locale     text NOT NULL DEFAULT 'es',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_profile IS '1:1 with auth.users. Auto-populated by handle_new_user trigger.';


-- 4.3 workspace_membership — renamed from `membership`. Flat role enum is the
-- authority at workspace entry; per-project permissions live in workspace_role
-- + project_membership. owner/admin bypass project-level permission checks
-- (ADR-006).
CREATE TABLE workspace_membership (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role         membership_role NOT NULL DEFAULT 'member',
  accepted_at  timestamptz,
  invited_by   uuid REFERENCES auth.users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX workspace_membership_user_idx      ON workspace_membership (user_id);
CREATE INDEX workspace_membership_workspace_idx ON workspace_membership (workspace_id);

COMMENT ON TABLE  workspace_membership      IS 'Workspace-level role. owner/admin bypass project permission checks.';
COMMENT ON COLUMN workspace_membership.role IS 'owner | admin | member | viewer | guest.';


-- 4.4 workspace_role — per-workspace catalog of named roles. 15 system roles
-- are seeded on workspace creation by `seed_system_roles_on_workspace`.
CREATE TABLE workspace_role (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  code         text NOT NULL,
  label        text NOT NULL,
  is_system    boolean NOT NULL DEFAULT false,
  archived_at  timestamptz,
  access_level workspace_role_access_level NOT NULL,
  permissions  text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, code),
  CONSTRAINT workspace_role_code_format CHECK (code ~ '^[a-z][a-z0-9_]{0,39}$')
);

CREATE INDEX workspace_role_workspace_idx ON workspace_role (workspace_id) WHERE archived_at IS NULL;

COMMENT ON TABLE  workspace_role            IS 'Editable role catalog per workspace. 15 system roles seeded by trigger.';
COMMENT ON COLUMN workspace_role.is_system  IS 'true for the 15 seeded roles. Prevents DELETE; UPDATE is allowed.';
COMMENT ON COLUMN workspace_role.permissions IS 'Closed vocabulary: read:money, read:engagement, read:person_note_private, read:internal_notes, edit:show, edit:engagement, edit:money, edit:project_meta, edit:membership, admin:project.';


-- 4.5 person — GLOBAL (no workspace_id). One real human = one person row,
-- deduped on email. Privacy lives in person_note.visibility and in RLS.
CREATE TABLE person (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  email             extensions.citext UNIQUE,
  full_name         text NOT NULL,
  first_name        text,
  last_name         text,
  phone             text,
  website           text,
  city              text,
  country           char(2),
  languages         text[] NOT NULL DEFAULT '{}',
  organization_name text,
  title             text,
  created_by        uuid REFERENCES auth.users (id),
  custom_fields     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT person_country_format CHECK (country IS NULL OR country ~ '^[A-Z]{2}$')
);

CREATE INDEX person_full_name_trgm_idx    ON person USING gin (full_name extensions.gin_trgm_ops);
CREATE INDEX person_custom_fields_gin_idx ON person USING gin (custom_fields jsonb_path_ops);
CREATE INDEX person_created_by_idx        ON person (created_by);

COMMENT ON TABLE  person            IS 'Global identity, no workspace_id. Deduped on lower(email).';
COMMENT ON COLUMN person.created_by IS 'First user to create the row. Audit only; does not confer ownership.';


-- 4.6 venue — recurring physical place. Same theatre hosts your tour year
-- after year; deserves its own entity with contacts and notes.
CREATE TABLE venue (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id  uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  name          text NOT NULL,
  city          text,
  country       char(2),
  address       text,
  capacity      int,
  contacts      jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes         text,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    uuid REFERENCES auth.users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT venue_country_format CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  CONSTRAINT venue_name_nonempty  CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX venue_workspace_name_city_idx
  ON venue (workspace_id, lower(name), coalesce(lower(city), ''))
  WHERE deleted_at IS NULL;
CREATE INDEX venue_workspace_idx ON venue (workspace_id) WHERE deleted_at IS NULL;

COMMENT ON TABLE venue IS 'Recurring physical place. Both show.venue_id and date.venue_id reference it.';


-- 4.7 project — no `type` column (ADR-007). Polymorphism emerges from which
-- subentities exist (line, show, date, engagement, invoice…).
CREATE TABLE project (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id  uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  slug          text NOT NULL,
  name          text NOT NULL,
  description   text,
  status        project_status NOT NULL DEFAULT 'draft',
  owner_id      uuid REFERENCES workspace_membership (id) ON DELETE SET NULL,
  starts_on     date,
  ends_on       date,
  dossier_url   text,
  poster_url    text,
  notes         text,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    uuid REFERENCES auth.users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (workspace_id, slug),
  CONSTRAINT project_slug_format CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  CONSTRAINT project_date_range  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX project_workspace_idx ON project (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX project_status_idx    ON project (workspace_id, status) WHERE deleted_at IS NULL;

COMMENT ON TABLE project IS 'Unit of work. No `type` tag (ADR-007) — polymorphism comes from subentity presence.';


-- 4.8 project_membership — per-project permissions. Uses the workspace_role
-- catalog (roles text[]) with explicit grants/revokes on top.
-- ADR-006 vocabulary: 10 closed permissions.
CREATE TABLE project_membership (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  project_id         uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  roles              text[] NOT NULL DEFAULT '{}',
  permission_grants  text[] NOT NULL DEFAULT '{}',
  permission_revokes text[] NOT NULL DEFAULT '{}',
  invited_by         uuid REFERENCES auth.users (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

CREATE INDEX project_membership_user_idx    ON project_membership (user_id);
CREATE INDEX project_membership_project_idx ON project_membership (project_id);

COMMENT ON TABLE  project_membership        IS 'Per-project access. Effective perms = union(role.permissions) + grants - revokes.';
COMMENT ON COLUMN project_membership.roles  IS 'Codes from workspace_role.code (same workspace). Validated by validate_project_membership_roles trigger.';


-- 4.9 line — optional grouping between project and show (tour, season,
-- phase, circuit, residency, other). ADR-005.
CREATE TABLE line (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id  uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  name          text NOT NULL,
  kind          line_kind NOT NULL DEFAULT 'other',
  territory     text,
  status        line_status NOT NULL DEFAULT 'open',
  start_date    date,
  end_date      date,
  dossier_url   text,
  notes         text,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    uuid REFERENCES auth.users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT line_name_nonempty CHECK (length(btrim(name)) > 0),
  CONSTRAINT line_date_range    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE INDEX line_workspace_idx ON line (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX line_project_idx   ON line (project_id)   WHERE deleted_at IS NULL;
CREATE INDEX line_status_idx    ON line (workspace_id, status) WHERE deleted_at IS NULL;

COMMENT ON TABLE line IS 'Optional grouping between project and show. Tour, season, phase, circuit, residency, other.';


-- 4.10 engagement — workspace-scoped conversation state with a person on a
-- project. Anti-CRM status enum. Shows hang off engagement via show.engagement_id;
-- engagement no longer carries date_id (that linkage lives on the show side).
CREATE TABLE engagement (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id       uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  project_id         uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  person_id          uuid NOT NULL REFERENCES person (id) ON DELETE RESTRICT,
  status             engagement_status NOT NULL DEFAULT 'contacted',
  role               text,
  first_contacted_at timestamptz,
  last_contacted_at  timestamptz,
  next_action_at     timestamptz,
  next_action_note   text,
  custom_fields      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by         uuid REFERENCES auth.users (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  UNIQUE (workspace_id, project_id, person_id)
);

CREATE INDEX engagement_workspace_idx          ON engagement (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX engagement_project_idx            ON engagement (project_id)   WHERE deleted_at IS NULL;
CREATE INDEX engagement_person_idx             ON engagement (person_id)    WHERE deleted_at IS NULL;
CREATE INDEX engagement_status_idx             ON engagement (workspace_id, status) WHERE deleted_at IS NULL;
CREATE INDEX engagement_created_by_idx         ON engagement (created_by);
CREATE INDEX engagement_custom_fields_gin_idx  ON engagement USING gin (custom_fields jsonb_path_ops);

COMMENT ON TABLE  engagement        IS 'Conversation state for (person × project × workspace). Distinct from show (ADR-001).';
COMMENT ON COLUMN engagement.status IS 'Anti-CRM. contacted | in_conversation | hold | confirmed | declined | dormant | recurring.';


-- 4.11 show — atomic performance. Has a date, a venue, a status from the
-- hold→confirmed→done→paid lifecycle. Optionally points at its originating
-- engagement. ADR-001, ADR-002.
CREATE TABLE show (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id   uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  line_id        uuid REFERENCES line (id) ON DELETE SET NULL,
  engagement_id  uuid REFERENCES engagement (id) ON DELETE SET NULL,
  performed_at   date NOT NULL,
  venue_id       uuid REFERENCES venue (id) ON DELETE SET NULL,
  venue_name     text,
  city           text,
  country        char(2),
  status         show_status NOT NULL DEFAULT 'proposed',
  fee_amount     numeric(12,2),
  fee_currency   char(3) DEFAULT 'EUR',
  notes          text,
  custom_fields  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by     uuid REFERENCES auth.users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CONSTRAINT show_country_format  CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  CONSTRAINT show_currency_format CHECK (fee_currency IS NULL OR fee_currency ~ '^[A-Z]{3}$')
);

CREATE INDEX show_workspace_idx    ON show (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX show_project_idx      ON show (project_id)   WHERE deleted_at IS NULL;
CREATE INDEX show_line_idx         ON show (line_id)      WHERE deleted_at IS NULL AND line_id IS NOT NULL;
CREATE INDEX show_engagement_idx   ON show (engagement_id) WHERE deleted_at IS NULL AND engagement_id IS NOT NULL;
CREATE INDEX show_performed_at_idx ON show (performed_at) WHERE deleted_at IS NULL;
CREATE INDEX show_status_idx       ON show (workspace_id, status) WHERE deleted_at IS NULL;
-- Deliberately NO UNIQUE (project_id, performed_at, venue_id) — two simple
-- holds on the same slot must be able to coexist (ADR-002).

COMMENT ON TABLE  show              IS 'Atomic performance (project × performed_at × venue). Distinct from engagement.';
COMMENT ON COLUMN show.performed_at IS 'Date of the performance. Named to avoid colliding with the `date` type / table.';
COMMENT ON COLUMN show.fee_amount   IS 'Intended fee. Billed fee lives on invoice_line.unit_amount.';


-- 4.12 date — calendar primitive for non-performance events. Can be tied to
-- a specific show via `show_id` (a rehearsal or travel day belongs to show X).
CREATE TABLE date (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id  uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  show_id       uuid REFERENCES show (id) ON DELETE SET NULL,
  venue_id      uuid REFERENCES venue (id) ON DELETE SET NULL,
  kind          date_kind NOT NULL DEFAULT 'other',
  status        date_status NOT NULL DEFAULT 'tentative',
  title         text,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz,
  all_day       boolean NOT NULL DEFAULT false,
  season        text,
  venue_name    text,
  city          text,
  country       char(2),
  notes         text,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    uuid REFERENCES auth.users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT date_country_format CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  CONSTRAINT date_time_range     CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

CREATE INDEX date_workspace_idx         ON date (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX date_project_idx           ON date (project_id)   WHERE deleted_at IS NULL;
CREATE INDEX date_show_idx              ON date (show_id)      WHERE deleted_at IS NULL AND show_id IS NOT NULL;
CREATE INDEX date_starts_at_idx         ON date (starts_at)    WHERE deleted_at IS NULL;
CREATE INDEX date_season_idx            ON date (workspace_id, season) WHERE deleted_at IS NULL AND season IS NOT NULL;
CREATE INDEX date_custom_fields_gin_idx ON date USING gin (custom_fields jsonb_path_ops);

COMMENT ON TABLE  date      IS 'Calendar primitive for rehearsal, residency, travel_day, press, other. Performances live in `show`.';
COMMENT ON COLUMN date.kind IS 'No `performance` — that is the `show` table''s job.';


-- 4.13 person_note — workspace-scoped note on a person. "Mine vs ours" via
-- visibility enum. Private notes are readable only by the author; workspace
-- notes are readable by any workspace member (no extra permission gate).
CREATE TABLE person_note (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  person_id    uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  author_id    uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  visibility   person_note_visibility NOT NULL DEFAULT 'workspace',
  body         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  CONSTRAINT person_note_body_nonempty CHECK (length(btrim(body)) > 0)
);

CREATE INDEX person_note_workspace_idx  ON person_note (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX person_note_person_idx     ON person_note (person_id)    WHERE deleted_at IS NULL;
CREATE INDEX person_note_author_idx     ON person_note (author_id)    WHERE deleted_at IS NULL;
CREATE INDEX person_note_visibility_idx ON person_note (workspace_id, visibility) WHERE deleted_at IS NULL;

COMMENT ON TABLE  person_note            IS 'Note on a person. visibility=workspace readable by any member; visibility=private by author + read:person_note_private.';
COMMENT ON COLUMN person_note.visibility IS 'workspace | private.';


-- 4.14 invoice — billing header. Can reference a project (project_id) or
-- stand alone (workspace-level invoicing). Supports Spanish VAT + IRPF.
CREATE TABLE invoice (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id    uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  project_id      uuid REFERENCES project (id) ON DELETE SET NULL,
  number          text,
  issued_on       date NOT NULL DEFAULT CURRENT_DATE,
  due_on          date,
  status          invoice_status NOT NULL DEFAULT 'draft',
  subtotal        numeric(12,2) NOT NULL DEFAULT 0,
  vat_pct         numeric(5,2),
  vat_amount      numeric(12,2),
  irpf_pct        numeric(5,2),
  irpf_amount     numeric(12,2),
  total           numeric(12,2) NOT NULL DEFAULT 0,
  currency        char(3) NOT NULL DEFAULT 'EUR',
  payer_person_id uuid REFERENCES person (id) ON DELETE SET NULL,
  notes           text,
  custom_fields   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by      uuid REFERENCES auth.users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT invoice_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT invoice_date_range      CHECK (due_on IS NULL OR due_on >= issued_on)
);

CREATE INDEX invoice_workspace_idx ON invoice (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX invoice_project_idx   ON invoice (project_id)   WHERE deleted_at IS NULL AND project_id IS NOT NULL;
CREATE INDEX invoice_status_idx    ON invoice (workspace_id, status) WHERE deleted_at IS NULL;
CREATE INDEX invoice_issued_on_idx ON invoice (issued_on);

COMMENT ON TABLE invoice IS 'Invoice header. subtotal + vat_amount - irpf_amount = total (enforced at app level, not DB).';


-- 4.15 invoice_line — line item. Optionally references a show (tour-as-one-
-- invoice pattern). line_total is generated.
CREATE TABLE invoice_line (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  invoice_id   uuid NOT NULL REFERENCES invoice (id) ON DELETE CASCADE,
  show_id      uuid REFERENCES show (id) ON DELETE SET NULL,
  description  text NOT NULL,
  quantity     numeric(10,2) NOT NULL DEFAULT 1,
  unit_amount  numeric(12,2) NOT NULL,
  line_total   numeric(12,2) GENERATED ALWAYS AS (quantity * unit_amount) STORED,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_line_description_nonempty CHECK (length(btrim(description)) > 0),
  CONSTRAINT invoice_line_quantity_positive    CHECK (quantity > 0)
);

CREATE INDEX invoice_line_invoice_idx   ON invoice_line (invoice_id);
CREATE INDEX invoice_line_show_idx      ON invoice_line (show_id) WHERE show_id IS NOT NULL;
CREATE INDEX invoice_line_workspace_idx ON invoice_line (workspace_id);

COMMENT ON TABLE invoice_line IS 'Invoice line item. show_id optional — tour billed as one invoice with N lines.';


-- 4.16 payment — abono against an invoice. N:1 with invoice (advance + rest).
CREATE TABLE payment (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  invoice_id   uuid NOT NULL REFERENCES invoice (id) ON DELETE CASCADE,
  amount       numeric(12,2) NOT NULL,
  received_on  date NOT NULL DEFAULT CURRENT_DATE,
  method       payment_method NOT NULL DEFAULT 'transfer',
  reference    text,
  notes        text,
  created_by   uuid REFERENCES auth.users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  CONSTRAINT payment_amount_positive CHECK (amount > 0)
);

CREATE INDEX payment_invoice_idx   ON payment (invoice_id) WHERE deleted_at IS NULL;
CREATE INDEX payment_workspace_idx ON payment (workspace_id) WHERE deleted_at IS NULL;

COMMENT ON TABLE payment IS 'Abono against an invoice. Multiple payments per invoice (advance + rest).';


-- 4.17 expense — cost incurred. CHECK: exactly one of show_id / line_id is set.
-- ADR-003.
CREATE TABLE expense (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id     uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  show_id          uuid REFERENCES show (id) ON DELETE CASCADE,
  line_id          uuid REFERENCES line (id) ON DELETE CASCADE,
  category         expense_category NOT NULL DEFAULT 'other',
  description      text NOT NULL,
  amount           numeric(12,2) NOT NULL,
  currency         char(3) NOT NULL DEFAULT 'EUR',
  incurred_on      date NOT NULL DEFAULT CURRENT_DATE,
  receipt_url      text,
  paid_by_user_id  uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  reimbursed       boolean NOT NULL DEFAULT false,
  notes            text,
  custom_fields    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by       uuid REFERENCES auth.users (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CONSTRAINT expense_description_nonempty CHECK (length(btrim(description)) > 0),
  CONSTRAINT expense_amount_positive      CHECK (amount > 0),
  CONSTRAINT expense_currency_format      CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT expense_exactly_one_parent   CHECK (
    (show_id IS NOT NULL)::int + (line_id IS NOT NULL)::int = 1
  )
);

CREATE INDEX expense_workspace_idx ON expense (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX expense_show_idx      ON expense (show_id) WHERE deleted_at IS NULL AND show_id IS NOT NULL;
CREATE INDEX expense_line_idx      ON expense (line_id) WHERE deleted_at IS NULL AND line_id IS NOT NULL;
CREATE INDEX expense_category_idx  ON expense (workspace_id, category) WHERE deleted_at IS NULL;

COMMENT ON TABLE   expense                          IS 'Cost incurred. Exactly one of show_id / line_id — never both, never neither (ADR-003).';
COMMENT ON COLUMN  expense.paid_by_user_id          IS 'User who fronted the expense. NULL if paid by the workspace directly.';


-- 4.18 audit_log — append-only. Written by per-table triggers.
CREATE TABLE audit_log (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id uuid REFERENCES workspace (id) ON DELETE SET NULL,
  actor_id     uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  entity_type  text NOT NULL,
  entity_id    uuid NOT NULL,
  action       text NOT NULL,
  changes      jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_workspace_idx ON audit_log (workspace_id, created_at DESC);
CREATE INDEX audit_log_entity_idx    ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_actor_idx     ON audit_log (actor_id, created_at DESC);

COMMENT ON TABLE audit_log IS 'Append-only audit trail. Written by per-table triggers (SECURITY DEFINER).';

--------------------------------------------------------------------------------
-- 5. updated_at triggers
--------------------------------------------------------------------------------

CREATE TRIGGER workspace_set_updated_at            BEFORE UPDATE ON workspace            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER user_profile_set_updated_at         BEFORE UPDATE ON user_profile         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER workspace_membership_set_updated_at BEFORE UPDATE ON workspace_membership FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER workspace_role_set_updated_at       BEFORE UPDATE ON workspace_role       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER person_set_updated_at               BEFORE UPDATE ON person               FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER venue_set_updated_at                BEFORE UPDATE ON venue                FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER project_set_updated_at              BEFORE UPDATE ON project              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER project_membership_set_updated_at   BEFORE UPDATE ON project_membership   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER line_set_updated_at                 BEFORE UPDATE ON line                 FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER engagement_set_updated_at           BEFORE UPDATE ON engagement           FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER show_set_updated_at                 BEFORE UPDATE ON show                 FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER date_set_updated_at                 BEFORE UPDATE ON date                 FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER person_note_set_updated_at          BEFORE UPDATE ON person_note          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER invoice_set_updated_at              BEFORE UPDATE ON invoice              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER invoice_line_set_updated_at         BEFORE UPDATE ON invoice_line         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payment_set_updated_at              BEFORE UPDATE ON payment              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER expense_set_updated_at              BEFORE UPDATE ON expense              FOR EACH ROW EXECUTE FUNCTION set_updated_at();

--------------------------------------------------------------------------------
-- 6. System-role seeder (workspace AFTER INSERT)
--------------------------------------------------------------------------------

-- Permissions are listed explicitly per role — no wildcard marker (ADR-006).
-- The `owner` row holds all 10 permissions explicitly.
CREATE OR REPLACE FUNCTION seed_system_roles_on_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO workspace_role (workspace_id, code, label, is_system, access_level, permissions) VALUES
    (NEW.id, 'owner',              'Owner',                    true, 'owner',    ARRAY[
      'read:money','read:engagement','read:person_note_private','read:internal_notes',
      'edit:show','edit:engagement','edit:money','edit:project_meta','edit:membership',
      'admin:project'
    ]::text[]),
    (NEW.id, 'admin',               'Admin',                    true, 'admin',    ARRAY[
      'read:money','read:engagement','read:person_note_private','read:internal_notes',
      'edit:show','edit:engagement','edit:money','edit:project_meta','edit:membership'
    ]::text[]),
    (NEW.id, 'producer',            'Producer',                 true, 'producer', ARRAY[
      'read:money','read:engagement','read:person_note_private','read:internal_notes',
      'edit:show','edit:engagement','edit:money','edit:project_meta'
    ]::text[]),
    (NEW.id, 'production_manager',  'Production Manager',       true, 'producer', ARRAY[
      'read:money','read:engagement','read:person_note_private','read:internal_notes',
      'edit:show','edit:engagement','edit:money','edit:project_meta'
    ]::text[]),
    (NEW.id, 'tour_manager',        'Tour Manager',             true, 'producer', ARRAY[
      'read:money','read:engagement','read:person_note_private','read:internal_notes',
      'edit:show','edit:engagement','edit:money','edit:project_meta'
    ]::text[]),
    (NEW.id, 'distribution',        'Distribution',             true, 'producer', ARRAY[
      'read:money','read:engagement','read:person_note_private','read:internal_notes',
      'edit:show','edit:engagement','edit:project_meta'
    ]::text[]),
    (NEW.id, 'director',            'Director',                 true, 'member',   ARRAY[
      'read:engagement','read:internal_notes','edit:show'
    ]::text[]),
    (NEW.id, 'author',              'Author',                   true, 'member',   ARRAY[
      'read:internal_notes','edit:show'
    ]::text[]),
    (NEW.id, 'technical_director',  'Technical Director',       true, 'member',   ARRAY[
      'read:internal_notes','edit:show'
    ]::text[]),
    (NEW.id, 'performer',           'Performer',                true, 'member',   ARRAY['read:internal_notes']::text[]),
    (NEW.id, 'light_design',        'Light Design',             true, 'member',   ARRAY['read:internal_notes']::text[]),
    (NEW.id, 'sound_design',        'Sound Design',             true, 'member',   ARRAY['read:internal_notes']::text[]),
    (NEW.id, 'stage_design',        'Stage Design',             true, 'member',   ARRAY['read:internal_notes']::text[]),
    (NEW.id, 'costume_design',      'Costume Design',           true, 'member',   ARRAY['read:internal_notes']::text[]),
    (NEW.id, 'press',               'Press',                    true, 'member',   ARRAY['read:internal_notes']::text[]);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION seed_system_roles_on_workspace() IS
  'Seeds 15 system roles on every workspace INSERT. Permissions listed explicitly, no wildcard.';

CREATE TRIGGER workspace_seed_roles
  AFTER INSERT ON workspace
  FOR EACH ROW EXECUTE FUNCTION seed_system_roles_on_workspace();

--------------------------------------------------------------------------------
-- 7. Role-code validator (project_membership BEFORE INSERT/UPDATE)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION validate_project_membership_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ws_id uuid;
  v_code  text;
BEGIN
  IF NEW.roles IS NULL OR cardinality(NEW.roles) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT p.workspace_id INTO v_ws_id
  FROM public.project p WHERE p.id = NEW.project_id;

  IF v_ws_id IS NULL THEN
    RAISE EXCEPTION 'project % not found', NEW.project_id;
  END IF;

  FOREACH v_code IN ARRAY NEW.roles LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_role wr
      WHERE wr.workspace_id = v_ws_id
        AND wr.code         = v_code
        AND wr.archived_at  IS NULL
    ) THEN
      RAISE EXCEPTION 'unknown or archived role: % (workspace %)', v_code, v_ws_id
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION validate_project_membership_roles() IS
  'Rejects project_membership rows with unknown or archived role codes for the project''s workspace.';

CREATE TRIGGER project_membership_validate_roles
  BEFORE INSERT OR UPDATE ON project_membership
  FOR EACH ROW EXECUTE FUNCTION validate_project_membership_roles();

--------------------------------------------------------------------------------
-- 8. Immutable-column guards
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION guard_immutable_workspace_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'workspace_id is immutable on %', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

CREATE TRIGGER workspace_membership_guard_ws BEFORE UPDATE ON workspace_membership FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();
CREATE TRIGGER workspace_role_guard_ws       BEFORE UPDATE ON workspace_role       FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();
CREATE TRIGGER venue_guard_ws                BEFORE UPDATE ON venue                FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();
CREATE TRIGGER project_guard_ws              BEFORE UPDATE ON project              FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();
CREATE TRIGGER line_guard_ws                 BEFORE UPDATE ON line                 FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();
CREATE TRIGGER show_guard_ws                 BEFORE UPDATE ON show                 FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();
CREATE TRIGGER date_guard_ws                 BEFORE UPDATE ON date                 FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();
CREATE TRIGGER engagement_guard_ws           BEFORE UPDATE ON engagement           FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();
CREATE TRIGGER person_note_guard_ws          BEFORE UPDATE ON person_note          FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();
CREATE TRIGGER invoice_guard_ws              BEFORE UPDATE ON invoice              FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();
CREATE TRIGGER invoice_line_guard_ws         BEFORE UPDATE ON invoice_line         FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();
CREATE TRIGGER payment_guard_ws              BEFORE UPDATE ON payment              FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();
CREATE TRIGGER expense_guard_ws              BEFORE UPDATE ON expense              FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();


CREATE OR REPLACE FUNCTION guard_immutable_created_by()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'created_by is immutable on %', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

CREATE TRIGGER person_guard_creator       BEFORE UPDATE ON person       FOR EACH ROW EXECUTE FUNCTION guard_immutable_created_by();
CREATE TRIGGER venue_guard_creator        BEFORE UPDATE ON venue        FOR EACH ROW EXECUTE FUNCTION guard_immutable_created_by();
CREATE TRIGGER project_guard_creator      BEFORE UPDATE ON project      FOR EACH ROW EXECUTE FUNCTION guard_immutable_created_by();
CREATE TRIGGER line_guard_creator         BEFORE UPDATE ON line         FOR EACH ROW EXECUTE FUNCTION guard_immutable_created_by();
CREATE TRIGGER engagement_guard_creator   BEFORE UPDATE ON engagement   FOR EACH ROW EXECUTE FUNCTION guard_immutable_created_by();
CREATE TRIGGER show_guard_creator         BEFORE UPDATE ON show         FOR EACH ROW EXECUTE FUNCTION guard_immutable_created_by();
CREATE TRIGGER invoice_guard_creator      BEFORE UPDATE ON invoice      FOR EACH ROW EXECUTE FUNCTION guard_immutable_created_by();
CREATE TRIGGER payment_guard_creator      BEFORE UPDATE ON payment      FOR EACH ROW EXECUTE FUNCTION guard_immutable_created_by();
CREATE TRIGGER expense_guard_creator      BEFORE UPDATE ON expense      FOR EACH ROW EXECUTE FUNCTION guard_immutable_created_by();


CREATE OR REPLACE FUNCTION guard_immutable_author()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.author_id IS DISTINCT FROM OLD.author_id THEN
    RAISE EXCEPTION 'author_id is immutable on %', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

CREATE TRIGGER person_note_guard_author BEFORE UPDATE ON person_note FOR EACH ROW EXECUTE FUNCTION guard_immutable_author();

--------------------------------------------------------------------------------
-- 9. Show fee column guard (BEFORE UPDATE) — gates edit:money at write time
--------------------------------------------------------------------------------

-- Forward reference: has_permission() is defined in rls-policies.sql. The
-- trigger body is just stored text at CREATE time; resolution happens on fire.
-- By the time the first UPDATE lands, rls-policies.sql has applied.
CREATE OR REPLACE FUNCTION guard_show_fee_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.fee_amount   IS DISTINCT FROM OLD.fee_amount
  OR NEW.fee_currency IS DISTINCT FROM OLD.fee_currency THEN
    IF NOT public.has_permission(NEW.project_id, 'edit:money') THEN
      RAISE EXCEPTION 'edit:money required to modify show fee columns'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

COMMENT ON FUNCTION guard_show_fee_columns() IS
  'Column-level gate on show.fee_amount/fee_currency. Requires edit:money. Complements show_redacted view (read path).';

CREATE TRIGGER show_guard_fee_columns
  BEFORE UPDATE ON show
  FOR EACH ROW EXECUTE FUNCTION guard_show_fee_columns();

--------------------------------------------------------------------------------
-- 10. Auth trigger — provision user on signup
--------------------------------------------------------------------------------

-- Creates user_profile + personal workspace + owner workspace_membership on
-- every auth.users INSERT. The workspace INSERT fires `workspace_seed_roles`
-- in cascade, which seeds the 15 system roles.
--
-- Causal chain:
--   auth.users INSERT
--     → trigger on_auth_user_created
--       → handle_new_user()
--         → INSERT INTO public.workspace
--           → trigger workspace_seed_roles (AFTER INSERT on workspace)
--             → seed_system_roles_on_workspace()
--         → INSERT INTO public.workspace_membership (owner)
--         → INSERT INTO public.user_profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_full_name    text;
  v_slug         text;
  v_workspace_id uuid;
BEGIN
  v_full_name := COALESCE(
    NEW.raw_user_meta_data ->> 'full_name',
    split_part(NEW.email, '@', 1)
  );

  -- user_profile
  INSERT INTO public.user_profile (user_id, full_name, locale)
  VALUES (
    NEW.id,
    v_full_name,
    COALESCE(NEW.raw_user_meta_data ->> 'locale', 'es')
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- personal workspace (slug = email local-part, collision-safe)
  v_slug := regexp_replace(lower(split_part(NEW.email, '@', 1)), '[^a-z0-9-]+', '-', 'g');
  IF v_slug IS NULL OR v_slug = '' OR v_slug = '-' THEN
    v_slug := 'user-' || substr(NEW.id::text, 1, 8);
  END IF;
  WHILE EXISTS (SELECT 1 FROM public.workspace WHERE slug = v_slug) LOOP
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 4);
  END LOOP;

  -- INSERT cascades into workspace_seed_roles trigger, which inserts 15 rows
  -- into workspace_role.
  INSERT INTO public.workspace (slug, name, kind)
  VALUES (v_slug, v_full_name, 'personal')
  RETURNING id INTO v_workspace_id;

  -- owner membership for the new workspace
  INSERT INTO public.workspace_membership (workspace_id, user_id, role, accepted_at)
  VALUES (v_workspace_id, NEW.id, 'owner', now());

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Provisions user_profile + personal workspace + owner workspace_membership. System roles are seeded by the workspace_seed_roles trigger in cascade.';

-- Bind the trigger to auth.users. Dropped along with the public schema on
-- each reset because it depends on public.handle_new_user() (CASCADE drops
-- dependent triggers). Recreated here so a fresh environment is self-contained.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

--------------------------------------------------------------------------------
-- End of schema.sql
--------------------------------------------------------------------------------
