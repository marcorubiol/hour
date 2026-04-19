-- Hour — Phase 0 RLS Policies
-- Target: Supabase Cloud (Postgres 15+)
-- Convention: Default DENY. Separate policies per operation per table.
--             Soft-delete rows (deleted_at IS NOT NULL) hidden from all SELECT.
--             Trash recovery is service-role only in Phase 0.
-- Generated: 2026-04-19

--------------------------------------------------------------------------------
-- 0. Helper functions (STABLE SECURITY DEFINER)
--------------------------------------------------------------------------------

-- Returns the organization_id from the JWT claim set by org switcher.
CREATE OR REPLACE FUNCTION current_org_id()
RETURNS UUID AS $$
  SELECT (auth.jwt() ->> 'current_org_id')::uuid;
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;

-- Alias for auth.uid() — keeps policy expressions self-documenting.
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS UUID AS $$
  SELECT auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;

-- Returns the caller's role in the current organization.
-- NULL if the user has no membership (policies treat NULL as denied).
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS membership_role AS $$
  SELECT role FROM membership
  WHERE user_id = auth.uid()
    AND organization_id = current_org_id();
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;

--------------------------------------------------------------------------------
-- 1. Enable RLS on all tables (default DENY)
--------------------------------------------------------------------------------

ALTER TABLE organization    ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization    FORCE ROW LEVEL SECURITY;

ALTER TABLE user_profile    ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profile    FORCE ROW LEVEL SECURITY;

ALTER TABLE membership      ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership      FORCE ROW LEVEL SECURITY;

ALTER TABLE project         ENABLE ROW LEVEL SECURITY;
ALTER TABLE project         FORCE ROW LEVEL SECURITY;

ALTER TABLE contact         ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact         FORCE ROW LEVEL SECURITY;

ALTER TABLE contact_project ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_project FORCE ROW LEVEL SECURITY;

ALTER TABLE event           ENABLE ROW LEVEL SECURITY;
ALTER TABLE event           FORCE ROW LEVEL SECURITY;

ALTER TABLE task            ENABLE ROW LEVEL SECURITY;
ALTER TABLE task            FORCE ROW LEVEL SECURITY;

ALTER TABLE file            ENABLE ROW LEVEL SECURITY;
ALTER TABLE file            FORCE ROW LEVEL SECURITY;

ALTER TABLE note            ENABLE ROW LEVEL SECURITY;
ALTER TABLE note            FORCE ROW LEVEL SECURITY;

ALTER TABLE rider           ENABLE ROW LEVEL SECURITY;
ALTER TABLE rider           FORCE ROW LEVEL SECURITY;

ALTER TABLE crew_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_assignment FORCE ROW LEVEL SECURITY;

ALTER TABLE tag             ENABLE ROW LEVEL SECURITY;
ALTER TABLE tag             FORCE ROW LEVEL SECURITY;

ALTER TABLE tagging         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tagging         FORCE ROW LEVEL SECURITY;

ALTER TABLE audit_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log       FORCE ROW LEVEL SECURITY;

--------------------------------------------------------------------------------
-- 2. user_profile (NOT tenant-scoped)
--------------------------------------------------------------------------------

-- User sees own profile + profiles of anyone sharing at least one org
-- (powers @mentions, crew lists). Consolidated from two permissive policies.
CREATE POLICY profile_select ON user_profile
  FOR SELECT TO authenticated
  USING (
    id = current_user_id()
    OR id IN (
      SELECT m2.user_id
      FROM membership m1
      JOIN membership m2 ON m1.organization_id = m2.organization_id
      WHERE m1.user_id = current_user_id()
    )
  );

-- Users edit only their own profile.
CREATE POLICY profile_update_own ON user_profile
  FOR UPDATE USING (id = current_user_id())
  WITH CHECK  (id = current_user_id());

-- INSERT: trigger-only (handle_new_user). No user-facing policy.
-- DELETE: service-role only (GDPR flow). No policy.

--------------------------------------------------------------------------------
-- 3. organization
--------------------------------------------------------------------------------

-- All members see their current org (live rows only).
CREATE POLICY org_select ON organization
  FOR SELECT USING (
    id = current_org_id()
    AND deleted_at IS NULL
  );

-- Owner/admin can update org settings.
CREATE POLICY org_update ON organization
  FOR UPDATE USING (
    id = current_org_id()
    AND current_user_role() IN ('owner', 'admin')
  )
  WITH CHECK (id = current_org_id());

-- Soft-delete restricted to owner via prevent_unauthorized_org_soft_delete trigger (§17).

-- INSERT: service-role only (org provisioning). No user-facing policy.

--------------------------------------------------------------------------------
-- 4. membership
--------------------------------------------------------------------------------

-- Consolidated SELECT: user sees their OWN memberships across ALL orgs (org switcher),
-- and owner/admin sees all memberships in the current org (team management).
CREATE POLICY membership_select ON membership
  FOR SELECT TO authenticated
  USING (
    user_id = current_user_id()
    OR (organization_id = current_org_id() AND current_user_role() IN ('owner','admin'))
  );

-- Owner/admin can invite (insert).
CREATE POLICY membership_insert ON membership
  FOR INSERT WITH CHECK (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin')
  );

-- Owner/admin can change roles.
CREATE POLICY membership_update ON membership
  FOR UPDATE USING (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin')
  )
  WITH CHECK (organization_id = current_org_id());

-- Owner/admin can remove members.
CREATE POLICY membership_delete ON membership
  FOR DELETE USING (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin')
  );

--------------------------------------------------------------------------------
-- 5. project
--------------------------------------------------------------------------------

CREATE POLICY project_select ON project
  FOR SELECT USING (
    organization_id = current_org_id()
    AND deleted_at IS NULL
  );

CREATE POLICY project_insert ON project
  FOR INSERT WITH CHECK (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin', 'member')
  );

CREATE POLICY project_update ON project
  FOR UPDATE USING (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin', 'member')
  )
  WITH CHECK (organization_id = current_org_id());

-- Soft-delete restricted to owner/admin via prevent_unauthorized_soft_delete trigger (§17).

--------------------------------------------------------------------------------
-- 6. contact
--------------------------------------------------------------------------------

CREATE POLICY contact_select ON contact
  FOR SELECT USING (
    organization_id = current_org_id()
    AND deleted_at IS NULL
  );

CREATE POLICY contact_insert ON contact
  FOR INSERT WITH CHECK (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin', 'member')
  );

CREATE POLICY contact_update ON contact
  FOR UPDATE USING (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin', 'member')
  )
  WITH CHECK (organization_id = current_org_id());

-- Soft-delete restricted to owner/admin via prevent_unauthorized_soft_delete trigger (§17).

--------------------------------------------------------------------------------
-- 7. contact_project
--------------------------------------------------------------------------------

CREATE POLICY contact_project_select ON contact_project
  FOR SELECT USING (
    organization_id = current_org_id()
    AND deleted_at IS NULL
  );

CREATE POLICY contact_project_insert ON contact_project
  FOR INSERT WITH CHECK (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin', 'member')
  );

CREATE POLICY contact_project_update ON contact_project
  FOR UPDATE USING (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin', 'member')
  )
  WITH CHECK (organization_id = current_org_id());

-- Soft-delete restricted to owner/admin via prevent_unauthorized_soft_delete trigger (§17).

--------------------------------------------------------------------------------
-- 8. event
--------------------------------------------------------------------------------

CREATE POLICY event_select ON event
  FOR SELECT USING (
    organization_id = current_org_id()
    AND deleted_at IS NULL
  );

CREATE POLICY event_insert ON event
  FOR INSERT WITH CHECK (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin', 'member')
  );

CREATE POLICY event_update ON event
  FOR UPDATE USING (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin', 'member')
  )
  WITH CHECK (organization_id = current_org_id());

-- Soft-delete restricted to owner/admin via prevent_unauthorized_soft_delete trigger (§17).

--------------------------------------------------------------------------------
-- 9. task
--------------------------------------------------------------------------------

CREATE POLICY task_select ON task
  FOR SELECT USING (
    organization_id = current_org_id()
    AND deleted_at IS NULL
  );

CREATE POLICY task_insert ON task
  FOR INSERT WITH CHECK (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin', 'member')
  );

-- Owner/admin: update any task. Member: only tasks assigned to them or unassigned.
CREATE POLICY task_update ON task
  FOR UPDATE USING (
    organization_id = current_org_id()
    AND (
      current_user_role() IN ('owner', 'admin')
      OR (current_user_role() = 'member' AND (assigned_to = current_user_id() OR assigned_to IS NULL))
    )
  )
  WITH CHECK (organization_id = current_org_id());

-- task_delete policy removed — identical USING to task_update, redundant via OR.

--------------------------------------------------------------------------------
-- 10. file
--------------------------------------------------------------------------------

-- Column-level restrictions (member can only change status, not r2_key/filename)
-- enforced at app layer, not RLS.

CREATE POLICY file_select ON file
  FOR SELECT USING (
    organization_id = current_org_id()
    AND deleted_at IS NULL
  );

CREATE POLICY file_insert ON file
  FOR INSERT WITH CHECK (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin', 'member')
  );

CREATE POLICY file_update ON file
  FOR UPDATE USING (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin', 'member')
  )
  WITH CHECK (organization_id = current_org_id());

-- Soft-delete restricted to owner/admin via prevent_unauthorized_soft_delete trigger (§17).

--------------------------------------------------------------------------------
-- 11. note
--------------------------------------------------------------------------------

CREATE POLICY note_select ON note
  FOR SELECT USING (
    organization_id = current_org_id()
    AND deleted_at IS NULL
  );

CREATE POLICY note_insert ON note
  FOR INSERT WITH CHECK (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin', 'member')
  );

-- Consolidated UPDATE: author can always edit their own note;
-- owner/admin can soft-delete a live note. The non-author content-edit case is
-- blocked by the prevent_non_author_note_edit trigger (§17).
CREATE POLICY note_update ON note
  FOR UPDATE TO authenticated
  USING (
    organization_id = current_org_id()
    AND (
      author_id = current_user_id()
      OR (deleted_at IS NULL AND current_user_role() IN ('owner','admin'))
    )
  )
  WITH CHECK (organization_id = current_org_id());

--------------------------------------------------------------------------------
-- 12. rider
--------------------------------------------------------------------------------

CREATE POLICY rider_select ON rider
  FOR SELECT USING (
    organization_id = current_org_id()
    AND deleted_at IS NULL
  );

CREATE POLICY rider_insert ON rider
  FOR INSERT WITH CHECK (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin', 'member')
  );

CREATE POLICY rider_update ON rider
  FOR UPDATE USING (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin', 'member')
  )
  WITH CHECK (organization_id = current_org_id());

-- Soft-delete restricted to owner/admin via prevent_unauthorized_soft_delete trigger (§17).

--------------------------------------------------------------------------------
-- 13. crew_assignment
--------------------------------------------------------------------------------

CREATE POLICY crew_select ON crew_assignment
  FOR SELECT USING (
    organization_id = current_org_id()
    AND deleted_at IS NULL
  );

CREATE POLICY crew_insert ON crew_assignment
  FOR INSERT WITH CHECK (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin', 'member')
  );

CREATE POLICY crew_update ON crew_assignment
  FOR UPDATE USING (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin', 'member')
  )
  WITH CHECK (organization_id = current_org_id());

-- Soft-delete restricted to owner/admin via prevent_unauthorized_soft_delete trigger (§17).

--------------------------------------------------------------------------------
-- 14. tag
--------------------------------------------------------------------------------

CREATE POLICY tag_select ON tag
  FOR SELECT USING (organization_id = current_org_id());

CREATE POLICY tag_insert ON tag
  FOR INSERT WITH CHECK (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin', 'member')
  );

CREATE POLICY tag_update ON tag
  FOR UPDATE USING (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin')
  )
  WITH CHECK (organization_id = current_org_id());

CREATE POLICY tag_delete ON tag
  FOR DELETE USING (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin')
  );

--------------------------------------------------------------------------------
-- 15. tagging
--------------------------------------------------------------------------------

CREATE POLICY tagging_select ON tagging
  FOR SELECT USING (organization_id = current_org_id());

CREATE POLICY tagging_insert ON tagging
  FOR INSERT WITH CHECK (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin', 'member')
  );

-- No UPDATE policy — re-tag = delete + insert.

CREATE POLICY tagging_delete ON tagging
  FOR DELETE USING (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin', 'member')
  );

--------------------------------------------------------------------------------
-- 16. audit_log (immutable)
--------------------------------------------------------------------------------

-- SELECT: owner/admin only.
CREATE POLICY audit_select ON audit_log
  FOR SELECT USING (
    organization_id = current_org_id()
    AND current_user_role() IN ('owner', 'admin')
  );

-- No INSERT/UPDATE/DELETE policies for authenticated role.
-- Inserts happen exclusively via the SECURITY DEFINER trigger below.

--------------------------------------------------------------------------------
-- 17. Soft-delete guard triggers
--
-- RLS permissive policies are OR'd by Postgres, so a narrow _delete UPDATE
-- policy cannot restrict what a broader _update policy already permits.
-- These BEFORE UPDATE triggers are the actual enforcement layer.
--------------------------------------------------------------------------------

-- Guard for 7 standard tenant tables: only owner/admin can set deleted_at.
CREATE OR REPLACE FUNCTION prevent_unauthorized_soft_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.deleted_at IS NULL
     AND NEW.deleted_at IS NOT NULL
     AND current_user_role() NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only owner or admin can soft-delete % rows', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

CREATE TRIGGER guard_soft_delete_project
  BEFORE UPDATE ON project FOR EACH ROW EXECUTE FUNCTION prevent_unauthorized_soft_delete();
CREATE TRIGGER guard_soft_delete_contact
  BEFORE UPDATE ON contact FOR EACH ROW EXECUTE FUNCTION prevent_unauthorized_soft_delete();
CREATE TRIGGER guard_soft_delete_contact_project
  BEFORE UPDATE ON contact_project FOR EACH ROW EXECUTE FUNCTION prevent_unauthorized_soft_delete();
CREATE TRIGGER guard_soft_delete_event
  BEFORE UPDATE ON event FOR EACH ROW EXECUTE FUNCTION prevent_unauthorized_soft_delete();
CREATE TRIGGER guard_soft_delete_file
  BEFORE UPDATE ON file FOR EACH ROW EXECUTE FUNCTION prevent_unauthorized_soft_delete();
CREATE TRIGGER guard_soft_delete_rider
  BEFORE UPDATE ON rider FOR EACH ROW EXECUTE FUNCTION prevent_unauthorized_soft_delete();
CREATE TRIGGER guard_soft_delete_crew_assignment
  BEFORE UPDATE ON crew_assignment FOR EACH ROW EXECUTE FUNCTION prevent_unauthorized_soft_delete();

-- NOT attached to: task (member self-delete handled in task_update policy).
-- Note has its own guard: prevent_non_author_note_edit (below).

-- Guard for note: non-authors can only transition deleted_at (admin moderation).
-- Cannot rewrite another user's note content. Closes the permissive OR leak
-- between note_update (author-only) and note_delete (author + owner/admin).
CREATE OR REPLACE FUNCTION prevent_non_author_note_edit()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.author_id <> current_user_id()
     AND (OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at) THEN
    RAISE EXCEPTION 'Only the author can edit note content. Non-authors may only soft-delete (requires owner/admin).';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

CREATE TRIGGER prevent_non_author_note_edit
  BEFORE UPDATE ON note
  FOR EACH ROW EXECUTE FUNCTION prevent_non_author_note_edit();

-- Guard for organization: only owner can set deleted_at.
CREATE OR REPLACE FUNCTION prevent_unauthorized_org_soft_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.deleted_at IS NULL
     AND NEW.deleted_at IS NOT NULL
     AND current_user_role() <> 'owner' THEN
    RAISE EXCEPTION 'Only the organization owner can soft-delete the organization';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

CREATE TRIGGER guard_soft_delete_organization
  BEFORE UPDATE ON organization FOR EACH ROW EXECUTE FUNCTION prevent_unauthorized_org_soft_delete();

--------------------------------------------------------------------------------
-- 18. Audit trigger function + triggers
--
-- Phase 0 audit scope (deliberately narrow):
--   organization  — all ops
--   membership    — all ops
--   project       — status changes only
--   contact_project — status changes only
--   any tenant table — soft-delete transitions (deleted_at IS NOT NULL)
--
-- Explicitly NOT audited (high-volume, low-value in Phase 0):
--   task, note, tagging, file
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION write_audit_log()
RETURNS TRIGGER AS $$
DECLARE
  v_action TEXT;
  v_entity_type TEXT;
  v_entity_id UUID;
  v_before JSONB := NULL;
  v_after  JSONB := NULL;
  v_org_id UUID;
  should_log BOOLEAN := FALSE;
BEGIN
  v_entity_type := TG_TABLE_NAME;

  -- organization's own id IS its organization_id
  IF TG_TABLE_NAME = 'organization' THEN
    v_org_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    v_org_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action    := 'insert';
    v_entity_id := NEW.id;
    v_after     := to_jsonb(NEW);
    -- Log all inserts on audited tables.
    should_log  := TRUE;

  ELSIF TG_OP = 'UPDATE' THEN
    v_action    := 'update';
    v_entity_id := NEW.id;
    v_before    := to_jsonb(OLD);
    v_after     := to_jsonb(NEW);

    -- Soft-delete transition: always log.
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      v_action   := 'soft_delete';
      should_log := TRUE;
    -- Status change on project or contact_project: log.
    ELSIF v_entity_type IN ('project', 'contact_project')
      AND OLD.status IS DISTINCT FROM NEW.status THEN
      should_log := TRUE;
    -- All other updates on organization/membership: log.
    ELSIF v_entity_type IN ('organization', 'membership') THEN
      should_log := TRUE;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    -- Hard delete (service-role GDPR purge): log.
    v_action    := 'hard_delete';
    v_entity_id := OLD.id;
    v_before    := to_jsonb(OLD);
    should_log  := TRUE;
  END IF;

  IF should_log THEN
    INSERT INTO audit_log (organization_id, actor_id, action, entity_type, entity_id, before, after)
    VALUES (v_org_id, auth.uid(), v_action, v_entity_type, v_entity_id, v_before, v_after);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp;

-- Attach audit triggers to scoped tables.

CREATE TRIGGER audit_organization
  AFTER INSERT OR UPDATE OR DELETE ON organization
  FOR EACH ROW EXECUTE FUNCTION write_audit_log();

CREATE TRIGGER audit_membership
  AFTER INSERT OR UPDATE OR DELETE ON membership
  FOR EACH ROW EXECUTE FUNCTION write_audit_log();

CREATE TRIGGER audit_project
  AFTER UPDATE OR DELETE ON project
  FOR EACH ROW EXECUTE FUNCTION write_audit_log();

CREATE TRIGGER audit_contact_project
  AFTER UPDATE OR DELETE ON contact_project
  FOR EACH ROW EXECUTE FUNCTION write_audit_log();

-- Soft-delete + hard-delete audit on remaining tenant tables.
-- The trigger function's should_log logic filters to only soft-delete transitions
-- and hard deletes, skipping regular updates on these tables.

CREATE TRIGGER audit_contact
  AFTER UPDATE OR DELETE ON contact
  FOR EACH ROW EXECUTE FUNCTION write_audit_log();

CREATE TRIGGER audit_event
  AFTER UPDATE OR DELETE ON event
  FOR EACH ROW EXECUTE FUNCTION write_audit_log();

CREATE TRIGGER audit_rider
  AFTER UPDATE OR DELETE ON rider
  FOR EACH ROW EXECUTE FUNCTION write_audit_log();

CREATE TRIGGER audit_crew_assignment
  AFTER UPDATE OR DELETE ON crew_assignment
  FOR EACH ROW EXECUTE FUNCTION write_audit_log();
