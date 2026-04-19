-- Hour — Supabase Auth hooks
-- Target: Supabase Cloud (Postgres 15+, GoTrue v2.157+)
-- Applied: 2026-04-19 (migration `polymorphic_rls_and_audit`)
-- Also included as part of _build/rls-policies.sql (§ custom_access_token_hook).
--
-- Contract enforced by Supabase Auth:
--   input  event jsonb: { "user_id": uuid, "claims": { ...existing claims... }, ... }
--   output event jsonb: same shape, claims possibly modified.
--
-- Enable in dashboard after applying:
--   Dashboard → Auth → Hooks → Custom Access Token → enable + select
--   public.custom_access_token_hook.
--------------------------------------------------------------------------------

-- 1. The hook: inject `current_workspace_id` claim from the user's oldest
--    accepted membership. When multi-workspace switching lands, read an
--    `active_workspace_id` from raw_app_meta_data first (set by a switcher
--    endpoint) and fall back to oldest accepted.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id      uuid  := (event ->> 'user_id')::uuid;
  v_claims       jsonb := COALESCE(event -> 'claims', '{}'::jsonb);
  v_workspace_id uuid;
BEGIN
  SELECT workspace_id
    INTO v_workspace_id
    FROM public.membership
   WHERE user_id = v_user_id
     AND accepted_at IS NOT NULL
   ORDER BY accepted_at ASC
   LIMIT 1;

  IF v_workspace_id IS NOT NULL THEN
    v_claims := v_claims || jsonb_build_object(
      'current_workspace_id', v_workspace_id::text
    );
  END IF;

  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;

-- 2. Lock down execute: only Supabase Auth (supabase_auth_admin) may call it.
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb)
  TO supabase_auth_admin;

-- 3. Table privilege + RLS policy so the hook can read membership during
--    token mint. The hook runs as supabase_auth_admin when invoked by GoTrue.
GRANT SELECT ON public.membership TO supabase_auth_admin;

DROP POLICY IF EXISTS auth_admin_read_membership ON public.membership;
CREATE POLICY auth_admin_read_membership
  ON public.membership
  FOR SELECT
  TO supabase_auth_admin
  USING (true);

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
  'Supabase Auth hook: injects current_workspace_id claim from oldest accepted membership. Enable in Dashboard -> Auth -> Hooks -> Custom Access Token.';
