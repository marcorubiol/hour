-- Hour — Phase 0 RLS Policies (polymorphic redesign)
-- Target: Supabase Cloud (Postgres 15+)
-- Convention:
--   - Default DENY. Separate policies per operation per table.
--   - Soft-delete rows (deleted_at IS NOT NULL) hidden from all SELECT.
--   - Trash recovery is service-role only in Phase 0.
--   - `workspace_id` is the tenant scope everywhere. Claim name in JWT:
--     `current_workspace_id` (injected by public.custom_access_token_hook).
--   - Anti-CRM vocabulary: helpers and policies speak of engagements, dates,
--     persons — never leads, prospects, deals, pipelines.
-- Generated: 2026-04-19
-- Supersedes: earlier `current_org_id` / `organization` helper set.

--------------------------------------------------------------------------------
-- 0. Helper functions (STABLE SECURITY DEFINER)
--------------------------------------------------------------------------------

-- 0.1 current_workspace_id — from JWT claim set by workspace switcher.
CREATE OR REPLACE FUNCTION current_workspace_id()
RETURNS uuid AS $$
  SELECT (auth.jwt() ->> 'current_workspace_id')::uuid;
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION current_workspace_id() IS
  'Active workspace for this request. Populated by custom_access_token_hook or by an explicit workspace switch.';


-- 0.2 current_user_id — alias for auth.uid() for self-documenting policies.
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS uuid AS $$
  SELECT auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;


-- 0.3 current_workspace_role — caller's role in the active workspace.
-- NULL if the user has no accepted membership.
CREATE OR REPLACE FUNCTION current_workspace_role()
RETURNS membership_role AS $$
  SELECT role FROM public.membership
  WHERE user_id = auth.uid()
    AND workspace_id = current_workspace_id()
    AND accepted_at IS NOT NULL;
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;


-- 0.4 is_workspace_member — true if caller has accepted membership in ws_id.
CREATE OR REPLACE FUNCTION is_workspace_member(ws_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.membership
    WHERE user_id = auth.uid()
      AND workspace_id = ws_id
      AND accepted_at IS NOT NULL
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;


-- 0.5 has_project_access — true if caller can access `p_scope` on `p_project_id`.
-- Gates: (a) non-guest workspace membership grants full project scope,
--        (b) explicit project_membership row grants scoped access.
CREATE OR REPLACE FUNCTION has_project_access(p_project_id uuid, p_scope text)
RETURNS boolean AS $$
  SELECT EXISTS (
    -- Path A: non-guest workspace member
    SELECT 1
    FROM public.project p
    JOIN public.membership m ON m.workspace_id = p.workspace_id
    WHERE p.id = p_project_id
      AND m.user_id = auth.uid()
      AND m.accepted_at IS NOT NULL
      AND m.role IN ('owner','admin','member','viewer')
      AND p.deleted_at IS NULL
  )
  OR EXISTS (
    -- Path B: guest or explicit project membership with scope token
    SELECT 1
    FROM public.project_membership pm
    WHERE pm.project_id = p_project_id
      AND pm.user_id = auth.uid()
      AND p_scope = ANY (pm.scope)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION has_project_access(uuid, text) IS
  'Access gate for child entities of a project (date, engagement, person_note). Scope tokens: dates, engagements, documents, notes, finance.';


-- 0.6 can_edit_project — true if caller has write access to the project.
-- Viewers and scope-only guests cannot edit.
CREATE OR REPLACE FUNCTION can_edit_project(p_project_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project p
    JOIN public.membership m ON m.workspace_id = p.workspace_id
    WHERE p.id = p_project_id
      AND m.user_id = auth.uid()
      AND m.accepted_at IS NOT NULL
      AND m.role IN ('owner','admin','member')
      AND p.deleted_at IS NULL
  )
  OR EXISTS (
    SELECT 1
    FROM public.project_membership pm
    WHERE pm.project_id = p_project_id
      AND pm.user_id = auth.uid()
      AND pm.role IN ('lead','collaborator')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;


-- 0.7 can_see_person — true if caller shares at least one engagement with person,
-- OR is the creator of the person row.
-- Rationale: `person` is global. A user can only see a person they have a
-- professional connection to (via any of their workspaces).
CREATE OR REPLACE FUNCTION can_see_person(p_person_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.person WHERE id = p_person_id AND created_by = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.engagement e
    JOIN public.membership m
      ON m.workspace_id = e.workspace_id
    WHERE e.person_id = p_person_id
      AND e.deleted_at IS NULL
      AND m.user_id = auth.uid()
      AND m.accepted_at IS NOT NULL
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;


--------------------------------------------------------------------------------
-- 1. Enable RLS on all tables (default DENY, FORCE on)
--------------------------------------------------------------------------------

ALTER TABLE workspace            ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace            FORCE ROW LEVEL SECURITY;

ALTER TABLE user_profile         ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profile         FORCE ROW LEVEL SECURITY;

ALTER TABLE membership           ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership           FORCE ROW LEVEL SECURITY;

ALTER TABLE project              ENABLE ROW LEVEL SECURITY;
ALTER TABLE project              FORCE ROW LEVEL SECURITY;

ALTER TABLE project_membership   ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_membership   FORCE ROW LEVEL SECURITY;

ALTER TABLE date                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE date                 FORCE ROW LEVEL SECURITY;

ALTER TABLE person               ENABLE ROW LEVEL SECURITY;
ALTER TABLE person               FORCE ROW LEVEL SECURITY;

ALTER TABLE engagement           ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement           FORCE ROW LEVEL SECURITY;

ALTER TABLE person_note          ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_note          FORCE ROW LEVEL SECURITY;

ALTER TABLE tag                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tag                  FORCE ROW LEVEL SECURITY;

ALTER TABLE tagging              ENABLE ROW LEVEL SECURITY;
ALTER TABLE tagging              FORCE ROW LEVEL SECURITY;

ALTER TABLE audit_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log            FORCE ROW LEVEL SECURITY;

--------------------------------------------------------------------------------
-- 2. workspace
--------------------------------------------------------------------------------

CREATE POLICY workspace_select ON workspace
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND is_workspace_member(id)
  );

CREATE POLICY workspace_update ON workspace
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM membership m
      WHERE m.workspace_id = workspace.id
        AND m.user_id = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.role IN ('owner','admin')
    )
  )
  WITH CHECK (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM membership m
      WHERE m.workspace_id = workspace.id
        AND m.user_id = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.role IN ('owner','admin')
    )
  );

-- Workspace creation is via handle_new_user trigger (personal) or a
-- service-role endpoint (team). RLS blocks direct INSERT from clients.

-- DELETE is soft-delete via UPDATE deleted_at. No RLS DELETE policy.

--------------------------------------------------------------------------------
-- 3. user_profile
--------------------------------------------------------------------------------

CREATE POLICY user_profile_select_self ON user_profile
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY user_profile_select_coworker ON user_profile
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM membership m1
      JOIN membership m2 ON m2.workspace_id = m1.workspace_id
      WHERE m1.user_id = auth.uid()
        AND m1.accepted_at IS NOT NULL
        AND m2.user_id = user_profile.user_id
        AND m2.accepted_at IS NOT NULL
    )
  );

CREATE POLICY user_profile_update_self ON user_profile
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

--------------------------------------------------------------------------------
-- 4. membership
--------------------------------------------------------------------------------

-- Auth-admin read for the access-token hook to mint `current_workspace_id` claim.
GRANT SELECT ON public.membership TO supabase_auth_admin;

CREATE POLICY auth_admin_read_membership ON membership
  FOR SELECT TO supabase_auth_admin
  USING (true);

-- Members of a workspace see all memberships in that workspace.
CREATE POLICY membership_select ON membership
  FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id));

-- Owners / admins can invite new members.
CREATE POLICY membership_insert ON membership
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM membership m
      WHERE m.workspace_id = membership.workspace_id
        AND m.user_id = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.role IN ('owner','admin')
    )
  );

-- Users can update their own row (accept invite, leave, update preferences);
-- owners/admins can update any membership in their workspace.
CREATE POLICY membership_update ON membership
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM membership m
      WHERE m.workspace_id = membership.workspace_id
        AND m.user_id = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.role IN ('owner','admin')
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM membership m
      WHERE m.workspace_id = membership.workspace_id
        AND m.user_id = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.role IN ('owner','admin')
    )
  );

CREATE POLICY membership_delete ON membership
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()   -- self-leave
    OR EXISTS (
      SELECT 1 FROM membership m
      WHERE m.workspace_id = membership.workspace_id
        AND m.user_id = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.role IN ('owner','admin')
    )
  );

--------------------------------------------------------------------------------
-- 5. project
--------------------------------------------------------------------------------

CREATE POLICY project_select ON project
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      is_workspace_member(workspace_id)
      OR EXISTS (
        SELECT 1 FROM project_membership pm
        WHERE pm.project_id = project.id
          AND pm.user_id = auth.uid()
      )
    )
  );

CREATE POLICY project_insert ON project
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = current_workspace_id()
    AND current_workspace_role() IN ('owner','admin','member')
  );

CREATE POLICY project_update ON project
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND can_edit_project(id)
  )
  WITH CHECK (
    can_edit_project(id)
  );

-- DELETE via soft-delete UPDATE; no hard-delete policy.

--------------------------------------------------------------------------------
-- 6. project_membership
--------------------------------------------------------------------------------

CREATE POLICY project_membership_select ON project_membership
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR has_project_access(project_id, 'engagements')
  );

-- Project leads and workspace owners/admins manage project_membership.
CREATE POLICY project_membership_write ON project_membership
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM project p
      JOIN membership m ON m.workspace_id = p.workspace_id
      WHERE p.id = project_membership.project_id
        AND m.user_id = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.role IN ('owner','admin')
    )
    OR EXISTS (
      SELECT 1 FROM project_membership pm
      WHERE pm.project_id = project_membership.project_id
        AND pm.user_id = auth.uid()
        AND pm.role = 'lead'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project p
      JOIN membership m ON m.workspace_id = p.workspace_id
      WHERE p.id = project_membership.project_id
        AND m.user_id = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.role IN ('owner','admin')
    )
    OR EXISTS (
      SELECT 1 FROM project_membership pm
      WHERE pm.project_id = project_membership.project_id
        AND pm.user_id = auth.uid()
        AND pm.role = 'lead'
    )
  );

--------------------------------------------------------------------------------
-- 7. date
--------------------------------------------------------------------------------

CREATE POLICY date_select ON date
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND has_project_access(project_id, 'dates')
  );

CREATE POLICY date_insert ON date
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = current_workspace_id()
    AND can_edit_project(project_id)
  );

CREATE POLICY date_update ON date
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND can_edit_project(project_id)
  )
  WITH CHECK (
    can_edit_project(project_id)
  );

--------------------------------------------------------------------------------
-- 8. person (global, non-tenant-scoped)
--------------------------------------------------------------------------------

-- Visibility: I can see a person if I'm engaged with them in any of my
-- workspaces, or if I created the row.
CREATE POLICY person_select ON person
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND can_see_person(id)
  );

-- Any authenticated user can create a person row (with created_by = self).
CREATE POLICY person_insert ON person
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Anyone who can see a person can update them (dedup / enrich).
-- Immutability of created_by enforced by guard trigger below.
CREATE POLICY person_update ON person
  FOR UPDATE TO authenticated
  USING (deleted_at IS NULL AND can_see_person(id))
  WITH CHECK (can_see_person(id));

--------------------------------------------------------------------------------
-- 9. engagement
--------------------------------------------------------------------------------

CREATE POLICY engagement_select ON engagement
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND has_project_access(project_id, 'engagements')
  );

CREATE POLICY engagement_insert ON engagement
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = current_workspace_id()
    AND can_edit_project(project_id)
    AND created_by = auth.uid()
  );

CREATE POLICY engagement_update ON engagement
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND can_edit_project(project_id)
  )
  WITH CHECK (
    can_edit_project(project_id)
  );

--------------------------------------------------------------------------------
-- 10. person_note (mine vs ours)
--------------------------------------------------------------------------------

-- SELECT rules:
--   visibility = 'workspace' → any workspace member
--   visibility = 'private'   → author only
CREATE POLICY person_note_select ON person_note
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      (visibility = 'workspace' AND is_workspace_member(workspace_id))
      OR (visibility = 'private' AND author_id = auth.uid())
    )
  );

CREATE POLICY person_note_insert ON person_note
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = current_workspace_id()
    AND is_workspace_member(workspace_id)
    AND author_id = auth.uid()
  );

-- Only the author can update or soft-delete their own notes.
CREATE POLICY person_note_update ON person_note
  FOR UPDATE TO authenticated
  USING (deleted_at IS NULL AND author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

--------------------------------------------------------------------------------
-- 11. tag
--------------------------------------------------------------------------------

CREATE POLICY tag_select ON tag
  FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id));

CREATE POLICY tag_write ON tag
  FOR ALL TO authenticated
  USING (
    is_workspace_member(workspace_id)
    AND current_workspace_role() IN ('owner','admin','member')
  )
  WITH CHECK (
    workspace_id = current_workspace_id()
    AND current_workspace_role() IN ('owner','admin','member')
  );

--------------------------------------------------------------------------------
-- 12. tagging
--------------------------------------------------------------------------------

CREATE POLICY tagging_select ON tagging
  FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id));

CREATE POLICY tagging_write ON tagging
  FOR ALL TO authenticated
  USING (
    is_workspace_member(workspace_id)
    AND current_workspace_role() IN ('owner','admin','member')
  )
  WITH CHECK (
    workspace_id = current_workspace_id()
    AND current_workspace_role() IN ('owner','admin','member')
  );

--------------------------------------------------------------------------------
-- 13. audit_log
--------------------------------------------------------------------------------

-- Members can read their workspace's audit trail. Owners/admins see everything;
-- others see only their own actions.
CREATE POLICY audit_log_select_privileged ON audit_log
  FOR SELECT TO authenticated
  USING (
    workspace_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM membership m
      WHERE m.workspace_id = audit_log.workspace_id
        AND m.user_id = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.role IN ('owner','admin')
    )
  );

CREATE POLICY audit_log_select_self ON audit_log
  FOR SELECT TO authenticated
  USING (actor_id = auth.uid());

-- INSERT is via triggers only (SECURITY DEFINER). No policy means no direct client insert.

--------------------------------------------------------------------------------
-- 14. Guard triggers — immutable columns
--------------------------------------------------------------------------------

-- 14.1 prevent workspace_id from changing on tenant-scoped rows
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

CREATE TRIGGER project_guard_ws              BEFORE UPDATE ON project              FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();
CREATE TRIGGER date_guard_ws                 BEFORE UPDATE ON date                 FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();
CREATE TRIGGER engagement_guard_ws           BEFORE UPDATE ON engagement           FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();
CREATE TRIGGER person_note_guard_ws          BEFORE UPDATE ON person_note          FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();
CREATE TRIGGER tag_guard_ws                  BEFORE UPDATE ON tag                  FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();
CREATE TRIGGER tagging_guard_ws              BEFORE UPDATE ON tagging              FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();

-- 14.2 prevent created_by / author_id from changing
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

CREATE TRIGGER person_guard_creator     BEFORE UPDATE ON person     FOR EACH ROW EXECUTE FUNCTION guard_immutable_created_by();
CREATE TRIGGER engagement_guard_creator BEFORE UPDATE ON engagement FOR EACH ROW EXECUTE FUNCTION guard_immutable_created_by();

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
-- 15. Audit log triggers
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION write_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_ws uuid;
  v_changes jsonb;
BEGIN
  -- workspace_id: try NEW then OLD, defaulting to current_workspace_id() for person rows
  BEGIN
    v_ws := COALESCE(
      CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN (to_jsonb(NEW) ->> 'workspace_id')::uuid END,
      CASE WHEN TG_OP IN ('DELETE','UPDATE') THEN (to_jsonb(OLD) ->> 'workspace_id')::uuid END,
      current_workspace_id()
    );
  EXCEPTION WHEN OTHERS THEN
    v_ws := current_workspace_id();
  END;

  IF TG_OP = 'INSERT' THEN
    v_changes := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_changes := jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    v_changes := to_jsonb(OLD);
  END IF;

  INSERT INTO audit_log (workspace_id, actor_id, entity_type, entity_id, action, changes)
  VALUES (
    v_ws,
    auth.uid(),
    TG_TABLE_NAME,
    COALESCE((to_jsonb(NEW) ->> 'id')::uuid, (to_jsonb(OLD) ->> 'id')::uuid),
    lower(TG_OP),
    v_changes
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

CREATE TRIGGER workspace_audit          AFTER INSERT OR UPDATE OR DELETE ON workspace          FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER project_audit            AFTER INSERT OR UPDATE OR DELETE ON project            FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER project_membership_audit AFTER INSERT OR UPDATE OR DELETE ON project_membership FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER date_audit               AFTER INSERT OR UPDATE OR DELETE ON date               FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER engagement_audit         AFTER INSERT OR UPDATE OR DELETE ON engagement         FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER person_audit             AFTER INSERT OR UPDATE OR DELETE ON person             FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER person_note_audit        AFTER INSERT OR UPDATE OR DELETE ON person_note        FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER membership_audit         AFTER INSERT OR UPDATE OR DELETE ON membership         FOR EACH ROW EXECUTE FUNCTION write_audit();

--------------------------------------------------------------------------------
-- 16. Custom access token hook (keeps JWT claim in sync with the rename)
--------------------------------------------------------------------------------

-- The hook injects `current_workspace_id` into the JWT at mint time.
-- Supersedes the earlier `current_org_id` claim. See _build/auth-hooks.sql
-- for the full function + grants; included here inline for completeness.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_ws_id   uuid;
  v_claims  jsonb;
BEGIN
  v_user_id := (event ->> 'user_id')::uuid;
  v_claims  := COALESCE(event -> 'claims', '{}'::jsonb);

  -- Pick the user's oldest accepted membership as the active workspace.
  SELECT workspace_id INTO v_ws_id
  FROM public.membership
  WHERE user_id = v_user_id
    AND accepted_at IS NOT NULL
  ORDER BY accepted_at ASC
  LIMIT 1;

  IF v_ws_id IS NOT NULL THEN
    v_claims := v_claims || jsonb_build_object('current_workspace_id', v_ws_id);
  END IF;

  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;

REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
  'Supabase Custom Access Token Hook. Injects current_workspace_id claim. Enable in Dashboard → Authentication → Hooks.';

--------------------------------------------------------------------------------
-- End of rls-policies.sql
--------------------------------------------------------------------------------
