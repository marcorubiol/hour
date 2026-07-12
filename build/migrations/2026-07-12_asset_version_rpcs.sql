-- ADR-056: Materials module v1 — manual asset_version rows at line scope
-- (registry + links; upload arrives with R2 UI later). Two RPCs:
--
-- · create_asset_version — INSERT is claim-bound (workspace_id =
--   current_workspace_id()), ninth case of the pattern. Gate
--   has_permission(line.project_id, 'edit:show') — same permission the
--   asset_version policies use. v1 scope is LINE-ONLY (the module's
--   registry); performance/project scoped rows can get their own params
--   when their UI exists.
--   Direction: the table CHECK forbids 'inbound' without performance_id,
--   so line scope only admits 'outbound' (and 'adapted', which requires a
--   source — not exposed in v1). Validated here for a friendlier error.
-- · delete_asset_version — a hard DELETE policy exists (edit:show), but the
--   house rule since ADR-048 is soft-delete via RPC (audit trail stays).
--
-- PENDING APPLY — run via Supabase MCP apply_migration
-- (name: asset_version_rpcs). This file is the canonical record.

CREATE OR REPLACE FUNCTION public.create_asset_version(
  p_line_id uuid,
  p_kind public.asset_kind,
  p_url text,
  p_direction public.asset_direction DEFAULT 'outbound',
  p_notes text DEFAULT NULL
)
RETURNS public.asset_version
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_project_id   uuid;
  v_url          text := nullif(btrim(coalesce(p_url, '')), '');
  v_asset        public.asset_version;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_url IS NULL THEN
    RAISE EXCEPTION 'url cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF p_direction = 'inbound' THEN
    RAISE EXCEPTION 'inbound versions attach to a performance, not a line'
      USING ERRCODE = '22023';
  END IF;

  IF p_direction = 'adapted' THEN
    RAISE EXCEPTION 'adapted versions need a source — not supported at line scope yet'
      USING ERRCODE = '22023';
  END IF;

  SELECT workspace_id, project_id INTO v_workspace_id, v_project_id
  FROM public.line
  WHERE id = p_line_id AND deleted_at IS NULL;

  IF v_project_id IS NULL THEN
    -- Not-found and no-permission collapse (no existence oracle).
    RAISE EXCEPTION 'line not found' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_permission(v_project_id, 'edit:show') THEN
    RAISE EXCEPTION 'edit:show required to register a material'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.asset_version (
    workspace_id, line_id, kind, direction, url, notes, uploaded_by
  ) VALUES (
    v_workspace_id, p_line_id, p_kind, p_direction, v_url,
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_caller
  )
  RETURNING * INTO v_asset;

  RETURN v_asset;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_asset_version(uuid, public.asset_kind, text, public.asset_direction, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_asset_version(uuid, public.asset_kind, text, public.asset_direction, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_asset_version(p_asset_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller     uuid := auth.uid();
  v_project_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(a.project_id, l.project_id, p.project_id) INTO v_project_id
  FROM public.asset_version a
  LEFT JOIN public.line l ON l.id = a.line_id
  LEFT JOIN public.performance p ON p.id = a.performance_id
  WHERE a.id = p_asset_id AND a.deleted_at IS NULL;

  IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:show') THEN
    -- Not-found and no-permission collapse (no existence oracle).
    RAISE EXCEPTION 'material not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.asset_version SET deleted_at = now()
  WHERE id = p_asset_id AND deleted_at IS NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_asset_version(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_asset_version(uuid) TO authenticated;
