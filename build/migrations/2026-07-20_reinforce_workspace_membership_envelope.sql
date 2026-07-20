-- Security reinforcement: workspace membership is the outer tenancy envelope;
-- project membership only specializes a live workspace membership.
--
-- Desired model (unchanged): one user may be technical director in project A,
-- stage manager in project B, and distribution in an unrelated workspace C.
-- Revocation invariant (fixed here): once their accepted workspace_membership
-- disappears or becomes unaccepted, stale project_membership rows must grant
-- no read or write access, even while an already-issued JWT remains valid.
-- A member also must not be able to promote their own workspace role through
-- the generic row UPDATE policy; invite acceptance belongs in a narrow RPC.
--
-- Deliver-files-only. Apply to staging first, verify with two real identities
-- and an already-issued JWT, then apply to production.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(ws_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_membership
    WHERE user_id      = auth.uid()
      AND workspace_id = ws_id
      AND accepted_at IS NOT NULL
      AND role IN ('owner', 'admin')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;

REVOKE ALL ON FUNCTION public.is_workspace_admin(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_workspace_admin(uuid) TO authenticated;

COMMENT ON FUNCTION public.is_workspace_admin(uuid) IS
  'True only for a live workspace owner/admin. SECURITY DEFINER avoids recursive RLS when workspace_membership policies check their own table.';

CREATE OR REPLACE FUNCTION public.has_permission(p_project_id uuid, p_perm text)
RETURNS boolean AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.workspace_membership wm
      JOIN public.project p ON p.workspace_id = wm.workspace_id
      WHERE p.id           = p_project_id
        AND wm.user_id     = auth.uid()
        AND wm.accepted_at IS NOT NULL
        AND wm.role IN ('owner', 'admin')
    )
    OR
    EXISTS (
      WITH mr AS (
        SELECT pm.roles,
               pm.permission_grants,
               pm.permission_revokes,
               p.workspace_id
        FROM public.project_membership pm
        JOIN public.project p ON p.id = pm.project_id
        JOIN public.workspace_membership wm
          ON wm.workspace_id = p.workspace_id
         AND wm.user_id = pm.user_id
         AND wm.accepted_at IS NOT NULL
        WHERE pm.project_id = p_project_id
          AND pm.user_id = auth.uid()
      ),
      role_perms AS (
        SELECT unnest(wr.permissions) AS perm
        FROM public.workspace_role wr
        JOIN mr ON mr.workspace_id = wr.workspace_id
        WHERE wr.code = ANY (mr.roles)
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

COMMENT ON FUNCTION public.has_permission(uuid, text) IS
  'Effective project permission check. A live accepted workspace membership is the outer access envelope; project roles/grants/revokes specialize access inside it. Workspace owner/admin bypass is explicit (ADR-006). No wildcard.';

DROP POLICY IF EXISTS workspace_membership_insert ON public.workspace_membership;
CREATE POLICY workspace_membership_insert ON public.workspace_membership
  FOR INSERT TO authenticated
  WITH CHECK (is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS workspace_membership_update ON public.workspace_membership;
CREATE POLICY workspace_membership_update ON public.workspace_membership
  FOR UPDATE TO authenticated
  USING (is_workspace_admin(workspace_id))
  WITH CHECK (is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS workspace_membership_delete ON public.workspace_membership;
CREATE POLICY workspace_membership_delete ON public.workspace_membership
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR is_workspace_admin(workspace_id)
  );

DROP POLICY IF EXISTS project_select ON public.project;
CREATE POLICY project_select ON public.project
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND is_workspace_member(workspace_id)
  );

DROP POLICY IF EXISTS project_membership_select ON public.project_membership;
CREATE POLICY project_membership_select ON public.project_membership
  FOR SELECT TO authenticated
  USING (
    (
      user_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.project p
        WHERE p.id = project_membership.project_id
          AND is_workspace_member(p.workspace_id)
      )
    )
    OR has_permission(project_id, 'edit:membership')
  );

COMMIT;
