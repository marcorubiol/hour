-- Hour — Phase 0 Schema
-- Target: Supabase Cloud (Postgres 15+)
-- Convention: UUID v7 PKs, organization_id on all tenant-scoped tables,
--             soft-delete via deleted_at, timestamps on every table.
-- Generated: 2026-04-19

--------------------------------------------------------------------------------
-- 0. Extensions & helpers
--------------------------------------------------------------------------------

-- UUID v7 generation (RFC 9562) via pgcrypto; no external extension needed.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

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

CREATE TYPE org_type            AS ENUM ('company', 'collective', 'freelancer');
CREATE TYPE membership_role     AS ENUM ('owner', 'admin', 'member', 'viewer');
CREATE TYPE project_status      AS ENUM ('draft', 'active', 'archived');
CREATE TYPE contact_tier        AS ENUM ('private', 'tagged');
CREATE TYPE contact_project_status AS ENUM (
  'prospect', 'contacted', 'proposal_sent', 'negotiating',
  'booked', 'confirmed', 'done', 'lost'
);
CREATE TYPE event_type          AS ENUM ('gig', 'rehearsal', 'meeting', 'travel', 'other');
CREATE TYPE event_status        AS ENUM ('tentative', 'confirmed', 'cancelled');
CREATE TYPE task_section        AS ENUM ('dispatch', 'queue', 'ping', 'deferred', 'shelf', 'trace');
CREATE TYPE file_status         AS ENUM ('pending', 'ready', 'deleted');
CREATE TYPE linkable_entity     AS ENUM ('project', 'contact', 'event', 'rider');
CREATE TYPE notable_entity      AS ENUM ('project', 'contact', 'event');

--------------------------------------------------------------------------------
-- 2. organization
--------------------------------------------------------------------------------

CREATE TABLE organization (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  name            TEXT        NOT NULL,
  slug            TEXT        NOT NULL UNIQUE,
  type            org_type    NOT NULL DEFAULT 'company',
  default_locale  TEXT        NOT NULL DEFAULT 'es' CHECK (default_locale IN ('es', 'en')),
  timezone        TEXT        NOT NULL DEFAULT 'Europe/Madrid',
  logo_r2_key     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE TRIGGER organization_updated_at
  BEFORE UPDATE ON organization
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

--------------------------------------------------------------------------------
-- 3. user_profile (mirrors auth.users — NOT tenant-scoped)
--------------------------------------------------------------------------------

CREATE TABLE user_profile (
  id                UUID        PRIMARY KEY,  -- = auth.users.id
  email             TEXT        NOT NULL UNIQUE,
  full_name         TEXT,
  avatar_url        TEXT,
  locale_preference TEXT        NOT NULL DEFAULT 'es' CHECK (locale_preference IN ('es', 'en')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER user_profile_updated_at
  BEFORE UPDATE ON user_profile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Sync new auth.users → user_profile
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profile (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

--------------------------------------------------------------------------------
-- 4. membership
--------------------------------------------------------------------------------

CREATE TABLE membership (
  id              UUID            PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id         UUID            NOT NULL REFERENCES user_profile(id),
  organization_id UUID            NOT NULL REFERENCES organization(id),
  role            membership_role NOT NULL DEFAULT 'member',
  invited_at      TIMESTAMPTZ,
  accepted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id)
);

CREATE INDEX idx_membership_org ON membership (organization_id);

--------------------------------------------------------------------------------
-- 5. project
--------------------------------------------------------------------------------

CREATE TABLE project (
  id              UUID            PRIMARY KEY DEFAULT uuid_generate_v7(),
  organization_id UUID            NOT NULL REFERENCES organization(id),
  name            TEXT            NOT NULL,
  slug            TEXT            NOT NULL,
  description     TEXT,
  status          project_status  NOT NULL DEFAULT 'draft',
  start_date      DATE,
  end_date        DATE,
  custom_fields   JSONB           NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (organization_id, slug)
);

COMMENT ON COLUMN project.custom_fields IS
  'Per-record extensible metadata. See contact.custom_fields for conventions.';

CREATE INDEX idx_project_org ON project (organization_id);

CREATE TRIGGER project_updated_at
  BEFORE UPDATE ON project
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

--------------------------------------------------------------------------------
-- 6. contact
--------------------------------------------------------------------------------

CREATE TABLE contact (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  organization_id UUID          NOT NULL REFERENCES organization(id),
  name            TEXT          NOT NULL,
  email           TEXT,
  phone           TEXT,
  company         TEXT,
  role_title      TEXT,
  tier            contact_tier  NOT NULL DEFAULT 'private',
  city            TEXT,
  country         TEXT,
  website         TEXT,
  notes           TEXT,
  custom_fields   JSONB         NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

COMMENT ON COLUMN contact.custom_fields IS
  'Per-record extensible metadata. Reserved keys: "sources" (provenance per import batch), "dossier_2026" (PDF enrichment). Prefer namespaced keys to avoid collisions.';

CREATE INDEX idx_contact_org              ON contact (organization_id);
CREATE INDEX idx_contact_org_email        ON contact (organization_id, email);
CREATE INDEX idx_contact_custom_fields_gin ON contact USING GIN (custom_fields jsonb_path_ops);

CREATE TRIGGER contact_updated_at
  BEFORE UPDATE ON contact
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

--------------------------------------------------------------------------------
-- 7. contact_project (Difusión pipeline join)
--------------------------------------------------------------------------------

CREATE TABLE contact_project (
  contact_id      UUID                   NOT NULL REFERENCES contact(id),
  project_id      UUID                   NOT NULL REFERENCES project(id),
  organization_id UUID                   NOT NULL REFERENCES organization(id),
  status          contact_project_status NOT NULL DEFAULT 'prospect',
  role_label      TEXT,
  created_at      TIMESTAMPTZ            NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ            NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  PRIMARY KEY (contact_id, project_id)
);

CREATE INDEX idx_contact_project_project ON contact_project (project_id);
CREATE INDEX idx_contact_project_org     ON contact_project (organization_id);

-- Validate that contact, project, and contact_project all share the same org.
-- Without this, denormalized organization_id could drift from the parent rows.
CREATE OR REPLACE FUNCTION validate_contact_project_org()
RETURNS TRIGGER AS $$
DECLARE
  contact_org UUID;
  project_org UUID;
BEGIN
  SELECT organization_id INTO contact_org FROM contact WHERE id = NEW.contact_id;
  SELECT organization_id INTO project_org FROM project WHERE id = NEW.project_id;

  IF NEW.organization_id <> contact_org OR NEW.organization_id <> project_org THEN
    RAISE EXCEPTION 'organization_id mismatch: contact_project.organization_id (%), contact (%), project (%)',
      NEW.organization_id, contact_org, project_org;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

CREATE TRIGGER contact_project_validate_org
  BEFORE INSERT OR UPDATE ON contact_project
  FOR EACH ROW EXECUTE FUNCTION validate_contact_project_org();

CREATE TRIGGER contact_project_updated_at
  BEFORE UPDATE ON contact_project
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

--------------------------------------------------------------------------------
-- 8. event
--------------------------------------------------------------------------------

CREATE TABLE event (
  id                   UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  organization_id      UUID          NOT NULL REFERENCES organization(id),
  project_id           UUID          REFERENCES project(id),
  title                TEXT          NOT NULL,
  type                 event_type    NOT NULL DEFAULT 'other',
  starts_at            TIMESTAMPTZ   NOT NULL,
  ends_at              TIMESTAMPTZ,
  all_day              BOOLEAN       NOT NULL DEFAULT FALSE,
  timezone             TEXT          NOT NULL DEFAULT 'Europe/Madrid',
  location_name        TEXT,
  location_address     TEXT,
  status               event_status  NOT NULL DEFAULT 'tentative',
  notes                TEXT,
  external_calendar_id TEXT,
  custom_fields        JSONB         NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ
);

COMMENT ON COLUMN event.custom_fields IS
  'Per-record extensible metadata. See contact.custom_fields for conventions.';

CREATE INDEX idx_event_org_project_starts ON event (organization_id, project_id, starts_at);

CREATE TRIGGER event_updated_at
  BEFORE UPDATE ON event
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

--------------------------------------------------------------------------------
-- 9. task
--------------------------------------------------------------------------------

CREATE TABLE task (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  organization_id UUID          NOT NULL REFERENCES organization(id),
  project_id      UUID          REFERENCES project(id),
  title           TEXT          NOT NULL,
  body            TEXT,
  section         task_section  NOT NULL DEFAULT 'dispatch',
  assigned_to     UUID          REFERENCES user_profile(id),
  priority        SMALLINT      NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
  due_date        DATE,
  defer_until     DATE,
  on_date         DATE,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_task_org_section  ON task (organization_id, section);
CREATE INDEX idx_task_assigned    ON task (organization_id, assigned_to);

CREATE TRIGGER task_updated_at
  BEFORE UPDATE ON task
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

--------------------------------------------------------------------------------
-- 10. file (metadata — bytes in R2)
--------------------------------------------------------------------------------

CREATE TABLE file (
  id              UUID            PRIMARY KEY DEFAULT uuid_generate_v7(),
  organization_id UUID            NOT NULL REFERENCES organization(id),
  entity_type     linkable_entity NOT NULL,
  entity_id       UUID            NOT NULL,
  r2_key          TEXT            NOT NULL,
  filename        TEXT            NOT NULL,
  mime_type       TEXT,
  size_bytes      BIGINT,
  status          file_status     NOT NULL DEFAULT 'pending',
  uploaded_by     UUID            NOT NULL REFERENCES user_profile(id),
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_file_entity ON file (entity_type, entity_id);
CREATE INDEX idx_file_org    ON file (organization_id);

CREATE TRIGGER file_updated_at
  BEFORE UPDATE ON file
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

--------------------------------------------------------------------------------
-- 11. note
--------------------------------------------------------------------------------

CREATE TABLE note (
  id              UUID            PRIMARY KEY DEFAULT uuid_generate_v7(),
  organization_id UUID            NOT NULL REFERENCES organization(id),
  entity_type     notable_entity  NOT NULL,
  entity_id       UUID            NOT NULL,
  body            TEXT            NOT NULL,
  author_id       UUID            NOT NULL REFERENCES user_profile(id),
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_note_entity ON note (entity_type, entity_id);
CREATE INDEX idx_note_org    ON note (organization_id);

CREATE TRIGGER note_updated_at
  BEFORE UPDATE ON note
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

--------------------------------------------------------------------------------
-- 12. rider
--------------------------------------------------------------------------------

CREATE TABLE rider (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  organization_id UUID        NOT NULL REFERENCES organization(id),
  project_id      UUID        NOT NULL REFERENCES project(id),
  title           TEXT        NOT NULL,
  body            TEXT,
  version         SMALLINT    NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_rider_org ON rider (organization_id);

CREATE TRIGGER rider_updated_at
  BEFORE UPDATE ON rider
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

--------------------------------------------------------------------------------
-- 13. crew_assignment
--------------------------------------------------------------------------------

CREATE TABLE crew_assignment (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  organization_id UUID        NOT NULL REFERENCES organization(id),
  event_id        UUID        NOT NULL REFERENCES event(id),
  contact_id      UUID        REFERENCES contact(id),
  user_id         UUID        REFERENCES user_profile(id),
  role_label      TEXT,
  confirmed       BOOLEAN     NOT NULL DEFAULT FALSE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  CHECK ((contact_id IS NULL) <> (user_id IS NULL))
);

CREATE INDEX idx_crew_org   ON crew_assignment (organization_id);
CREATE INDEX idx_crew_event ON crew_assignment (event_id);

--------------------------------------------------------------------------------
-- 14. tag + tagging
--------------------------------------------------------------------------------

CREATE TABLE tag (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  organization_id UUID        NOT NULL REFERENCES organization(id),
  name            TEXT        NOT NULL,
  color           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE INDEX idx_tag_org ON tag (organization_id);

CREATE TABLE tagging (
  tag_id          UUID NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organization(id),
  entity_type     TEXT NOT NULL,
  entity_id       UUID NOT NULL,
  PRIMARY KEY (tag_id, entity_type, entity_id)
);

CREATE INDEX idx_tagging_entity ON tagging (entity_type, entity_id);
CREATE INDEX idx_tagging_org    ON tagging (organization_id);

--------------------------------------------------------------------------------
-- 15. audit_log (append-only, immutable)
--------------------------------------------------------------------------------

CREATE TABLE audit_log (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  organization_id UUID        NOT NULL REFERENCES organization(id),
  actor_id        UUID        REFERENCES user_profile(id),
  action          TEXT        NOT NULL,
  entity_type     TEXT        NOT NULL,
  entity_id       UUID        NOT NULL,
  before          JSONB,
  after           JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_org        ON audit_log (organization_id);
CREATE INDEX idx_audit_entity     ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_created_at ON audit_log (organization_id, created_at);

--------------------------------------------------------------------------------
-- 16. Foreign-key indexes (covers unindexed FKs flagged by Supabase advisors)
--------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id      ON audit_log (actor_id);
CREATE INDEX IF NOT EXISTS idx_crew_assignment_contact ON crew_assignment (contact_id);
CREATE INDEX IF NOT EXISTS idx_crew_assignment_user    ON crew_assignment (user_id);
CREATE INDEX IF NOT EXISTS idx_event_project           ON event (project_id);
CREATE INDEX IF NOT EXISTS idx_file_uploaded_by        ON file (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_note_author             ON note (author_id);
CREATE INDEX IF NOT EXISTS idx_rider_project           ON rider (project_id);
CREATE INDEX IF NOT EXISTS idx_task_assigned_to        ON task (assigned_to);
CREATE INDEX IF NOT EXISTS idx_task_project            ON task (project_id);
