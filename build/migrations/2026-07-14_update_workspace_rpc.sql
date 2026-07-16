-- Migration: update_workspace_rpc
-- ADR-062 — edit a space's identity fields. Companion to create_workspace.
-- workspace.UPDATE stays denied by RLS; edits go through this SECURITY
-- DEFINER wrapper, gated to owner/admin membership (members can create
-- projects but not rewrite the space identity).
--
-- jsonb patch semantics: only keys PRESENT in p_patch are touched; a present
-- key with '' / null clears the (nullable) column; absent keys are left as-is
-- (so logo_url survives an edit dialog that doesn't manage it). slug + kind
-- are NOT editable here (rename has its own previous_slugs machinery).
--
-- Applied via Supabase MCP apply_migration 2026-07-14 (name:
-- update_workspace_rpc). This file is the canonical record.

CREATE OR REPLACE FUNCTION public.update_workspace(
  p_workspace_id uuid,
  p_patch        jsonb
)
RETURNS public.workspace
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller    uuid := auth.uid();
  v_workspace public.workspace;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_membership m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id      = v_caller
      AND m.role         IN ('owner', 'admin')
      AND m.accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'caller lacks permission to edit workspace %', p_workspace_id
      USING ERRCODE = '42501';
  END IF;

  IF p_patch ? 'name' AND length(trim(coalesce(p_patch->>'name', ''))) = 0 THEN
    RAISE EXCEPTION 'name cannot be empty' USING ERRCODE = '22023';
  END IF;

  UPDATE public.workspace w SET
    name        = CASE WHEN p_patch ? 'name'        THEN trim(p_patch->>'name')                           ELSE w.name        END,
    description = CASE WHEN p_patch ? 'description' THEN NULLIF(trim(p_patch->>'description'), '')         ELSE w.description END,
    accent      = CASE WHEN p_patch ? 'accent'      THEN NULLIF(trim(p_patch->>'accent'), '')             ELSE w.accent      END,
    domain      = CASE WHEN p_patch ? 'domain'      THEN NULLIF(p_patch->>'domain', '')::workspace_domain ELSE w.domain      END,
    city        = CASE WHEN p_patch ? 'city'        THEN NULLIF(trim(p_patch->>'city'), '')               ELSE w.city        END,
    logo_url    = CASE WHEN p_patch ? 'logo_url'    THEN NULLIF(trim(p_patch->>'logo_url'), '')            ELSE w.logo_url    END,
    updated_at  = now()
  WHERE w.id = p_workspace_id AND w.deleted_at IS NULL
  RETURNING * INTO v_workspace;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace % not found', p_workspace_id USING ERRCODE = 'P0002';
  END IF;

  RETURN v_workspace;
END;
$$;

REVOKE ALL ON FUNCTION public.update_workspace(uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_workspace(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.update_workspace(uuid, jsonb) IS
  'Patch a workspace identity (name, description, accent, domain, city, logo_url). SECURITY DEFINER; requires owner/admin membership. jsonb patch: only present keys change; ""/null clears nullable fields; slug/kind not editable here. ADR-062.';
