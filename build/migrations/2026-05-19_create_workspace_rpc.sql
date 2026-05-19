-- Migration: create_workspace_rpc
-- First in-page creation flow: lets authenticated users add a workspace from
-- the Plaza sidebar (+ button next to "Places" eyebrow). Pre-ADR-032 the only
-- workspace-creation path was handle_new_user at signup. This RPC opens the
-- second path while keeping RLS conservative (workspace.INSERT remains denied
-- for authenticated; access goes through this SECURITY DEFINER wrapper).
--
-- v1 scope: defaults only. kind='personal', account = caller's personal
-- account (the one provisioned at signup). Pickers for kind/account come in
-- Settings when team-workspace flow ships.
--
-- Validation cascades into existing triggers:
--   workspace.validate_slug      → format + reserved + length
--   workspace.seed_system_roles  → 15 system roles
-- We pre-check is_reserved_slug only to surface a clean 23505 before the
-- trigger fires (cosmetic — same error otherwise).
--
-- Applied via Supabase MCP apply_migration 2026-05-19 (name:
-- create_workspace_rpc). This file is the canonical record.

CREATE OR REPLACE FUNCTION public.create_workspace(
  p_name text,
  p_slug text DEFAULT NULL
)
RETURNS public.workspace
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_account_id uuid;
  v_slug       text;
  v_workspace  public.workspace;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'name cannot be empty' USING ERRCODE = '22023';
  END IF;

  -- Caller's personal account. handle_new_user provisions one per signup
  -- post-ADR-032; users created before may not have it (we'd see this fail
  -- here rather than silently inserting an orphan workspace).
  SELECT a.id INTO v_account_id
  FROM public.account a
  JOIN public.account_membership am ON am.account_id = a.id
  WHERE a.kind = 'personal'
    AND a.deleted_at IS NULL
    AND am.user_id = v_caller
    AND am.role = 'owner'
    AND am.accepted_at IS NOT NULL
    AND am.revoked_at IS NULL
  ORDER BY am.invited_at ASC
  LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'caller has no personal account — cannot create workspace'
      USING ERRCODE = '42501';
  END IF;

  -- Slug: derive if not given, then make unique. validate_slug trigger will
  -- still run on INSERT and reject invalid forms.
  v_slug := COALESCE(NULLIF(trim(p_slug), ''), public.slugify(p_name));
  IF v_slug IS NULL OR v_slug = '' THEN
    v_slug := 'workspace-' || substr(gen_random_uuid()::text, 1, 8);
  END IF;

  IF public.is_reserved_slug(v_slug) THEN
    -- Append random suffix so reserved slugs don't block creation.
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 4);
  END IF;

  WHILE EXISTS (
    SELECT 1 FROM public.workspace
    WHERE slug = v_slug AND deleted_at IS NULL
  ) LOOP
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 4);
  END LOOP;

  INSERT INTO public.workspace (slug, name, kind, account_id)
  VALUES (v_slug, trim(p_name), 'personal', v_account_id)
  RETURNING * INTO v_workspace;

  INSERT INTO public.workspace_membership (workspace_id, user_id, role, accepted_at)
  VALUES (v_workspace.id, v_caller, 'owner', now());

  RETURN v_workspace;
END;
$$;

REVOKE ALL ON FUNCTION public.create_workspace(text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_workspace(text, text) TO authenticated;

COMMENT ON FUNCTION public.create_workspace(text, text) IS
  'Creates a workspace owned by auth.uid() under their personal account. SECURITY DEFINER bypasses the no-INSERT-policy on workspace; validates membership in personal account first. Cascades into workspace_seed_roles (15 roles) and inserts workspace_membership(owner). v1 defaults to kind=personal — kind/account pickers ship later.';
