-- Security reinforcement: account admins may manage other account admins,
-- but `owner` is the billing/ownership boundary and cannot be minted by an
-- admin through direct PostgREST writes.
--
-- The previous policies checked only the caller's current role. Consequently
-- an accepted admin could INSERT an owner or UPDATE their own row to owner,
-- then pass is_account_owner() and take owner-only actions.
-- The old direct bootstrap branch was also unsafe: its NOT EXISTS query was
-- evaluated through RLS, so a non-member could see an existing account as
-- empty. Account + first owner creation now belongs only to the existing
-- SECURITY DEFINER signup trigger or a future audited RPC.
--
-- Deliver-files-only. Apply to staging first with distinct owner/admin users.

BEGIN;

REVOKE INSERT ON TABLE public.account FROM authenticated;

DROP POLICY IF EXISTS account_insert ON public.account;

DROP POLICY IF EXISTS account_membership_insert ON public.account_membership;
CREATE POLICY account_membership_insert ON public.account_membership
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_account_owner(account_id)
    OR (
      public.is_account_admin(account_id)
      AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS account_membership_update ON public.account_membership;
CREATE POLICY account_membership_update ON public.account_membership
  FOR UPDATE TO authenticated
  USING (
    public.is_account_owner(account_id)
    OR (
      public.is_account_admin(account_id)
      AND role = 'admin'
    )
  )
  WITH CHECK (
    public.is_account_owner(account_id)
    OR (
      public.is_account_admin(account_id)
      AND role = 'admin'
    )
  );

COMMIT;
