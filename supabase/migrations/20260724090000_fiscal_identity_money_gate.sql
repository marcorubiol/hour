-- Gate fiscal_identity reads behind money permission (hardening audit 2026-07-24).
--
-- Every other money surface (bolo, invoice, payment, expense, invoice_tax_line)
-- gates SELECT with has_permission(..., 'read:money'). fiscal_identity did not:
-- fiscal_identity_select accepted bare workspace/account MEMBERSHIP. A
-- per-workspace issuer override (the freelance case) is workspace-owned and
-- carries tax_id, iban and swift_bic — so any member, e.g. a performer with no
-- money permission, could read the workspace's banking details with a single
-- GET /rest/v1/fiscal_identity?workspace_id=eq.<their-ws>.
--
-- fiscal_identity is workspace/account-scoped, not project-scoped, so
-- has_permission (project-scoped) does not apply directly. This adds the
-- workspace-level analogue and repoints the policy at it.

CREATE OR REPLACE FUNCTION public.can_read_workspace_money(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  SELECT p_workspace_id IS NOT NULL AND (
    public.is_workspace_admin(p_workspace_id)
    OR EXISTS (
      SELECT 1
      FROM public.project p
      WHERE p.workspace_id = p_workspace_id
        AND p.deleted_at IS NULL
        AND public.has_permission(p.id, 'read:money')
    )
  );
$$;

COMMENT ON FUNCTION public.can_read_workspace_money(uuid) IS
  'Workspace-level money read gate: owner/admin, or read:money on at least one live project of the workspace. For money data that is workspace-scoped, where the project-scoped has_permission does not apply.';

REVOKE ALL ON FUNCTION public.can_read_workspace_money(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_workspace_money(uuid) TO authenticated;

-- Read: money-permitted members of the owning workspace, or admins of the
-- owning account. Banking data is never plain-member visible.
DROP POLICY IF EXISTS fiscal_identity_select ON public.fiscal_identity;
CREATE POLICY fiscal_identity_select ON public.fiscal_identity
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL AND (
      (workspace_id IS NOT NULL AND public.can_read_workspace_money(workspace_id))
      OR (account_id IS NOT NULL AND public.is_account_admin(account_id))
    )
  );

COMMENT ON POLICY fiscal_identity_select ON public.fiscal_identity IS
  'read:money (workspace) or account admin — NOT bare membership: these rows carry tax_id/iban/swift_bic (hardening audit 2026-07-24).';
