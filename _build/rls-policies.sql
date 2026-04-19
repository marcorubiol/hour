-- Hour — Phase 0 RLS Policies (reset v2)
-- Target: Supabase Cloud (Postgres 15+)
-- Generated: 2026-04-19
-- Supersedes the 2026-04-19 polymorphic reset. See DECISIONS.md ADR-001..007.
-- 18 tables in public; RLS enabled + forced on all of them.
--
-- Permission vocabulary (closed, hardcoded):
--   read:money, read:engagement, read:person_note_private, read:internal_notes,
--   edit:show, edit:engagement, edit:money, edit:project_meta, edit:membership,
--   admin:project.
--
-- Workspace owner/admin bypass: `has_permission` returns true unconditionally
-- when the caller has an accepted `workspace_membership` row with role
-- `owner` or `admin` in the workspace that owns the project (ADR-006).

--------------------------------------------------------------------------------
-- 0. Helper functions (STABLE SECURITY DEFINER)
--------------------------------------------------------------------------------

-- 0.1 current_workspace_id — reads the JWT claim injected by
-- custom_access_token_hook.
CREATE OR REPLACE FUNCTION current_workspace_id()
RETURNS uuid AS $$
  SELECT (auth.jwt() ->> 'current_workspace_id')::uuid;
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION current_workspace_id() IS
  'Active workspace for the current request. Populated by custom_access_token_hook at sign-in / refresh.';


-- 0.2 current_user_id — alias for auth.uid() for self-documenting policies.
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS uuid AS $$
  SELECT auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;


-- 0.3 current_workspace_role — caller's flat role in the active workspace.
CREATE OR REPLACE FUNCTION current_workspace_role()
RETURNS membership_role AS $$
  SELECT role FROM public.workspace_membership
  WHERE user_id      = auth.uid()
    AND workspace_id = current_workspace_id()
    AND accepted_at IS NOT NULL;
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;


-- 0.4 is_workspace_member — true if the caller has an accepted membership in ws_id.
CREATE OR REPLACE FUNCTION is_workspace_member(ws_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_membership
    WHERE user_id      = auth.uid()
      AND workspace_id = ws_id
      AND accepted_at IS NOT NULL
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;


-- 0.5 can_see_person — the caller can see a person if they share an
-- engagement (through any workspace they belong to) or created the row.
CREATE OR REPLACE FUNCTION can_see_person(p_person_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.person WHERE id = p_person_id AND created_by = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.engagement e
    JOIN public.workspace_membership m ON m.workspace_id = e.workspace_id
    WHERE e.person_id    = p_person_id
      AND e.deleted_at  IS NULL
      AND m.user_id      = auth.uid()
      AND m.accepted_at IS NOT NULL
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;


-- 0.6 has_permission — the access gate for per-project permissions.
-- ADR-006. Workspace owner/admin bypass is explicit, not a wildcard.
CREATE OR REPLACE FUNCTION has_permission(p_project_id uuid, p_perm text)
RETURNS boolean AS $$
  SELECT
    -- Bypass path: workspace owner/admin always returns true for any
    -- permission on any project inside their workspace.
    EXISTS (
      SELECT 1
      FROM public.workspace_membership wm
      JOIN public.project p ON p.workspace_id = wm.workspace_id
      WHERE p.id          = p_project_id
        AND wm.user_id    = auth.uid()
        AND wm.accepted_at IS NOT NULL
        AND wm.role IN ('owner','admin')
    )
    OR
    -- Normal path: effective permissions = union(role.permissions)
    --                                     + permission_grants
    --                                     - permission_revokes
    EXISTS (
      WITH mr AS (
        SELECT pm.roles,
               pm.permission_grants,
               pm.permission_revokes,
               p.workspace_id
        FROM public.project_membership pm
        JOIN public.project p ON p.id = pm.project_id
        WHERE pm.project_id = p_project_id
          AND pm.user_id    = auth.uid()
      ),
      role_perms AS (
        SELECT unnest(wr.permissions) AS perm
        FROM public.workspace_role wr
        JOIN mr ON mr.workspace_id = wr.workspace_id
        WHERE wr.code        = ANY (mr.roles)
          AND wr.archived_at IS NULL
      ),
      effective AS (
        SELECT perm FROM role_perms
        UNION
        SELECT unnest(mr.permission_grants) FROM mr
        EXCEPT
        SELECT unnest(mr.permission_revokes) FROM mr
      )
      SELECT 1 FROM effective WHERE perm = p_perm
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION has_permission(uuid, text) IS
  'Effective project permission check. Workspace owner/admin bypass is explicit (ADR-006). No wildcard.';


-- 0.7 can_edit_project — convenience alias.
CREATE OR REPLACE FUNCTION can_edit_project(p_project_id uuid)
RETURNS boolean AS $$
  SELECT has_permission(p_project_id, 'edit:project_meta');
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;


-- 0.8 project_id_of_expense — resolves the project a given expense belongs
-- to via its show_id or line_id (exactly one is non-null, CHECK-enforced).
CREATE OR REPLACE FUNCTION project_id_of_expense(p_expense_id uuid)
RETURNS uuid AS $$
  SELECT COALESCE(
    (SELECT s.project_id FROM public.show s
      JOIN public.expense e ON e.show_id = s.id
      WHERE e.id = p_expense_id),
    (SELECT l.project_id FROM public.line l
      JOIN public.expense e ON e.line_id = l.id
      WHERE e.id = p_expense_id)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;


--------------------------------------------------------------------------------
-- 1. Enable + force RLS on all 18 tables
--------------------------------------------------------------------------------

ALTER TABLE workspace            ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace            FORCE  ROW LEVEL SECURITY;
ALTER TABLE user_profile         ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profile         FORCE  ROW LEVEL SECURITY;
ALTER TABLE workspace_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_membership FORCE  ROW LEVEL SECURITY;
ALTER TABLE workspace_role       ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_role       FORCE  ROW LEVEL SECURITY;
ALTER TABLE person               ENABLE ROW LEVEL SECURITY;
ALTER TABLE person               FORCE  ROW LEVEL SECURITY;
ALTER TABLE venue                ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue                FORCE  ROW LEVEL SECURITY;
ALTER TABLE project              ENABLE ROW LEVEL SECURITY;
ALTER TABLE project              FORCE  ROW LEVEL SECURITY;
ALTER TABLE project_membership   ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_membership   FORCE  ROW LEVEL SECURITY;
ALTER TABLE line                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE line                 FORCE  ROW LEVEL SECURITY;
ALTER TABLE engagement           ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement           FORCE  ROW LEVEL SECURITY;
ALTER TABLE show                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE show                 FORCE  ROW LEVEL SECURITY;
ALTER TABLE date                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE date                 FORCE  ROW LEVEL SECURITY;
ALTER TABLE person_note          ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_note          FORCE  ROW LEVEL SECURITY;
ALTER TABLE invoice              ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice              FORCE  ROW LEVEL SECURITY;
ALTER TABLE invoice_line         ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line         FORCE  ROW LEVEL SECURITY;
ALTER TABLE payment              ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment              FORCE  ROW LEVEL SECURITY;
ALTER TABLE expense              ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense              FORCE  ROW LEVEL SECURITY;
ALTER TABLE audit_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log            FORCE  ROW LEVEL SECURITY;

--------------------------------------------------------------------------------
-- 2. workspace
--------------------------------------------------------------------------------

CREATE POLICY workspace_select ON workspace
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND is_workspace_member(id));

CREATE POLICY workspace_update ON workspace
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM workspace_membership m
      WHERE m.workspace_id = workspace.id
        AND m.user_id      = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.role IN ('owner','admin')
    )
  )
  WITH CHECK (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM workspace_membership m
      WHERE m.workspace_id = workspace.id
        AND m.user_id      = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.role IN ('owner','admin')
    )
  );

-- Workspace creation goes through handle_new_user (personal) or service-role
-- flow (team). No client-side INSERT policy.

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
      FROM workspace_membership m1
      JOIN workspace_membership m2 ON m2.workspace_id = m1.workspace_id
      WHERE m1.user_id     = auth.uid()
        AND m1.accepted_at IS NOT NULL
        AND m2.user_id     = user_profile.user_id
        AND m2.accepted_at IS NOT NULL
    )
  );

CREATE POLICY user_profile_update_self ON user_profile
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

--------------------------------------------------------------------------------
-- 4. workspace_membership
--------------------------------------------------------------------------------

-- Auth-admin needs to read workspace_membership to mint the
-- current_workspace_id claim from the custom access-token hook.
GRANT SELECT ON public.workspace_membership TO supabase_auth_admin;

CREATE POLICY auth_admin_read_workspace_membership ON workspace_membership
  FOR SELECT TO supabase_auth_admin
  USING (true);

CREATE POLICY workspace_membership_select ON workspace_membership
  FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id));

CREATE POLICY workspace_membership_insert ON workspace_membership
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_membership m
      WHERE m.workspace_id = workspace_membership.workspace_id
        AND m.user_id      = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.role IN ('owner','admin')
    )
  );

CREATE POLICY workspace_membership_update ON workspace_membership
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM workspace_membership m
      WHERE m.workspace_id = workspace_membership.workspace_id
        AND m.user_id      = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.role IN ('owner','admin')
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM workspace_membership m
      WHERE m.workspace_id = workspace_membership.workspace_id
        AND m.user_id      = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.role IN ('owner','admin')
    )
  );

CREATE POLICY workspace_membership_delete ON workspace_membership
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()   -- self-leave
    OR EXISTS (
      SELECT 1 FROM workspace_membership m
      WHERE m.workspace_id = workspace_membership.workspace_id
        AND m.user_id      = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.role IN ('owner','admin')
    )
  );

--------------------------------------------------------------------------------
-- 5. workspace_role
--------------------------------------------------------------------------------

CREATE POLICY workspace_role_select ON workspace_role
  FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id));

CREATE POLICY workspace_role_insert ON workspace_role
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = current_workspace_id()
    AND current_workspace_role() IN ('owner','admin')
  );

CREATE POLICY workspace_role_update ON workspace_role
  FOR UPDATE TO authenticated
  USING (
    is_workspace_member(workspace_id)
    AND EXISTS (
      SELECT 1 FROM workspace_membership m
      WHERE m.workspace_id = workspace_role.workspace_id
        AND m.user_id      = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.role IN ('owner','admin')
    )
  )
  WITH CHECK (
    is_workspace_member(workspace_id)
    AND EXISTS (
      SELECT 1 FROM workspace_membership m
      WHERE m.workspace_id = workspace_role.workspace_id
        AND m.user_id      = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.role IN ('owner','admin')
    )
  );

-- DELETE is allowed only for non-system rows. System rows (is_system=true)
-- can be archived via UPDATE setting archived_at.
CREATE POLICY workspace_role_delete ON workspace_role
  FOR DELETE TO authenticated
  USING (
    is_system = false
    AND EXISTS (
      SELECT 1 FROM workspace_membership m
      WHERE m.workspace_id = workspace_role.workspace_id
        AND m.user_id      = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.role IN ('owner','admin')
    )
  );

--------------------------------------------------------------------------------
-- 6. person (global)
--------------------------------------------------------------------------------

CREATE POLICY person_select ON person
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND can_see_person(id));

CREATE POLICY person_insert ON person
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY person_update ON person
  FOR UPDATE TO authenticated
  USING (deleted_at IS NULL AND can_see_person(id))
  WITH CHECK (can_see_person(id));

--------------------------------------------------------------------------------
-- 7. venue
--------------------------------------------------------------------------------

CREATE POLICY venue_select ON venue
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND is_workspace_member(workspace_id));

CREATE POLICY venue_insert ON venue
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = current_workspace_id()
    AND is_workspace_member(workspace_id)
  );

CREATE POLICY venue_update ON venue
  FOR UPDATE TO authenticated
  USING (deleted_at IS NULL AND is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY venue_delete ON venue
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_membership m
      WHERE m.workspace_id = venue.workspace_id
        AND m.user_id      = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.role IN ('owner','admin')
    )
  );

--------------------------------------------------------------------------------
-- 8. project
--------------------------------------------------------------------------------

CREATE POLICY project_select ON project
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      is_workspace_member(workspace_id)
      OR EXISTS (
        SELECT 1 FROM project_membership pm
        WHERE pm.project_id = project.id AND pm.user_id = auth.uid()
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
  USING (deleted_at IS NULL AND has_permission(id, 'edit:project_meta'))
  WITH CHECK (has_permission(id, 'edit:project_meta'));

--------------------------------------------------------------------------------
-- 9. project_membership
--------------------------------------------------------------------------------

CREATE POLICY project_membership_select ON project_membership
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR has_permission(project_id, 'edit:membership')
  );

CREATE POLICY project_membership_write ON project_membership
  FOR ALL TO authenticated
  USING (has_permission(project_id, 'edit:membership'))
  WITH CHECK (has_permission(project_id, 'edit:membership'));

--------------------------------------------------------------------------------
-- 10. line
--------------------------------------------------------------------------------

CREATE POLICY line_select ON line
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      has_permission(project_id, 'edit:show')
      OR has_permission(project_id, 'edit:project_meta')
    )
  );

CREATE POLICY line_insert ON line
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = current_workspace_id()
    AND (
      has_permission(project_id, 'edit:show')
      OR has_permission(project_id, 'edit:project_meta')
    )
  );

CREATE POLICY line_update ON line
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      has_permission(project_id, 'edit:show')
      OR has_permission(project_id, 'edit:project_meta')
    )
  )
  WITH CHECK (
    has_permission(project_id, 'edit:show')
    OR has_permission(project_id, 'edit:project_meta')
  );

--------------------------------------------------------------------------------
-- 11. engagement
--------------------------------------------------------------------------------

CREATE POLICY engagement_select ON engagement
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND has_permission(project_id, 'read:engagement')
  );

CREATE POLICY engagement_insert ON engagement
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = current_workspace_id()
    AND has_permission(project_id, 'edit:engagement')
    AND created_by = auth.uid()
  );

CREATE POLICY engagement_update ON engagement
  FOR UPDATE TO authenticated
  USING (deleted_at IS NULL AND has_permission(project_id, 'edit:engagement'))
  WITH CHECK (has_permission(project_id, 'edit:engagement'));

--------------------------------------------------------------------------------
-- 12. show
--------------------------------------------------------------------------------

-- Read access to the base table requires edit:show. Fee columns are
-- additionally gated by read:money via the show_redacted view (defined
-- below). On UPDATE, fee changes are gated by the guard_show_fee_columns
-- trigger (defined in schema.sql), which calls has_permission at write time.
CREATE POLICY show_select ON show
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND has_permission(project_id, 'edit:show'));

CREATE POLICY show_insert ON show
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = current_workspace_id()
    AND has_permission(project_id, 'edit:show')
  );

CREATE POLICY show_update ON show
  FOR UPDATE TO authenticated
  USING (deleted_at IS NULL AND has_permission(project_id, 'edit:show'))
  WITH CHECK (has_permission(project_id, 'edit:show'));

--------------------------------------------------------------------------------
-- 13. date
--------------------------------------------------------------------------------

CREATE POLICY date_select ON date
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND has_permission(project_id, 'edit:show'));

CREATE POLICY date_insert ON date
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = current_workspace_id()
    AND has_permission(project_id, 'edit:show')
  );

CREATE POLICY date_update ON date
  FOR UPDATE TO authenticated
  USING (deleted_at IS NULL AND has_permission(project_id, 'edit:show'))
  WITH CHECK (has_permission(project_id, 'edit:show'));

--------------------------------------------------------------------------------
-- 14. person_note
--------------------------------------------------------------------------------

-- visibility='workspace' → any workspace member (no extra permission gate).
-- visibility='private'   → author_id = auth.uid() AND read:person_note_private.
CREATE POLICY person_note_select ON person_note
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      (visibility = 'workspace' AND is_workspace_member(workspace_id))
      OR (
        visibility = 'private'
        AND author_id = auth.uid()
        -- read:person_note_private is needed even for own-author private notes
        -- to keep a clean policy surface; owners/admins bypass via has_permission.
        AND EXISTS (
          SELECT 1
          FROM project p
          WHERE p.workspace_id = person_note.workspace_id
            AND has_permission(p.id, 'read:person_note_private')
          LIMIT 1
        )
      )
    )
  );

CREATE POLICY person_note_insert ON person_note
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = current_workspace_id()
    AND is_workspace_member(workspace_id)
    AND author_id = auth.uid()
  );

CREATE POLICY person_note_update ON person_note
  FOR UPDATE TO authenticated
  USING (deleted_at IS NULL AND author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

--------------------------------------------------------------------------------
-- 15. invoice, invoice_line, payment
--------------------------------------------------------------------------------

-- Money tables. read:money for SELECT; edit:money for INSERT/UPDATE.
-- invoice.project_id can be NULL (workspace-level invoicing) — in that case
-- only workspace owner/admin see/write it.
CREATE POLICY invoice_select ON invoice
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      (project_id IS NOT NULL AND has_permission(project_id, 'read:money'))
      OR (project_id IS NULL AND EXISTS (
        SELECT 1 FROM workspace_membership m
        WHERE m.workspace_id = invoice.workspace_id
          AND m.user_id      = auth.uid()
          AND m.accepted_at IS NOT NULL
          AND m.role IN ('owner','admin')
      ))
    )
  );

CREATE POLICY invoice_insert ON invoice
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = current_workspace_id()
    AND (
      (project_id IS NOT NULL AND has_permission(project_id, 'edit:money'))
      OR (project_id IS NULL AND current_workspace_role() IN ('owner','admin'))
    )
  );

CREATE POLICY invoice_update ON invoice
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      (project_id IS NOT NULL AND has_permission(project_id, 'edit:money'))
      OR (project_id IS NULL AND EXISTS (
        SELECT 1 FROM workspace_membership m
        WHERE m.workspace_id = invoice.workspace_id
          AND m.user_id      = auth.uid()
          AND m.accepted_at IS NOT NULL
          AND m.role IN ('owner','admin')
      ))
    )
  )
  WITH CHECK (
    (project_id IS NOT NULL AND has_permission(project_id, 'edit:money'))
    OR (project_id IS NULL AND current_workspace_role() IN ('owner','admin'))
  );


CREATE POLICY invoice_line_select ON invoice_line
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoice i
      WHERE i.id = invoice_line.invoice_id
        AND i.deleted_at IS NULL
        AND (
          (i.project_id IS NOT NULL AND has_permission(i.project_id, 'read:money'))
          OR (i.project_id IS NULL AND EXISTS (
            SELECT 1 FROM workspace_membership m
            WHERE m.workspace_id = i.workspace_id
              AND m.user_id      = auth.uid()
              AND m.accepted_at IS NOT NULL
              AND m.role IN ('owner','admin')
          ))
        )
    )
  );

CREATE POLICY invoice_line_write ON invoice_line
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoice i
      WHERE i.id = invoice_line.invoice_id
        AND (
          (i.project_id IS NOT NULL AND has_permission(i.project_id, 'edit:money'))
          OR (i.project_id IS NULL AND current_workspace_role() IN ('owner','admin'))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoice i
      WHERE i.id = invoice_line.invoice_id
        AND i.workspace_id = invoice_line.workspace_id
        AND (
          (i.project_id IS NOT NULL AND has_permission(i.project_id, 'edit:money'))
          OR (i.project_id IS NULL AND current_workspace_role() IN ('owner','admin'))
        )
    )
  );


CREATE POLICY payment_select ON payment
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM invoice i
      WHERE i.id = payment.invoice_id
        AND (
          (i.project_id IS NOT NULL AND has_permission(i.project_id, 'read:money'))
          OR (i.project_id IS NULL AND EXISTS (
            SELECT 1 FROM workspace_membership m
            WHERE m.workspace_id = i.workspace_id
              AND m.user_id      = auth.uid()
              AND m.accepted_at IS NOT NULL
              AND m.role IN ('owner','admin')
          ))
        )
    )
  );

CREATE POLICY payment_write ON payment
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoice i
      WHERE i.id = payment.invoice_id
        AND (
          (i.project_id IS NOT NULL AND has_permission(i.project_id, 'edit:money'))
          OR (i.project_id IS NULL AND current_workspace_role() IN ('owner','admin'))
        )
    )
  )
  WITH CHECK (
    workspace_id = current_workspace_id()
    AND EXISTS (
      SELECT 1 FROM invoice i
      WHERE i.id = payment.invoice_id
        AND i.workspace_id = payment.workspace_id
        AND (
          (i.project_id IS NOT NULL AND has_permission(i.project_id, 'edit:money'))
          OR (i.project_id IS NULL AND current_workspace_role() IN ('owner','admin'))
        )
    )
  );

--------------------------------------------------------------------------------
-- 16. expense
--------------------------------------------------------------------------------

CREATE POLICY expense_select ON expense
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND has_permission(project_id_of_expense(id), 'read:money')
  );

CREATE POLICY expense_insert ON expense
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = current_workspace_id()
    AND has_permission(
      COALESCE(
        (SELECT s.project_id FROM show s WHERE s.id = expense.show_id),
        (SELECT l.project_id FROM line l WHERE l.id = expense.line_id)
      ),
      'edit:money'
    )
  );

CREATE POLICY expense_update ON expense
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND has_permission(project_id_of_expense(id), 'edit:money')
  )
  WITH CHECK (
    has_permission(
      COALESCE(
        (SELECT s.project_id FROM show s WHERE s.id = expense.show_id),
        (SELECT l.project_id FROM line l WHERE l.id = expense.line_id)
      ),
      'edit:money'
    )
  );

--------------------------------------------------------------------------------
-- 17. audit_log
--------------------------------------------------------------------------------

CREATE POLICY audit_log_select_privileged ON audit_log
  FOR SELECT TO authenticated
  USING (
    workspace_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM workspace_membership m
      WHERE m.workspace_id = audit_log.workspace_id
        AND m.user_id      = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.role IN ('owner','admin')
    )
  );

CREATE POLICY audit_log_select_self ON audit_log
  FOR SELECT TO authenticated
  USING (actor_id = auth.uid());

-- INSERT is via triggers (SECURITY DEFINER); no direct client INSERT.

--------------------------------------------------------------------------------
-- 18. show_redacted — read-path fee gating
--------------------------------------------------------------------------------

-- Clients that lack read:money get NULL for fee_amount / fee_currency even
-- though the row is otherwise visible (base policy requires edit:show only).
-- UPDATE path is protected by guard_show_fee_columns (defined in schema.sql).
CREATE OR REPLACE VIEW show_redacted
WITH (security_invoker = true) AS
SELECT
  id,
  workspace_id,
  project_id,
  line_id,
  engagement_id,
  performed_at,
  venue_id,
  venue_name,
  city,
  country,
  status,
  CASE WHEN has_permission(project_id, 'read:money') THEN fee_amount   END AS fee_amount,
  CASE WHEN has_permission(project_id, 'read:money') THEN fee_currency END AS fee_currency,
  notes,
  custom_fields,
  created_by,
  created_at,
  updated_at,
  deleted_at
FROM show;

COMMENT ON VIEW show_redacted IS
  'Read-path fee gate: fee columns NULL unless caller has read:money. UPDATE gate lives in trigger guard_show_fee_columns.';

GRANT SELECT ON show_redacted TO authenticated;

--------------------------------------------------------------------------------
-- 19. Audit triggers
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION write_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_ws uuid;
  v_changes jsonb;
BEGIN
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

CREATE TRIGGER workspace_audit            AFTER INSERT OR UPDATE OR DELETE ON workspace            FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER workspace_membership_audit AFTER INSERT OR UPDATE OR DELETE ON workspace_membership FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER workspace_role_audit       AFTER INSERT OR UPDATE OR DELETE ON workspace_role       FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER venue_audit                AFTER INSERT OR UPDATE OR DELETE ON venue                FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER project_audit              AFTER INSERT OR UPDATE OR DELETE ON project              FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER project_membership_audit   AFTER INSERT OR UPDATE OR DELETE ON project_membership   FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER line_audit                 AFTER INSERT OR UPDATE OR DELETE ON line                 FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER engagement_audit           AFTER INSERT OR UPDATE OR DELETE ON engagement           FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER show_audit                 AFTER INSERT OR UPDATE OR DELETE ON show                 FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER date_audit                 AFTER INSERT OR UPDATE OR DELETE ON date                 FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER person_audit               AFTER INSERT OR UPDATE OR DELETE ON person               FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER person_note_audit          AFTER INSERT OR UPDATE OR DELETE ON person_note          FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER invoice_audit              AFTER INSERT OR UPDATE OR DELETE ON invoice              FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER payment_audit              AFTER INSERT OR UPDATE OR DELETE ON payment              FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER expense_audit              AFTER INSERT OR UPDATE OR DELETE ON expense              FOR EACH ROW EXECUTE FUNCTION write_audit();

--------------------------------------------------------------------------------
-- 20. Custom access-token hook
--------------------------------------------------------------------------------

-- Injects `current_workspace_id` into the JWT from the caller's oldest
-- accepted workspace_membership. Manual toggle required: Dashboard →
-- Authentication → Hooks → Custom Access Token → point at this function.
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

  SELECT workspace_id INTO v_ws_id
  FROM public.workspace_membership
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
