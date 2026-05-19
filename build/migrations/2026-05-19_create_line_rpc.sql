-- Migration: create_line_rpc
-- Third in-page creation flow: + button on each project row in Plaza
-- opens a dialog to create a line under that project.
--
-- Mirrors create_project: SECURITY DEFINER wrapper, validates membership
-- against the line's workspace, returns the new row. Lines have no slug
-- column (the schema uses id-only addressing), so no slug-uniqueness loop.
--
-- Adds line.accent (palette index, same shape as workspace/project) and
-- line.description (≤280 char blurb). `notes` already exists for long-
-- form text — description is the short blurb shown in sidebar / cards.
--
-- Applied via Supabase MCP apply_migration 2026-05-19 (name:
-- create_line_rpc). This file is the canonical record.

ALTER TABLE public.line
  ADD COLUMN accent      text CHECK (accent IS NULL OR accent ~ '^[1-8]$'),
  ADD COLUMN description text CHECK (description IS NULL OR length(description) <= 280);

COMMENT ON COLUMN public.line.accent IS
  'Color identity. ''1''..''8'' = palette index into --accent-N tokens. NULL = derive via hash. Stored as text to allow future free-form colors by relaxing the CHECK.';

COMMENT ON COLUMN public.line.description IS
  'Short blurb (≤280 chars). Distinct from notes (long-form). Surfaced in sidebar tooltip / settings card.';

CREATE OR REPLACE FUNCTION public.create_line(
  p_project_id   uuid,
  p_name         text,
  p_accent       text DEFAULT NULL,
  p_description  text DEFAULT NULL,
  p_kind         public.line_kind DEFAULT 'other'
)
RETURNS public.line
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_accent       text;
  v_description  text;
  v_line         public.line;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'name cannot be empty' USING ERRCODE = '22023';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.project
  WHERE id = p_project_id AND deleted_at IS NULL;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'project % not found', p_project_id
      USING ERRCODE = '42501';
  END IF;

  -- Membership ≥ member of the project's workspace. Same tier check as
  -- the RLS line_insert policy expects via has_permission.
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_membership m
    WHERE m.workspace_id = v_workspace_id
      AND m.user_id      = v_caller
      AND m.accepted_at  IS NOT NULL
      AND m.role         IN ('owner', 'admin', 'member')
  ) THEN
    RAISE EXCEPTION 'caller is not a member of workspace % with sufficient role', v_workspace_id
      USING ERRCODE = '42501';
  END IF;

  v_accent      := NULLIF(trim(p_accent), '');
  v_description := NULLIF(trim(p_description), '');

  INSERT INTO public.line (
    workspace_id, project_id, name, kind, accent, description, created_by
  )
  VALUES (
    v_workspace_id, p_project_id, trim(p_name), p_kind, v_accent, v_description, v_caller
  )
  RETURNING * INTO v_line;

  RETURN v_line;
END;
$$;

REVOKE ALL ON FUNCTION public.create_line(uuid, text, text, text, public.line_kind) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_line(uuid, text, text, text, public.line_kind) TO authenticated;

COMMENT ON FUNCTION public.create_line(uuid, text, text, text, public.line_kind) IS
  'Creates a line in p_project_id with caller as created_by. SECURITY DEFINER bypasses RLS; validates membership ≥ member of the project''s workspace. Defaults: kind=other. p_accent / p_description optional.';
