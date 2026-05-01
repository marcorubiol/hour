-- =============================================================================
-- Migration: reset_v2_roadsheet
-- Date: 2026-05-01
-- Source ADRs: ADR-023 (road sheet model), ADR-024 (slug naming), ADR-025
--              (CRDT transport — collab_snapshot only), D-PRE-10 (timezone),
--              D-PRE-12 (audit log — already applied, extends to new tables).
--
-- What this migration does:
--   §0 New enums: asset_kind, asset_direction.
--   §1 Extend `show` with 5 timeslots + 3 jsonb (logistics/hospitality/technical).
--   §2 Add `venue.timezone` (IANA tz id).
--   §3 Slug system: helpers + columns + backfill + triggers + unique indexes
--      across 7 tables (workspace, project, line, show, engagement, person,
--      venue). asset_version born with slug already.
--   §4 New tables: crew_assignment, cast_override, asset_version, collab_snapshot.
--   §5 RLS for the 4 new tables (workspace member SELECT, has_permission writes).
--   §6 Audit triggers on the 4 new tables (reuse existing write_audit()).
--
-- What is NOT in this migration (already applied or out of scope):
--   - audit_log table + write_audit() function (applied 2026-04-19).
--   - workspace.slug / workspace.timezone / project.slug (applied 2026-04-19).
--   - 14 audit triggers on existing tables (applied 2026-04-19).
--   - PartyServer/Durable Object scaffold (Phase 0.0 work, separate ticket).
--
-- Recovery if this fails: Postgres rolls back all DDL atomically. Source data
-- (154 contacts) is regenerable from build/import/ pipeline (see _decisions.md
-- 2026-05-01 — backup-of-derived-data is not a real risk).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §0  New enums
-- -----------------------------------------------------------------------------

CREATE TYPE asset_kind AS ENUM (
  'rider',                -- canonical rider PDF (Room/Project level)
  'stage_plot',           -- stage plot diagram
  'tech_sheet',           -- technical specifications sheet
  'bar_plot',             -- bar layout
  'dossier',              -- press / promo dossier
  'roadsheet_snapshot',   -- exported PDF snapshot of the road sheet (ADR-023)
  'photo',
  'video',
  'other'
);

CREATE TYPE asset_direction AS ENUM (
  'outbound',  -- ours, sent to venue (canonical or per-venue variant)
  'inbound',   -- venue's, returned to us (their tech sheet, bar plot, etc.)
  'adapted'    -- ours, modified for a specific venue (variant of canonical)
);

COMMENT ON TYPE asset_direction IS
  'ADR-023: bidirectional asset flow. inbound captures venue returns; adapted captures per-venue variants.';

-- -----------------------------------------------------------------------------
-- §1  Show extensions — timeslots + 3 jsonb (ADR-023)
-- -----------------------------------------------------------------------------

ALTER TABLE show
  ADD COLUMN load_in_at      timestamptz,
  ADD COLUMN soundcheck_at   timestamptz,
  ADD COLUMN show_start_at   timestamptz,
  ADD COLUMN loadout_at      timestamptz,
  ADD COLUMN wrap_at         timestamptz,
  ADD COLUMN logistics       jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN hospitality     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN technical       jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Temporal order check: each pair compared independently so a NULL in any slot
-- doesn't invalidate the row. Only adjacent pairs that BOTH have values are
-- enforced — partial schedules (e.g. only show_start_at known) are allowed.
ALTER TABLE show
  ADD CONSTRAINT show_timeslots_ordered CHECK (
    (load_in_at    IS NULL OR soundcheck_at IS NULL OR load_in_at    <= soundcheck_at) AND
    (soundcheck_at IS NULL OR show_start_at IS NULL OR soundcheck_at <= show_start_at) AND
    (show_start_at IS NULL OR loadout_at    IS NULL OR show_start_at <= loadout_at)    AND
    (loadout_at    IS NULL OR wrap_at       IS NULL OR loadout_at    <= wrap_at)
  );

CREATE INDEX show_logistics_gin_idx   ON show USING gin (logistics   jsonb_path_ops);
CREATE INDEX show_hospitality_gin_idx ON show USING gin (hospitality jsonb_path_ops);
CREATE INDEX show_technical_gin_idx   ON show USING gin (technical   jsonb_path_ops);

COMMENT ON COLUMN show.load_in_at    IS 'ADR-023: crew arrival / venue access begins.';
COMMENT ON COLUMN show.soundcheck_at IS 'ADR-023: soundcheck start.';
COMMENT ON COLUMN show.show_start_at IS 'ADR-023: doors-open / actual show start. May differ from performed_at (which is just a date).';
COMMENT ON COLUMN show.loadout_at    IS 'ADR-023: load-out start.';
COMMENT ON COLUMN show.wrap_at       IS 'ADR-023: crew leaves venue.';
COMMENT ON COLUMN show.logistics     IS 'ADR-023: venue access codes, parking, freight, travel notes, accommodation, visa flags.';
COMMENT ON COLUMN show.hospitality   IS 'ADR-023: dressing rooms, showers, per-diem, catering, dietary requirements, emergency info.';
COMMENT ON COLUMN show.technical     IS 'ADR-023: stage dimensions, in-house gear, power, comms, special needs.';

-- -----------------------------------------------------------------------------
-- §2  Venue timezone (D-PRE-10)
-- -----------------------------------------------------------------------------

ALTER TABLE venue ADD COLUMN timezone text;

COMMENT ON COLUMN venue.timezone IS
  'D-PRE-10: IANA timezone id (e.g. Europe/Madrid). Drives dual-timezone display in road sheet.';

-- -----------------------------------------------------------------------------
-- §3  Slug system (ADR-024)
-- -----------------------------------------------------------------------------
--   Strategy: app generates slugs (slugify + collision retry); DB enforces
--   invariants (format, not reserved, unique within scope). Hard-reject on
--   collision via partial unique index → app catches 23505 → modal to user.
-- -----------------------------------------------------------------------------

-- §3.1 Helpers ----------------------------------------------------------------

-- Deterministic slugifier. Lowercase, accent-fold via unaccent, replace
-- non-alphanumerics with '-', collapse repeats, trim, max 64 chars.
-- unaccent extension lives in `extensions` schema (Supabase convention).
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- STABLE (not IMMUTABLE) because unaccent() depends on a dictionary that
-- can change. Marking IMMUTABLE would lie to the planner and could yield
-- wrong results if we ever index slugify(name). DB review 2026-05-01 minor.
-- Trim AFTER truncation, not before — otherwise a name that produces a
-- 65th-char dash leaves a trailing dash after substring(... FOR 64).
-- Caught during smoke tests; original source had trim around the regexes.
CREATE OR REPLACE FUNCTION public.slugify(input text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT trim(BOTH '-' FROM
    substring(
      regexp_replace(
        regexp_replace(
          lower(extensions.unaccent(coalesce(input, ''))),
          '[^a-z0-9]+', '-', 'g'
        ),
        '-+', '-', 'g'
      )
      FROM 1 FOR 64
    )
  );
$$;

COMMENT ON FUNCTION public.slugify(text) IS
  'ADR-024: deterministic slugifier. Lowercase + accent-fold + dash-separate + clamp 64. Pure; safe to call from triggers.';

-- Reserved-slug check. Mirror of apps/web/src/lib/reserved-slugs.ts
-- (RESERVED_WORKSPACE_SLUGS). Kept as inline array — list changes rarely; cost
-- of duplication is < cost of cross-language indirection. Keep them in sync.
CREATE OR REPLACE FUNCTION public.is_reserved_slug(candidate text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT lower(coalesce(candidate, '')) = ANY (ARRAY[
    -- Router / system
    'h', 'public', 'api', 'auth', 'login', 'logout',
    'signup', 'signin', 'signout', 'oauth',
    -- Marketing site (Phase 1)
    'www', 'app', 'home', 'about', 'pricing', 'docs', 'blog',
    'help', 'support', 'legal', 'terms', 'privacy', 'contact',
    'careers', 'status', 'changelog',
    -- Conventions
    'admin', 'settings', 'account', 'profile', 'billing',
    'dashboard', 'new', 'edit', 'delete', 'search',
    'explore', 'discover',
    -- Hour product vocabulary
    'house', 'room', 'run', 'gig', 'desk', 'plaza',
    'roadsheet', 'engagement', 'person', 'venue', 'asset',
    'invoice', 'calendar', 'contacts', 'money', 'comms', 'archive',
    -- Operational
    'staging', 'dev', 'playground', 'booking',
    'assets', 'static', 'cdn'
  ]);
$$;

COMMENT ON FUNCTION public.is_reserved_slug(text) IS
  'ADR-024: mirrors RESERVED_WORKSPACE_SLUGS in apps/web/src/lib/reserved-slugs.ts. Update both together.';

-- Generic slug validator trigger. Applies on INSERT and on UPDATE OF slug.
-- Enforces format + reserved + length. Uniqueness is left to partial unique
-- indexes (per-table, scoped to workspace_id where applicable).
CREATE OR REPLACE FUNCTION public.validate_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.slug IS NULL OR length(NEW.slug) = 0 THEN
    RAISE EXCEPTION 'slug cannot be empty' USING ERRCODE = '22023';
  END IF;
  IF NEW.slug !~ '^[a-z0-9](-?[a-z0-9])*$' THEN
    RAISE EXCEPTION 'invalid slug format: % (use lowercase letters, digits, single dashes; no leading/trailing dash)', NEW.slug
      USING ERRCODE = '22023';
  END IF;
  IF length(NEW.slug) > 64 THEN
    RAISE EXCEPTION 'slug too long (max 64): %', NEW.slug USING ERRCODE = '22023';
  END IF;
  IF public.is_reserved_slug(NEW.slug) THEN
    RAISE EXCEPTION 'slug % is reserved', NEW.slug USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.validate_slug() IS
  'ADR-024: format + reserved-list guard. Uniqueness is enforced by per-table partial unique indexes.';

-- §3.2 Add columns ------------------------------------------------------------
-- workspace and project already have `slug text NOT NULL`. Add previous_slugs
-- to both. The other 5 tables get both columns; slug starts NULLABLE so the
-- backfill can populate it before SET NOT NULL.

ALTER TABLE workspace  ADD COLUMN previous_slugs text[] NOT NULL DEFAULT '{}';
ALTER TABLE project    ADD COLUMN previous_slugs text[] NOT NULL DEFAULT '{}';

ALTER TABLE line       ADD COLUMN slug text, ADD COLUMN previous_slugs text[] NOT NULL DEFAULT '{}';
ALTER TABLE show       ADD COLUMN slug text, ADD COLUMN previous_slugs text[] NOT NULL DEFAULT '{}';
ALTER TABLE engagement ADD COLUMN slug text, ADD COLUMN previous_slugs text[] NOT NULL DEFAULT '{}';
ALTER TABLE person     ADD COLUMN slug text, ADD COLUMN previous_slugs text[] NOT NULL DEFAULT '{}';
ALTER TABLE venue      ADD COLUMN slug text, ADD COLUMN previous_slugs text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN project.previous_slugs IS
  'ADR-024: rename history. Old slugs resolve to current entity for ≥12 months via GIN lookup (`previous_slugs @> ARRAY[old]`). Same shape on every entity that has a slug.';

-- §3.3 Backfill ---------------------------------------------------------------
-- Person: slugify(full_name); collisions resolved with -2/-3 suffix on
-- backfill (one-off exception to the hard-reject rule, documented in ADR-024).
-- Engagement: same slug as its person (1:1 in current data).
-- Line/Show/Venue: empty in production, no backfill needed.

-- Backfill collision-resolution: first occurrence by (created_at, id) keeps
-- the natural slug; subsequent ones get an id-derived 6-char hex suffix.
-- Why id-suffix instead of row_number suffix: a row_number suffix like
-- `pep-2` could collide with a person actually named "Pep 2" whose natural
-- slug is `pep-2`. id-suffix uses the first 6 hex chars of the row's UUID v7,
-- guaranteeing uniqueness against any natural slug at zero practical risk
-- (16M+ combinations vs. our 154 rows). DB review 2026-05-01 #1.
UPDATE person
SET slug = sub.candidate
FROM (
  SELECT
    id,
    CASE
      WHEN row_number() OVER (PARTITION BY public.slugify(full_name) ORDER BY created_at, id) = 1
        THEN public.slugify(full_name)
      ELSE public.slugify(full_name) || '-' ||
           substring(replace(id::text, '-', '') FROM 1 FOR 6)
    END AS candidate
  FROM person
  WHERE deleted_at IS NULL
) sub
WHERE person.id = sub.id;

-- Same id-suffix scheme for engagements. Each engagement's natural slug
-- comes from its person's already-backfilled slug (1:1 in current data).
UPDATE engagement
SET slug = sub.candidate
FROM (
  SELECT
    e.id,
    CASE
      WHEN row_number() OVER (PARTITION BY p.slug ORDER BY e.created_at, e.id) = 1
        THEN p.slug
      ELSE p.slug || '-' ||
           substring(replace(e.id::text, '-', '') FROM 1 FOR 6)
    END AS candidate
  FROM engagement e
  JOIN person p ON p.id = e.person_id
  WHERE e.deleted_at IS NULL
) sub
WHERE engagement.id = sub.id;

-- Sanity: no NULLs left in person/engagement (the rows we just touched).
-- line/show/venue stay all-NULL because they have zero rows.

-- §3.4 SET NOT NULL on populated tables ---------------------------------------
ALTER TABLE person     ALTER COLUMN slug SET NOT NULL;
ALTER TABLE engagement ALTER COLUMN slug SET NOT NULL;

-- line/show/venue: keep slug NULLABLE for now — they will get NOT NULL when
-- their first row is created. The application sets slug at creation time, and
-- the partial unique index below scopes to NOT NULL anyway. We will tighten to
-- NOT NULL in a follow-up migration once we are certain every insert path sets
-- slug. (Lower-risk path than setting NOT NULL on empty tables and discovering
-- a missing-slug bug at first insert.)

-- §3.5 Partial unique indexes -------------------------------------------------
-- Scoped to (workspace_id, slug) and limited to non-deleted rows. Workspace's
-- own index has no workspace_id (it IS the workspace).

CREATE UNIQUE INDEX workspace_slug_uidx
  ON workspace (slug) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX project_slug_uidx
  ON project (workspace_id, slug) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX line_slug_uidx
  ON line (workspace_id, slug) WHERE deleted_at IS NULL AND slug IS NOT NULL;

CREATE UNIQUE INDEX show_slug_uidx
  ON show (workspace_id, slug) WHERE deleted_at IS NULL AND slug IS NOT NULL;

CREATE UNIQUE INDEX engagement_slug_uidx
  ON engagement (workspace_id, slug) WHERE deleted_at IS NULL;

-- person.slug is GLOBALLY unique. person has no workspace_id (anti-CRM
-- vocab: "person (global, shared)"). Two workspaces sharing the same person
-- see the same slug; two distinct persons with identical full_name across
-- workspaces get auto-resolved by the id-suffix scheme on backfill.
CREATE UNIQUE INDEX person_slug_uidx
  ON person (slug) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX venue_slug_uidx
  ON venue (workspace_id, slug) WHERE deleted_at IS NULL AND slug IS NOT NULL;

-- GIN on previous_slugs for redirect lookup (one shared shape per scope).
CREATE INDEX project_previous_slugs_gin    ON project    USING gin (previous_slugs);
CREATE INDEX line_previous_slugs_gin       ON line       USING gin (previous_slugs);
CREATE INDEX show_previous_slugs_gin       ON show       USING gin (previous_slugs);
CREATE INDEX engagement_previous_slugs_gin ON engagement USING gin (previous_slugs);
CREATE INDEX person_previous_slugs_gin     ON person     USING gin (previous_slugs);
CREATE INDEX venue_previous_slugs_gin      ON venue      USING gin (previous_slugs);

-- §3.6 Validate triggers ------------------------------------------------------
-- BEFORE INSERT or UPDATE OF slug → format/reserved/length guard.

CREATE TRIGGER workspace_slug_validate
  BEFORE INSERT OR UPDATE OF slug ON workspace
  FOR EACH ROW EXECUTE FUNCTION public.validate_slug();

CREATE TRIGGER project_slug_validate
  BEFORE INSERT OR UPDATE OF slug ON project
  FOR EACH ROW EXECUTE FUNCTION public.validate_slug();

CREATE TRIGGER line_slug_validate
  BEFORE INSERT OR UPDATE OF slug ON line
  FOR EACH ROW WHEN (NEW.slug IS NOT NULL)
  EXECUTE FUNCTION public.validate_slug();

CREATE TRIGGER show_slug_validate
  BEFORE INSERT OR UPDATE OF slug ON show
  FOR EACH ROW WHEN (NEW.slug IS NOT NULL)
  EXECUTE FUNCTION public.validate_slug();

CREATE TRIGGER engagement_slug_validate
  BEFORE INSERT OR UPDATE OF slug ON engagement
  FOR EACH ROW EXECUTE FUNCTION public.validate_slug();

CREATE TRIGGER person_slug_validate
  BEFORE INSERT OR UPDATE OF slug ON person
  FOR EACH ROW EXECUTE FUNCTION public.validate_slug();

CREATE TRIGGER venue_slug_validate
  BEFORE INSERT OR UPDATE OF slug ON venue
  FOR EACH ROW WHEN (NEW.slug IS NOT NULL)
  EXECUTE FUNCTION public.validate_slug();

-- -----------------------------------------------------------------------------
-- §4  New tables (ADR-023 + ADR-025)
-- -----------------------------------------------------------------------------

-- §4.1 crew_assignment --------------------------------------------------------
CREATE TABLE crew_assignment (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id     uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  show_id          uuid NOT NULL REFERENCES show (id)      ON DELETE CASCADE,
  person_id        uuid NOT NULL REFERENCES person (id)    ON DELETE RESTRICT,
  role             text NOT NULL,
  contact_override jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes            text,
  created_by       uuid REFERENCES auth.users (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CONSTRAINT crew_assignment_role_nonempty CHECK (length(trim(role)) > 0)
);

CREATE INDEX crew_assignment_workspace_idx ON crew_assignment (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX crew_assignment_show_idx      ON crew_assignment (show_id)      WHERE deleted_at IS NULL;
CREATE INDEX crew_assignment_person_idx    ON crew_assignment (person_id)    WHERE deleted_at IS NULL;

-- A given (show, person, role) pairing should appear at most once active.
-- Soft-deleted rows excluded so re-assignment is allowed. (DB review #8.)
CREATE UNIQUE INDEX crew_assignment_show_person_role_uidx
  ON crew_assignment (show_id, person_id, role) WHERE deleted_at IS NULL;

CREATE TRIGGER crew_assignment_set_updated_at
  BEFORE UPDATE ON crew_assignment
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  crew_assignment IS
  'ADR-023: gig-specific crew roster. role is free-text (sound, lights, stage, tour-mgr, ...) — no enum, vocab evolves per project.';
COMMENT ON COLUMN crew_assignment.contact_override IS
  'ADR-023: per-gig override of canonical person contact (tour-specific phone, backup email, hotel room). Falls back to person.* when null/missing keys.';

-- §4.2 cast_override ----------------------------------------------------------
CREATE TABLE cast_override (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id        uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  show_id             uuid NOT NULL REFERENCES show (id)      ON DELETE CASCADE,
  person_id           uuid NOT NULL REFERENCES person (id)    ON DELETE RESTRICT,
  role                text NOT NULL,
  replaces_person_id  uuid REFERENCES person (id) ON DELETE SET NULL,
  reason              text,
  created_by          uuid REFERENCES auth.users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT cast_override_role_nonempty CHECK (length(trim(role)) > 0)
);

CREATE INDEX cast_override_workspace_idx ON cast_override (workspace_id)        WHERE deleted_at IS NULL;
CREATE INDEX cast_override_show_idx      ON cast_override (show_id)             WHERE deleted_at IS NULL;
CREATE INDEX cast_override_person_idx    ON cast_override (person_id)           WHERE deleted_at IS NULL;
CREATE INDEX cast_override_replaces_idx  ON cast_override (replaces_person_id)  WHERE deleted_at IS NULL AND replaces_person_id IS NOT NULL;

-- A given (show, person) appears at most once active — same person can't
-- have two cast overrides on the same gig. (DB review #8.)
CREATE UNIQUE INDEX cast_override_show_person_uidx
  ON cast_override (show_id, person_id) WHERE deleted_at IS NULL;

CREATE TRIGGER cast_override_set_updated_at
  BEFORE UPDATE ON cast_override
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE cast_override IS
  'ADR-023: gig-specific cast change (understudy, rotation) without polluting project-wide engagements.';

-- §4.3 asset_version ----------------------------------------------------------
-- One row per asset variant. The (project_id, line_id, show_id) trio
-- determines scope: project-level canonical, line-level (residency/season),
-- or show-level (per-venue inbound or adapted). Exactly one of the three is
-- typically NOT NULL, but we allow combinations (e.g. a line-level adapted
-- variant of a project-level canonical via adapted_from_id).

CREATE TABLE asset_version (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id     uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  project_id       uuid REFERENCES project (id) ON DELETE CASCADE,
  line_id          uuid REFERENCES line (id)    ON DELETE CASCADE,
  show_id          uuid REFERENCES show (id)    ON DELETE CASCADE,
  kind             asset_kind NOT NULL,
  direction        asset_direction NOT NULL DEFAULT 'outbound',
  adapted_from_id  uuid REFERENCES asset_version (id) ON DELETE SET NULL,
  url              text NOT NULL,
  slug             text,
  previous_slugs   text[] NOT NULL DEFAULT '{}',
  notes            text,
  uploaded_by      uuid REFERENCES auth.users (id),
  uploaded_at      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,

  -- Exactly one scope FK must be set. Multi-scope rows would create
  -- ambiguity in project_id_of_asset_version() and the RLS gate above.
  -- ADR-023 explicitly says scope is "typically one of". (DB review #3.)
  CONSTRAINT asset_version_scope_chk CHECK (
    num_nonnulls(project_id, line_id, show_id) = 1
  ),
  -- adapted variants must point to a source asset.
  CONSTRAINT asset_version_adapted_has_source CHECK (
    direction <> 'adapted' OR adapted_from_id IS NOT NULL
  ),
  -- inbound assets are always per-show (venue returns docs per gig).
  CONSTRAINT asset_version_inbound_has_show CHECK (
    direction <> 'inbound' OR show_id IS NOT NULL
  ),
  CONSTRAINT asset_version_url_nonempty CHECK (length(trim(url)) > 0)
);

CREATE INDEX asset_version_workspace_idx       ON asset_version (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX asset_version_project_idx         ON asset_version (project_id)   WHERE deleted_at IS NULL AND project_id IS NOT NULL;
CREATE INDEX asset_version_line_idx            ON asset_version (line_id)      WHERE deleted_at IS NULL AND line_id    IS NOT NULL;
CREATE INDEX asset_version_show_idx            ON asset_version (show_id)      WHERE deleted_at IS NULL AND show_id    IS NOT NULL;
CREATE INDEX asset_version_kind_idx            ON asset_version (workspace_id, kind, direction) WHERE deleted_at IS NULL;
CREATE INDEX asset_version_adapted_from_idx    ON asset_version (adapted_from_id) WHERE adapted_from_id IS NOT NULL;
CREATE INDEX asset_version_previous_slugs_gin  ON asset_version USING gin (previous_slugs);
CREATE UNIQUE INDEX asset_version_slug_uidx
  ON asset_version (workspace_id, slug) WHERE deleted_at IS NULL AND slug IS NOT NULL;

CREATE TRIGGER asset_version_set_updated_at
  BEFORE UPDATE ON asset_version
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER asset_version_slug_validate
  BEFORE INSERT OR UPDATE OF slug ON asset_version
  FOR EACH ROW WHEN (NEW.slug IS NOT NULL)
  EXECUTE FUNCTION public.validate_slug();

COMMENT ON TABLE asset_version IS
  'ADR-023: one row per asset variant. direction enum captures bidirectional flow (outbound/inbound/adapted).';
COMMENT ON COLUMN asset_version.url IS
  'R2 key or public URL for the asset payload. Phase 0: R2 key under MEDIA bucket.';
COMMENT ON COLUMN asset_version.adapted_from_id IS
  'Self-reference: an adapted variant points back to its canonical source.';

-- §4.4 collab_snapshot --------------------------------------------------------
-- Persistence sink for Yjs documents managed by the PartyServer Durable
-- Object (ADR-025). One row per snapshot; latest-version-wins on read.
-- Writes only by service_role (the DO's auth context).

CREATE TABLE collab_snapshot (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id  uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  target_table  text NOT NULL,
  target_id     uuid NOT NULL,
  snapshot      bytea NOT NULL,
  version       integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collab_snapshot_target_table_chk CHECK (
    target_table IN ('show', 'project')  -- expand as collab fields land in 0.2+
  ),
  CONSTRAINT collab_snapshot_version_positive CHECK (version > 0)
);

CREATE INDEX collab_snapshot_target_idx
  ON collab_snapshot (target_table, target_id, version DESC);
CREATE INDEX collab_snapshot_workspace_idx
  ON collab_snapshot (workspace_id);

-- Defensive: prevent the DO from inserting two snapshots with the same
-- (target_table, target_id, version) due to a bug or network retry.
-- (DB review #7.)
CREATE UNIQUE INDEX collab_snapshot_target_version_uidx
  ON collab_snapshot (target_table, target_id, version);

-- (COMMENT ON TABLE collab_snapshot is set after the RLS policies in §5,
-- where the access model is fully described.)

-- -----------------------------------------------------------------------------
-- §5  RLS for new tables
-- -----------------------------------------------------------------------------
--   Pattern (matches existing show/date policies):
--     - SELECT:                workspace member, not deleted
--     - INSERT/UPDATE/DELETE:  has_permission(<project_id>, 'edit:show')
--   The project_id resolution differs per table:
--     crew_assignment / cast_override / asset_version: via show_id → show.project_id
--     asset_version with line_id: via line.project_id
--     asset_version with project_id: directly
--   collab_snapshot: SELECT workspace member; writes service_role only.
-- -----------------------------------------------------------------------------

ALTER TABLE crew_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_assignment FORCE  ROW LEVEL SECURITY;
ALTER TABLE cast_override   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cast_override   FORCE  ROW LEVEL SECURITY;
ALTER TABLE asset_version   ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_version   FORCE  ROW LEVEL SECURITY;
ALTER TABLE collab_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE collab_snapshot FORCE  ROW LEVEL SECURITY;

-- Helper: project_id from show_id (saves repetition in policies).
CREATE OR REPLACE FUNCTION public.project_id_of_show(p_show_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT project_id FROM public.show WHERE id = p_show_id;
$$;

REVOKE ALL ON FUNCTION public.project_id_of_show(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.project_id_of_show(uuid) TO authenticated;

-- crew_assignment ------------------------------------------------------------
-- SELECT mirrors show_select / date_select: gated by has_permission, not just
-- workspace membership. A workspace member with no project_membership in the
-- show's project must NOT see crew of that project (DB review 2026-05-01 #4).
CREATE POLICY crew_assignment_select ON crew_assignment
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND has_permission(public.project_id_of_show(show_id), 'edit:show')
  );

CREATE POLICY crew_assignment_insert ON crew_assignment
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = current_workspace_id()
    AND has_permission(public.project_id_of_show(show_id), 'edit:show')
  );

CREATE POLICY crew_assignment_update ON crew_assignment
  FOR UPDATE TO authenticated
  USING (deleted_at IS NULL AND has_permission(public.project_id_of_show(show_id), 'edit:show'))
  WITH CHECK (has_permission(public.project_id_of_show(show_id), 'edit:show'));

CREATE POLICY crew_assignment_delete ON crew_assignment
  FOR DELETE TO authenticated
  USING (has_permission(public.project_id_of_show(show_id), 'edit:show'));

-- cast_override --------------------------------------------------------------
CREATE POLICY cast_override_select ON cast_override
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND has_permission(public.project_id_of_show(show_id), 'edit:show')
  );

CREATE POLICY cast_override_insert ON cast_override
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = current_workspace_id()
    AND has_permission(public.project_id_of_show(show_id), 'edit:show')
  );

CREATE POLICY cast_override_update ON cast_override
  FOR UPDATE TO authenticated
  USING (deleted_at IS NULL AND has_permission(public.project_id_of_show(show_id), 'edit:show'))
  WITH CHECK (has_permission(public.project_id_of_show(show_id), 'edit:show'));

CREATE POLICY cast_override_delete ON cast_override
  FOR DELETE TO authenticated
  USING (has_permission(public.project_id_of_show(show_id), 'edit:show'));

-- asset_version --------------------------------------------------------------
-- Resolve project_id from whichever scope FK is set.
CREATE OR REPLACE FUNCTION public.project_id_of_asset_version(
  p_project_id uuid, p_line_id uuid, p_show_id uuid
) RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    p_project_id,
    (SELECT project_id FROM public.line WHERE id = p_line_id),
    (SELECT project_id FROM public.show WHERE id = p_show_id)
  );
$$;

REVOKE ALL ON FUNCTION public.project_id_of_asset_version(uuid, uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.project_id_of_asset_version(uuid, uuid, uuid)
  TO authenticated;

CREATE POLICY asset_version_select ON asset_version
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND has_permission(
      public.project_id_of_asset_version(project_id, line_id, show_id),
      'edit:show'
    )
  );

CREATE POLICY asset_version_insert ON asset_version
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = current_workspace_id()
    AND has_permission(
      public.project_id_of_asset_version(project_id, line_id, show_id),
      'edit:show'
    )
  );

CREATE POLICY asset_version_update ON asset_version
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND has_permission(
      public.project_id_of_asset_version(project_id, line_id, show_id),
      'edit:show'
    )
  )
  WITH CHECK (
    has_permission(
      public.project_id_of_asset_version(project_id, line_id, show_id),
      'edit:show'
    )
  );

CREATE POLICY asset_version_delete ON asset_version
  FOR DELETE TO authenticated
  USING (
    has_permission(
      public.project_id_of_asset_version(project_id, line_id, show_id),
      'edit:show'
    )
  );

-- collab_snapshot ------------------------------------------------------------
-- SELECT: any workspace member can read snapshots of their workspace.
-- Writes: service_role only (the Durable Object hits Supabase with the
-- service-role key after validating the JWT itself in onBeforeConnect).
CREATE POLICY collab_snapshot_select ON collab_snapshot
  FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id));

-- No INSERT/UPDATE/DELETE policies for `authenticated` → all writes from
-- authenticated clients are denied. service_role bypasses RLS by default in
-- Supabase (BYPASSRLS attribute on the role), so DO writes work. Explicit
-- documentation:
COMMENT ON TABLE collab_snapshot IS
  'ADR-025: Yjs document snapshots persisted by the PartyServer Durable Object. Reads = workspace member. Writes = service_role only (via BYPASSRLS).';

-- -----------------------------------------------------------------------------
-- §6  Audit triggers on the 4 new tables
-- -----------------------------------------------------------------------------
-- Reuses public.write_audit() applied 2026-04-19 to 14 existing tables.

CREATE TRIGGER crew_assignment_audit
  AFTER INSERT OR UPDATE OR DELETE ON crew_assignment
  FOR EACH ROW EXECUTE FUNCTION public.write_audit();

CREATE TRIGGER cast_override_audit
  AFTER INSERT OR UPDATE OR DELETE ON cast_override
  FOR EACH ROW EXECUTE FUNCTION public.write_audit();

CREATE TRIGGER asset_version_audit
  AFTER INSERT OR UPDATE OR DELETE ON asset_version
  FOR EACH ROW EXECUTE FUNCTION public.write_audit();

-- collab_snapshot intentionally NOT audited — it is high-frequency machine
-- writes (every 30 updates / 60s per active road sheet), and the Yjs doc
-- itself is the source of truth for the collaborative content. Auditing
-- snapshots would balloon audit_log without value.

-- -----------------------------------------------------------------------------
-- §7  workspace_id immutability guards (DB review 2026-05-01 #9)
-- -----------------------------------------------------------------------------
-- Mirrors the *_guard_ws pattern applied to the 13 existing tables
-- (schema.sql §8). Reuses the existing guard_immutable_workspace_id()
-- function — nothing new to define.

CREATE TRIGGER crew_assignment_guard_ws
  BEFORE UPDATE ON crew_assignment
  FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();

CREATE TRIGGER cast_override_guard_ws
  BEFORE UPDATE ON cast_override
  FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();

CREATE TRIGGER asset_version_guard_ws
  BEFORE UPDATE ON asset_version
  FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();

CREATE TRIGGER collab_snapshot_guard_ws
  BEFORE UPDATE ON collab_snapshot
  FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();

COMMIT;
