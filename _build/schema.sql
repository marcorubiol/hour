-- Hour — Phase 0 Schema (polymorphic redesign)
-- Target: Supabase Cloud (Postgres 15+)
-- Convention:
--   - UUID v7 PKs, `workspace_id` on every tenant-scoped table.
--   - Soft-delete via `deleted_at`.
--   - Timestamps (`created_at`, `updated_at`) on every table.
--   - Anti-CRM vocabulary: `engagement`, `date`, `person` — NEVER `lead`, `prospect`,
--     `pipeline`, `funnel`, `deal`, `conversion`, `campaign`.
--   - `date` is the universal child of a project (performance, rehearsal, residency,
--     travel_day, press, other). Replaces the old `event` table.
-- Superseded: earlier `organization / contact / contact_project / event` design.
-- Rationale: see DECISIONS.md 2026-04-19 "Polymorphic core: workspace + project + engagement".
-- Generated: 2026-04-19

--------------------------------------------------------------------------------
-- 0. Extensions & helpers
--------------------------------------------------------------------------------

-- Extensions used across the schema
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_bytes() for UUID v7
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive text (email)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- trigram indexes for fuzzy search

CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid AS $$
DECLARE
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  -- 48-bit Unix timestamp in milliseconds, big-endian
  unix_ts_ms := substring(
    int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint)
    FROM 3
  );
  -- Concatenate timestamp (6 bytes) + 10 random bytes
  uuid_bytes := unix_ts_ms || gen_random_bytes(10);
  -- Set version (byte 6, high nibble = 0111)
  uuid_bytes := set_byte(
    uuid_bytes, 6,
    (b'0111' || get_byte(uuid_bytes, 6)::bit(4))::bit(8)::integer
  );
  -- Set variant (byte 8, high nibble = 10xx)
  uuid_bytes := set_byte(
    uuid_bytes, 8,
    (b'10' || get_byte(uuid_bytes, 8)::bit(6))::bit(8)::integer
  );
  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE
SET search_path = extensions, public, pg_temp;

COMMENT ON FUNCTION uuid_generate_v7() IS
  'RFC 9562 UUID v7 — time-ordered. Replace with pg_uuidv7 extension or native uuidv7() when Supabase supports them.';

-- Shared trigger function for updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

--------------------------------------------------------------------------------
-- 1. Enums
--------------------------------------------------------------------------------

-- Workspaces
CREATE TYPE workspace_kind      AS ENUM ('personal', 'team');
CREATE TYPE membership_role     AS ENUM ('owner', 'admin', 'member', 'viewer', 'guest');

-- Projects (polymorphic via type)
CREATE TYPE project_type        AS ENUM ('show', 'release', 'creation_cycle', 'festival_edition');
CREATE TYPE project_status      AS ENUM ('draft', 'active', 'archived');
CREATE TYPE project_member_role AS ENUM ('lead', 'collaborator', 'viewer');

-- Dates (universal child of a project)
CREATE TYPE date_kind           AS ENUM ('performance', 'rehearsal', 'residency', 'travel_day', 'press', 'other');
CREATE TYPE date_status         AS ENUM ('tentative', 'held', 'confirmed', 'cancelled', 'performed');

-- Engagements (person × project × workspace relationship)
CREATE TYPE engagement_status   AS ENUM (
  'idea',         -- internal note, no outreach yet
  'proposed',     -- first contact sent, awaiting reply
  'discussing',   -- active conversation
  'held',         -- tentative booking, not signed
  'confirmed',    -- signed / committed
  'cancelled',    -- was confirmed/held, now off
  'declined',     -- they said no
  'performed',    -- past confirmed gig, archival
  'dormant'       -- no activity in a long time, not declined
);

-- Person notes
CREATE TYPE person_note_visibility AS ENUM ('workspace', 'private');

-- Polymorphic tagging target
CREATE TYPE taggable_entity     AS ENUM ('person', 'project', 'date', 'engagement');

--------------------------------------------------------------------------------
-- 2. Core tables (workspace scope)
--------------------------------------------------------------------------------

-- 2.1 workspace — top-level tenant. `kind=personal` is the default for every user
-- (one auto-created on signup); `kind=team` is opt-in and has >1 member.
CREATE TABLE workspace (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  kind        workspace_kind NOT NULL DEFAULT 'personal',
  country     char(2),                               -- ISO 3166-1 alpha-2
  timezone    text NOT NULL DEFAULT 'Europe/Madrid', -- IANA tz
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT workspace_slug_format CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  CONSTRAINT workspace_country_format CHECK (country IS NULL OR country ~ '^[A-Z]{2}$')
);

CREATE INDEX workspace_kind_idx        ON workspace (kind) WHERE deleted_at IS NULL;
CREATE INDEX workspace_deleted_at_idx  ON workspace (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TRIGGER workspace_set_updated_at
  BEFORE UPDATE ON workspace
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  workspace              IS 'Top-level tenant. One personal workspace per user (auto-created). Teams are shared workspaces with kind=team.';
COMMENT ON COLUMN workspace.kind         IS 'personal | team — drives UX defaults and billing scope in Phase 1.';
COMMENT ON COLUMN workspace.settings     IS 'App-level settings (locale, default currency, feature flags).';
COMMENT ON COLUMN workspace.custom_fields IS 'Per-workspace bag; see DECISIONS.md custom_fields ADR.';


-- 2.2 user_profile — 1:1 with auth.users, populated by handle_new_user trigger.
CREATE TABLE user_profile (
  user_id     uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  avatar_url  text,
  locale      text NOT NULL DEFAULT 'es',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER user_profile_set_updated_at
  BEFORE UPDATE ON user_profile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE user_profile IS '1:1 with auth.users. Auto-created by handle_new_user trigger.';


-- 2.3 membership — who belongs to which workspace and in what role.
CREATE TABLE membership (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id  uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role          membership_role NOT NULL DEFAULT 'member',
  accepted_at   timestamptz,      -- NULL = invited, awaiting acceptance
  invited_by    uuid REFERENCES auth.users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX membership_user_idx      ON membership (user_id);
CREATE INDEX membership_workspace_idx ON membership (workspace_id);

CREATE TRIGGER membership_set_updated_at
  BEFORE UPDATE ON membership
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  membership         IS 'Workspace-level roles. Personal workspaces have exactly one owner membership.';
COMMENT ON COLUMN membership.role    IS 'owner | admin | member | viewer | guest. Guest is scoped by project_membership.';


--------------------------------------------------------------------------------
-- 3. Projects (polymorphic via type)
--------------------------------------------------------------------------------

-- 3.1 project — a unit of work. The `type` discriminator replaces per-artefact
-- tables (show / release / tour / festival edition) with one shape and shared
-- child entities (`date`, `engagement`).
CREATE TABLE project (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  slug         text NOT NULL,
  name         text NOT NULL,
  type         project_type NOT NULL,
  status       project_status NOT NULL DEFAULT 'draft',
  starts_on    date,       -- premiere / release / first-day-of-creation
  ends_on      date,       -- nullable, ongoing projects have no end
  description  text,
  poster_url   text,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  UNIQUE (workspace_id, slug),
  CONSTRAINT project_slug_format CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  CONSTRAINT project_date_range   CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX project_workspace_idx    ON project (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX project_type_idx         ON project (workspace_id, type) WHERE deleted_at IS NULL;
CREATE INDEX project_status_idx       ON project (workspace_id, status) WHERE deleted_at IS NULL;

CREATE TRIGGER project_set_updated_at
  BEFORE UPDATE ON project
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  project          IS 'Polymorphic via type: show | release | creation_cycle | festival_edition.';
COMMENT ON COLUMN project.type     IS 'Discriminator. Drives UX templates and the meaning of date_kind values.';


-- 3.2 project_membership — per-project permissions with scope tokens.
-- Research profile 08 (manager/booking agent): guests see exactly one project,
-- scope controls which child entities they see within it.
CREATE TABLE project_membership (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  project_id  uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role        project_member_role NOT NULL DEFAULT 'collaborator',
  scope       text[] NOT NULL DEFAULT ARRAY['dates','engagements','documents','notes']::text[],
  invited_by  uuid REFERENCES auth.users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id),
  CONSTRAINT project_membership_scope_valid
    CHECK (scope <@ ARRAY['dates','engagements','documents','notes','finance']::text[])
);

CREATE INDEX project_membership_user_idx    ON project_membership (user_id);
CREATE INDEX project_membership_project_idx ON project_membership (project_id);

CREATE TRIGGER project_membership_set_updated_at
  BEFORE UPDATE ON project_membership
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  project_membership       IS 'Per-project permissions. Checked by has_project_access(project_id, scope).';
COMMENT ON COLUMN project_membership.scope IS 'Array of capability tokens: dates, engagements, documents, notes, finance.';


--------------------------------------------------------------------------------
-- 4. Dates (universal child of project)
--------------------------------------------------------------------------------

-- 4.1 date — the calendar primitive. Replaces old `event`.
-- `kind=performance` for gigs, `rehearsal` for internal rehearsals, `residency`
-- for multi-day residencies, `travel_day` for logistics, `press` for interviews/
-- media appearances, `other` for anything else.
CREATE TABLE date (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id  uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  kind          date_kind NOT NULL DEFAULT 'performance',
  status        date_status NOT NULL DEFAULT 'tentative',
  title         text,                  -- optional human label, esp. for `other`/`press`
  starts_at     timestamptz NOT NULL,  -- inclusive start
  ends_at       timestamptz,           -- optional; same-day default
  all_day       boolean NOT NULL DEFAULT false,
  season        text,                  -- e.g. '2026-27' — drives Difusión filters
  venue_name    text,                  -- denormalized for speed; can also link via engagement
  city          text,
  country       char(2),
  notes         text,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT date_country_format CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  CONSTRAINT date_time_range     CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

CREATE INDEX date_workspace_idx         ON date (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX date_project_idx           ON date (project_id) WHERE deleted_at IS NULL;
CREATE INDEX date_starts_at_idx         ON date (starts_at) WHERE deleted_at IS NULL;
CREATE INDEX date_season_idx            ON date (workspace_id, season) WHERE deleted_at IS NULL AND season IS NOT NULL;
CREATE INDEX date_status_idx            ON date (workspace_id, status) WHERE deleted_at IS NULL;
CREATE INDEX date_custom_fields_gin_idx ON date USING gin (custom_fields jsonb_path_ops);

CREATE TRIGGER date_set_updated_at
  BEFORE UPDATE ON date
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  date         IS 'Universal calendar primitive. Child of project.';
COMMENT ON COLUMN date.season  IS 'Free-text season label (e.g. 2026-27). Drives Difusión filters.';
COMMENT ON COLUMN date.status  IS 'tentative | held | confirmed | cancelled | performed.';


--------------------------------------------------------------------------------
-- 5. People (global) + engagements + notes
--------------------------------------------------------------------------------

-- 5.1 person — GLOBAL identity, NOT workspace-scoped.
-- One real human = one person row, deduped on email.
-- Readable by any authenticated user who has an engagement referencing them
-- (enforced in RLS, not via workspace_id column).
CREATE TABLE person (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  email         citext UNIQUE,           -- case-insensitive; nullable for unknown-email contacts
  full_name     text NOT NULL,
  first_name    text,
  last_name     text,
  phone         text,
  website       text,
  city          text,
  country       char(2),
  languages     text[] NOT NULL DEFAULT '{}'::text[],   -- e.g. ['es','ca','en']
  -- Professional identity (free-form; not tied to a workspace)
  organization_name text,                                -- "Teatro Lliure", "Festival Grec", etc.
  title         text,                                   -- "programadora", "tour manager", etc.
  -- System
  created_by    uuid REFERENCES auth.users (id),         -- first user to create this person row
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT person_country_format CHECK (country IS NULL OR country ~ '^[A-Z]{2}$')
);

-- citext requires the extension
CREATE EXTENSION IF NOT EXISTS "citext";

CREATE INDEX person_full_name_trgm_idx  ON person USING gin (full_name gin_trgm_ops);
CREATE INDEX person_custom_fields_gin_idx ON person USING gin (custom_fields jsonb_path_ops);
CREATE INDEX person_created_by_idx      ON person (created_by);

-- pg_trgm for fuzzy-name search
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE TRIGGER person_set_updated_at
  BEFORE UPDATE ON person
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  person            IS 'Global identity. Not workspace-scoped. Deduped on email.';
COMMENT ON COLUMN person.created_by IS 'First user to create this person row. Does not confer ownership; used for audit only.';


-- 5.2 engagement — the workspace-scoped professional relationship between a
-- person and a project. Replaces old `contact_project`.
CREATE TABLE engagement (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id      uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  project_id        uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  person_id         uuid NOT NULL REFERENCES person (id) ON DELETE RESTRICT,
  date_id           uuid REFERENCES date (id) ON DELETE SET NULL,  -- optional pin to a specific date
  status            engagement_status NOT NULL DEFAULT 'idea',
  role              text,                 -- e.g. 'programmer', 'promoter', 'press', 'tour_manager'
  first_contacted_at timestamptz,
  last_contacted_at  timestamptz,
  next_action_at     timestamptz,         -- optional reminder timestamp
  next_action_note   text,
  custom_fields     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by        uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  UNIQUE (workspace_id, project_id, person_id)
);

CREATE INDEX engagement_workspace_idx  ON engagement (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX engagement_project_idx    ON engagement (project_id) WHERE deleted_at IS NULL;
CREATE INDEX engagement_person_idx     ON engagement (person_id) WHERE deleted_at IS NULL;
CREATE INDEX engagement_date_idx       ON engagement (date_id) WHERE deleted_at IS NULL AND date_id IS NOT NULL;
CREATE INDEX engagement_status_idx     ON engagement (workspace_id, status) WHERE deleted_at IS NULL;
CREATE INDEX engagement_created_by_idx ON engagement (created_by);
CREATE INDEX engagement_custom_fields_gin_idx ON engagement USING gin (custom_fields jsonb_path_ops);

CREATE TRIGGER engagement_set_updated_at
  BEFORE UPDATE ON engagement
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  engagement        IS 'The relationship between a person and a project, within a workspace. Replaces contact_project.';
COMMENT ON COLUMN engagement.status IS 'Anti-CRM vocabulary. idea | proposed | discussing | held | confirmed | cancelled | declined | performed | dormant.';
COMMENT ON COLUMN engagement.date_id IS 'Optional pin to a specific date (typically when status transitions to confirmed).';


-- 5.3 person_note — workspace-scoped note on a person, with visibility scope.
-- The "mine vs ours" separation — research 99-patterns.md §3.1.
-- `workspace` visibility: readable by any workspace member.
-- `private`   visibility: readable only by the author.
CREATE TABLE person_note (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id  uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  person_id     uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  author_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  visibility    person_note_visibility NOT NULL DEFAULT 'workspace',
  body          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT person_note_body_nonempty CHECK (length(btrim(body)) > 0)
);

CREATE INDEX person_note_workspace_idx  ON person_note (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX person_note_person_idx     ON person_note (person_id) WHERE deleted_at IS NULL;
CREATE INDEX person_note_author_idx     ON person_note (author_id) WHERE deleted_at IS NULL;
CREATE INDEX person_note_visibility_idx ON person_note (workspace_id, visibility) WHERE deleted_at IS NULL;

CREATE TRIGGER person_note_set_updated_at
  BEFORE UPDATE ON person_note
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  person_note            IS 'Workspace-scoped note on a person. visibility controls mine-vs-ours.';
COMMENT ON COLUMN person_note.visibility IS 'workspace = any workspace member; private = author only.';


--------------------------------------------------------------------------------
-- 6. Tags (polymorphic)
--------------------------------------------------------------------------------

-- 6.1 tag — workspace-scoped label.
CREATE TABLE tag (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id  uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  name          text NOT NULL,
  color         text,    -- optional hex or css var
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE INDEX tag_workspace_idx ON tag (workspace_id);

CREATE TRIGGER tag_set_updated_at
  BEFORE UPDATE ON tag
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE tag IS 'Workspace-scoped label. Applied polymorphically via tagging.';


-- 6.2 tagging — polymorphic join table. `entity_type` restricted via enum.
CREATE TABLE tagging (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id  uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  tag_id        uuid NOT NULL REFERENCES tag (id) ON DELETE CASCADE,
  entity_type   taggable_entity NOT NULL,
  entity_id     uuid NOT NULL,
  created_by    uuid REFERENCES auth.users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tag_id, entity_type, entity_id)
);

CREATE INDEX tagging_workspace_idx ON tagging (workspace_id);
CREATE INDEX tagging_entity_idx    ON tagging (entity_type, entity_id);
CREATE INDEX tagging_tag_idx       ON tagging (tag_id);

COMMENT ON TABLE  tagging             IS 'Polymorphic tag application. entity_type restricted to taggable_entity enum.';
COMMENT ON COLUMN tagging.entity_type IS 'person | project | date | engagement.';


--------------------------------------------------------------------------------
-- 7. Audit log
--------------------------------------------------------------------------------

-- 7.1 audit_log — append-only. Written by per-table triggers.
CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id  uuid REFERENCES workspace (id) ON DELETE SET NULL,
  actor_id      uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  entity_type   text NOT NULL,                 -- table name
  entity_id     uuid NOT NULL,
  action        text NOT NULL,                 -- 'insert' | 'update' | 'delete' | 'soft_delete'
  changes       jsonb,                         -- diff of changed fields
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_workspace_idx ON audit_log (workspace_id, created_at DESC);
CREATE INDEX audit_log_entity_idx    ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_actor_idx     ON audit_log (actor_id, created_at DESC);

COMMENT ON TABLE audit_log IS 'Append-only audit trail. Populated by per-table triggers.';


--------------------------------------------------------------------------------
-- 8. Auth trigger — auto-create user_profile + personal workspace on signup
--------------------------------------------------------------------------------

-- Called by Supabase Auth trigger on auth.users INSERT.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_full_name text;
  v_slug      text;
  v_workspace_id uuid;
BEGIN
  v_full_name := COALESCE(
    NEW.raw_user_meta_data ->> 'full_name',
    split_part(NEW.email, '@', 1)
  );

  -- 1. user_profile
  INSERT INTO public.user_profile (user_id, full_name, locale)
  VALUES (
    NEW.id,
    v_full_name,
    COALESCE(NEW.raw_user_meta_data ->> 'locale', 'es')
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- 2. personal workspace — slug is email local-part, deduped with suffix if needed.
  v_slug := regexp_replace(lower(split_part(NEW.email, '@', 1)), '[^a-z0-9-]+', '-', 'g');
  IF v_slug IS NULL OR v_slug = '' OR v_slug = '-' THEN
    v_slug := 'user-' || substr(NEW.id::text, 1, 8);
  END IF;

  -- Collision-safe slug: append suffix if taken
  WHILE EXISTS (SELECT 1 FROM public.workspace WHERE slug = v_slug) LOOP
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 4);
  END LOOP;

  INSERT INTO public.workspace (slug, name, kind)
  VALUES (v_slug, v_full_name, 'personal')
  RETURNING id INTO v_workspace_id;

  -- 3. owner membership for the new workspace
  INSERT INTO public.membership (workspace_id, user_id, role, accepted_at)
  VALUES (v_workspace_id, NEW.id, 'owner', now());

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Auto-provisions user_profile, personal workspace, and owner membership on signup.';

-- Note: the actual trigger `on_auth_user_created` on `auth.users` lives in the
-- Supabase auth schema and is (re)created by the migration; not in this file.


--------------------------------------------------------------------------------
-- 9. FK indexes (covering indexes for FKs that need them and were not created above)
--------------------------------------------------------------------------------

-- All FK-backing indexes created inline alongside each table. This section
-- intentionally left minimal — every FK either uses the owning table's PK or
-- has a dedicated index declared above.
