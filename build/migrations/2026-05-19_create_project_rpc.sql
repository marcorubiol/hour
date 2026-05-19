-- Migration: create_project_rpc
-- Second in-page creation flow: + button on each workspace row in Plaza
-- opens a dialog to create a project under that workspace.
--
-- Mirrors create_workspace: SECURITY DEFINER wrapper because the RLS
-- project_insert policy requires workspace_id = current_workspace_id()
-- from the JWT claim. Plaza shows workspaces cross-account; clicking +
-- on a workspace that isn't the JWT's "current" one would fail under
-- direct INSERT. The RPC validates membership ≥ member explicitly.
--
-- Adds project.accent (same shape as workspace.accent: text + CHECK
-- '1'..'8', open to free-form colors by relaxing the CHECK later).
-- description column already existed on project.
--
-- Status: defaults to 'active' (not 'draft'). Reason: an explicit user
-- gesture (typed name + clicked Create) is intent to start work, not park
-- a stub. Schema default 'draft' stays for non-UI-driven inserts.
--
-- Applied via Supabase MCP apply_migration 2026-05-19 (name:
-- create_project_rpc). This file is the canonical record.

ALTER TABLE public.project
  ADD COLUMN accent text CHECK (accent IS NULL OR accent ~ '^[1-8]$');

-- Description was nullable text with no length cap. Add the same 280-char
-- ceiling we use on workspace.description for layout consistency (sidebar
-- tooltip, settings card).
ALTER TABLE public.project
  ADD CONSTRAINT project_description_length
    CHECK (description IS NULL OR length(description) <= 280);

COMMENT ON COLUMN public.project.accent IS
  'Color identity. ''1''..''8'' = palette index into --accent-N tokens. NULL = derive via hash(slug). Stored as text to allow future free-form colors (hex/oklch) by relaxing the CHECK constraint without a schema migration.';

CREATE OR REPLACE FUNCTION public.create_project(
  p_workspace_id uuid,
  p_name         text,
  p_accent       text DEFAULT NULL,
  p_description  text DEFAULT NULL,
  p_slug         text DEFAULT NULL
)
RETURNS public.project
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller      uuid := auth.uid();
  v_slug        text;
  v_accent      text;
  v_description text;
  v_project     public.project;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'name cannot be empty' USING ERRCODE = '22023';
  END IF;

  -- Membership check: caller must be owner/admin/member of the target
  -- workspace. Same role tiers as the RLS project_insert policy.
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_membership m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id      = v_caller
      AND m.accepted_at  IS NOT NULL
      AND m.role         IN ('owner', 'admin', 'member')
  ) THEN
    RAISE EXCEPTION 'caller is not a member of workspace % with sufficient role', p_workspace_id
      USING ERRCODE = '42501';
  END IF;

  -- Slug: derive from name if not given; collision-loop on
  -- (workspace_id, slug) — partial unique idx is scoped per workspace.
  v_slug := COALESCE(NULLIF(trim(p_slug), ''), public.slugify(p_name));
  IF v_slug IS NULL OR v_slug = '' THEN
    v_slug := 'project-' || substr(gen_random_uuid()::text, 1, 8);
  END IF;

  IF public.is_reserved_slug(v_slug) THEN
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 4);
  END IF;

  WHILE EXISTS (
    SELECT 1 FROM public.project
    WHERE workspace_id = p_workspace_id
      AND slug = v_slug
      AND deleted_at IS NULL
  ) LOOP
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 4);
  END LOOP;

  v_accent      := NULLIF(trim(p_accent), '');
  v_description := NULLIF(trim(p_description), '');

  INSERT INTO public.project (
    workspace_id, slug, name, status, accent, description, created_by
  )
  VALUES (
    p_workspace_id, v_slug, trim(p_name), 'active', v_accent, v_description, v_caller
  )
  RETURNING * INTO v_project;

  RETURN v_project;
END;
$$;

REVOKE ALL ON FUNCTION public.create_project(uuid, text, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_project(uuid, text, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.create_project(uuid, text, text, text, text) IS
  'Creates a project in p_workspace_id with caller as created_by. SECURITY DEFINER bypasses the RLS check (workspace_id = current_workspace_id() in JWT); validates membership ≥ member explicitly. status defaults to ''active'' on UI-driven creation. p_accent: ''1''..''8'' or NULL (= hash fallback). p_description: ≤280 chars (DB CHECK lives on column).';
