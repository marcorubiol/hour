-- ADR-056: create_line learns the template shape — p_modules (the ordered
-- module set the chosen template fixes) — and finally generates a slug.
--
-- The slug gap: create_line (2026-05-19) never set line.slug, but the whole
-- nav is slug-addressed (/h/[ws]/project/[slug]/line/[line], lineUrl()).
-- The real lines got slugs via data migrations; any line created through
-- the old RPC would have been unreachable. New rule: slug = slugify(name),
-- unique among live rows per workspace, 6-hex id suffix on collision (the
-- ADR-024 id-suffix scheme used by person/engagement).
--
-- Defensive backfill: any live line still carrying a NULL slug gets one.
--
-- Signature change → DROP the old arity first (avoid a PostgREST-ambiguous
-- overload), then CREATE + grants.
--
-- Applied 2026-07-12 via Supabase MCP apply_migration — verified live
-- (pg_constraint / information_schema / pg_proc probes + backfill count 154).
-- (name: create_line_template). This file is the canonical record.

-- ── Backfill NULL slugs on live lines ───────────────────────────────────
UPDATE public.line l
SET slug = sub.new_slug
FROM (
  SELECT id,
    CASE
      WHEN row_number() OVER (
        PARTITION BY workspace_id, public.slugify(name)
        ORDER BY created_at, id
      ) = 1
        AND NOT EXISTS (
          SELECT 1 FROM public.line l2
          WHERE l2.workspace_id = line.workspace_id
            AND l2.slug = public.slugify(line.name)
            AND l2.deleted_at IS NULL
        )
      THEN public.slugify(name)
      ELSE public.slugify(name) || '-' ||
        substring(replace(id::text, '-', '') FROM 1 FOR 6)
    END AS new_slug
  FROM public.line
  WHERE slug IS NULL AND deleted_at IS NULL
) sub
WHERE l.id = sub.id;

DROP FUNCTION public.create_line(uuid, text, text, text, public.line_kind);

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

  -- ── Slug: slugify(name), (workspace, slug) unique among live rows,
  --    6-hex id suffix on collision (ADR-024 id-suffix scheme). ─────────
  v_line_id := public.uuid_generate_v7();
  v_slug := coalesce(nullif(public.slugify(trim(p_name)), ''), 'line');
  IF EXISTS (
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

COMMENT ON FUNCTION public.create_line(uuid, text, text, text, public.line_kind, jsonb) IS
  'Creates a line in p_project_id with caller as created_by. SECURITY DEFINER bypasses RLS; validates membership ≥ member of the project''s workspace. Generates slug (slugify + id-suffix on collision). p_modules = ordered module keys from the chosen template (ADR-056); NULL = kind defaults.';
