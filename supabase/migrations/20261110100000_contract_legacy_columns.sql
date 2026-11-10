-- 95 contract: drop five columns nothing reads or writes any more.
--
--   performance.readiness  ADR-084 § 3, no longer written since ADR-164 § 2
--   line.modules           a line draws its kind's modules (ADR-166)
--   line.dossier_url       never wired; materials live in asset_version
--   project.dossier_url    idem
--   project.poster_url     idem
--
-- Catalog of production on 2026-11-10 (read before writing this):
--   - The only function that names any of them is public.create_line, which
--     inserts p_modules into line.modules. It is redefined below from
--     pg_get_functiondef of the live base, same signature (p_modules stays as
--     an accepted, ignored argument, so no overload and no PostgREST 300).
--   - No view, policy or trigger names them. Their dependants are their own
--     default and CHECK constraints (performance_readiness_is_object,
--     line_modules_check), which go with the column.
--   - The column grants on performance (SELECT list, 20260720172431) drop
--     with the column.
--   - Data: readiness non-empty only on 3 soft-deleted fixture rows; modules
--     on 5 lines of `playwright` and `demo`; the three URL columns are empty.
--
-- Functions returning public.line / public.project / public.performance
-- (create_line, create_project, update_project, create_performance,
-- create_performance_series) follow the row type: they just stop returning
-- the dropped fields.
--
-- Destructive: staging and inspect first (_tasks.md § 34).

CREATE OR REPLACE FUNCTION public.create_line(p_project_id uuid, p_name text, p_accent text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_kind line_kind DEFAULT 'other'::line_kind, p_modules jsonb DEFAULT NULL::jsonb)
 RETURNS public.line
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_accent       text;
  v_description  text;
  v_line_id      uuid;
  v_slug         text;
  v_line         public.line;
BEGIN
  -- p_modules is accepted and ignored (95): the column is gone and a line
  -- draws its kind's modules (ADR-166). Kept so the signature stays the live one.
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

  IF NOT private.model_has_workspace_role(v_workspace_id, v_caller, ARRAY['owner', 'admin', 'member']::public.membership_role[]) THEN
    RAISE EXCEPTION 'caller is not a member of workspace % with sufficient role', v_workspace_id
      USING ERRCODE = '42501';
  END IF;

  v_accent      := NULLIF(trim(p_accent), '');
  v_description := NULLIF(trim(p_description), '');

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
    created_by
  )
  VALUES (
    v_line_id, v_slug, v_workspace_id, p_project_id, trim(p_name), p_kind,
    v_accent, v_description, v_caller
  )
  RETURNING * INTO v_line;

  RETURN v_line;
END;
$function$;

ALTER TABLE public.performance DROP COLUMN readiness;
ALTER TABLE public.line DROP COLUMN modules, DROP COLUMN dossier_url;
ALTER TABLE public.project DROP COLUMN dossier_url, DROP COLUMN poster_url;
