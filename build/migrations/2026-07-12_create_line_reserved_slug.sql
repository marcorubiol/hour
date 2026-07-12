-- Review follow-up (ADR-058): create_line v2 skipped the reserved-slug
-- recovery its siblings have — naming a line "Booking" (the template's own
-- card label!) slugifies to a reserved word, the line_slug_validate
-- trigger raises 23505, and the user gets an unactionable error. Same
-- id-suffix recovery as the collision path (create_workspace precedent).
--
-- Also caps the slug base at 57 chars: names go up to 80, slugify keeps
-- their length, and base(64) + '-xxxxxx'(7) would blow validate_slug's
-- 64-char limit.
--
-- Same signature → CREATE OR REPLACE is safe (no overload).
--
-- Applied 2026-07-12 via Supabase MCP apply_migration — verified live.
-- (name: create_line_reserved_slug). This file is the canonical record.

CREATE OR REPLACE FUNCTION public.create_line(
  p_project_id   uuid,
  p_name         text,
  p_accent       text DEFAULT NULL,
  p_description  text DEFAULT NULL,
  p_kind         public.line_kind DEFAULT 'other',
  p_modules      jsonb DEFAULT NULL
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
  v_line_id      uuid;
  v_slug         text;
  v_line         public.line;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'name cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF p_modules IS NOT NULL AND jsonb_typeof(p_modules) <> 'array' THEN
    RAISE EXCEPTION 'modules must be a json array' USING ERRCODE = '22023';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.project
  WHERE id = p_project_id AND deleted_at IS NULL;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'project % not found', p_project_id
      USING ERRCODE = '42501';
  END IF;

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

  -- ── Slug: slugify(name) capped at 57 chars (suffix room within the
  --    validate_slug 64 limit), reserved words and live collisions both
  --    recover with the ADR-024 6-hex id suffix. ────────────────────────
  v_line_id := public.uuid_generate_v7();
  v_slug := coalesce(nullif(left(public.slugify(trim(p_name)), 57), ''), 'line');
  v_slug := rtrim(v_slug, '-');
  IF public.is_reserved_slug(v_slug) OR EXISTS (
    SELECT 1 FROM public.line
    WHERE workspace_id = v_workspace_id AND slug = v_slug AND deleted_at IS NULL
  ) THEN
    v_slug := v_slug || '-' ||
      substring(replace(v_line_id::text, '-', '') FROM 1 FOR 6);
  END IF;

  INSERT INTO public.line (
    id, slug, workspace_id, project_id, name, kind, accent, description,
    modules, created_by
  )
  VALUES (
    v_line_id, v_slug, v_workspace_id, p_project_id, trim(p_name), p_kind,
    v_accent, v_description, p_modules, v_caller
  )
  RETURNING * INTO v_line;

  RETURN v_line;
END;
$$;

REVOKE ALL ON FUNCTION public.create_line(uuid, text, text, text, public.line_kind, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_line(uuid, text, text, text, public.line_kind, jsonb) TO authenticated;
