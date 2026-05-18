-- Migration: rls_findings_fix
-- Applied: 2026-05-18 via Supabase MCP execute_sql (iterative)
-- ADR: ADR-033 (_decisions.md)
--
-- Two findings caught while writing the RLS regression suite (Phase 0.9
-- gate item #2). Both are real bugs, both silently fail safe-feeling
-- requests, both are exactly the gotchas the official Supabase agent
-- skill calls out first.
--
-- Finding 1 — show_redacted view bypassed RLS.
-- Postgres views run with their owner's privileges by default; this means
-- any authenticated user who queried show_redacted directly would see
-- ALL shows across ALL workspaces, ignoring the row-level policies on
-- the underlying `show` table. Fix: set security_invoker=true so the
-- view runs with the calling user's privileges.
--
-- Finding 2 — account / account_membership RLS recursion (ADR-032 bug).
-- The original ADR-032 policies inlined an EXISTS subquery against
-- `account_membership` inside `account_select` / `account_membership_*`.
-- Because account_membership ALSO has RLS, the inner subquery was
-- evaluated with the same policies active, recursing on itself and
-- silently returning false → account_select returned 0 rows for every
-- authenticated user, even valid members.
-- Fix: introduce three SECURITY DEFINER helpers (same pattern as
-- is_workspace_member) that bypass RLS for the lookup, then rewrite the
-- policies to call them. No data change; pure policy logic.

-- ============================================================
-- Finding 1: secure the show_redacted view
-- ============================================================
ALTER VIEW public.show_redacted SET (security_invoker = true);

-- ============================================================
-- Finding 2: account membership helpers + rewritten policies
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_account_member(acc_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.account_membership
    WHERE user_id = auth.uid()
      AND account_id = acc_id
      AND accepted_at IS NOT NULL
      AND revoked_at IS NULL
  );
$function$;

REVOKE ALL ON FUNCTION public.is_account_member(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_account_admin(acc_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.account_membership
    WHERE user_id = auth.uid()
      AND account_id = acc_id
      AND role IN ('owner', 'admin')
      AND accepted_at IS NOT NULL
      AND revoked_at IS NULL
  );
$function$;

REVOKE ALL ON FUNCTION public.is_account_admin(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_account_admin(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_account_owner(acc_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.account_membership
    WHERE user_id = auth.uid()
      AND account_id = acc_id
      AND role = 'owner'
      AND accepted_at IS NOT NULL
      AND revoked_at IS NULL
  );
$function$;

REVOKE ALL ON FUNCTION public.is_account_owner(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_account_owner(uuid) TO authenticated;

-- Rewrite account policies using the helpers
DROP POLICY IF EXISTS account_select ON public.account;
DROP POLICY IF EXISTS account_update ON public.account;

CREATE POLICY account_select ON public.account FOR SELECT TO authenticated
USING (deleted_at IS NULL AND is_account_member(id));

CREATE POLICY account_update ON public.account FOR UPDATE TO authenticated
USING (deleted_at IS NULL AND is_account_owner(id))
WITH CHECK (is_account_owner(id));

-- Rewrite account_membership policies
DROP POLICY IF EXISTS account_membership_select ON public.account_membership;
DROP POLICY IF EXISTS account_membership_insert ON public.account_membership;
DROP POLICY IF EXISTS account_membership_update ON public.account_membership;
DROP POLICY IF EXISTS account_membership_delete ON public.account_membership;

CREATE POLICY account_membership_select ON public.account_membership FOR SELECT TO authenticated
USING (user_id = auth.uid() OR is_account_admin(account_id));

CREATE POLICY account_membership_insert ON public.account_membership FOR INSERT TO authenticated
WITH CHECK (
  is_account_admin(account_id)
  OR (
    -- Bootstrap: when an account has zero members yet, the creator can
    -- insert themselves as owner. Used by handle_new_user + ad-hoc
    -- account creation flows.
    user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.account_membership am2
      WHERE am2.account_id = account_membership.account_id
    )
  )
);

CREATE POLICY account_membership_update ON public.account_membership FOR UPDATE TO authenticated
USING (is_account_admin(account_id));

CREATE POLICY account_membership_delete ON public.account_membership FOR DELETE TO authenticated
USING (is_account_owner(account_id));
