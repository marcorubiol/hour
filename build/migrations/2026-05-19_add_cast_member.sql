-- =============================================================================
-- Migration: add_cast_member
-- Date: 2026-05-19
-- ADR-034: cast canónico vive a nivel project (no show), reasignable por show
--          vía cast_override existente. Crew sigue siendo show-scoped — el
--          schema acepta asimetría intencional porque el dominio la pide:
--          el cast de una producción se planifica una vez con sustituciones
--          puntuales, el crew se asigna show a show.
--
-- Applied via Supabase MCP apply_migration 2026-05-19 (name: add_cast_member).
-- This file is the canonical record.
-- =============================================================================

CREATE TABLE cast_member (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id  uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES project (id)   ON DELETE CASCADE,
  person_id     uuid NOT NULL REFERENCES person (id)    ON DELETE RESTRICT,
  role          text NOT NULL,
  joined_at     date,
  left_at       date,
  notes         text,
  created_by    uuid REFERENCES auth.users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT cast_member_role_nonempty CHECK (length(trim(role)) > 0),
  CONSTRAINT cast_member_date_range    CHECK (left_at IS NULL OR joined_at IS NULL OR left_at >= joined_at)
);

CREATE INDEX cast_member_workspace_idx ON cast_member (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX cast_member_project_idx   ON cast_member (project_id)   WHERE deleted_at IS NULL;
CREATE INDEX cast_member_person_idx    ON cast_member (person_id)    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX cast_member_project_person_role_uidx
  ON cast_member (project_id, person_id, role) WHERE deleted_at IS NULL;

CREATE TRIGGER cast_member_set_updated_at
  BEFORE UPDATE ON cast_member
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER cast_member_guard_ws
  BEFORE UPDATE ON cast_member
  FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();

CREATE TRIGGER cast_member_audit
  AFTER INSERT OR UPDATE OR DELETE ON cast_member
  FOR EACH ROW EXECUTE FUNCTION write_audit();

ALTER TABLE cast_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE cast_member FORCE  ROW LEVEL SECURITY;

CREATE POLICY cast_member_select ON cast_member
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND has_permission(project_id, 'edit:show'));

CREATE POLICY cast_member_insert ON cast_member
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id = current_workspace_id() AND has_permission(project_id, 'edit:show'));

CREATE POLICY cast_member_update ON cast_member
  FOR UPDATE TO authenticated
  USING      (deleted_at IS NULL AND has_permission(project_id, 'edit:show'))
  WITH CHECK (has_permission(project_id, 'edit:show'));

CREATE POLICY cast_member_delete ON cast_member
  FOR DELETE TO authenticated
  USING (has_permission(project_id, 'edit:show'));

COMMENT ON TABLE  cast_member IS
  'ADR-034: project-level canonical cast. Per-show substitutions live in cast_override (replaces_person_id resolves to a person previously listed here).';
COMMENT ON COLUMN cast_member.role IS
  'Freetext artistic role: performer, dancer, musician, narrator, co-director, etc. Vocabulary evolves per project; no closed enum in Phase 0.';
COMMENT ON COLUMN cast_member.joined_at IS
  'Optional: when this person joined the production. Useful for productions with rotating cast over a long run.';
COMMENT ON COLUMN cast_member.left_at IS
  'Optional: when this person left the production. Soft-deletion is preferred for permanent removal; left_at is for documented departures within an active project.';
