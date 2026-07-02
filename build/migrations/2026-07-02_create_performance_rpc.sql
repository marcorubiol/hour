-- ADR-043: creation RPC for performances — same rationale as
-- create_project/create_line: direct INSERTs are claim-bound
-- (workspace_id = current_workspace_id()), which denies creating gigs in
-- any workspace that isn't the caller's first membership. SECURITY
-- DEFINER + explicit checks instead. Gate: has_permission(project,
-- 'edit:show') — the domain rule for shows, same as the collab gate.
-- Slug: slugify(venue|city|'gig')-YYYY-MM-DD with numeric suffix on
-- collision (ADR-002 allows coexisting holds on the same slot).
--
-- Applied 2026-07-02 via Supabase MCP apply_migration
-- (name: create_performance_rpc).

CREATE OR REPLACE FUNCTION public.create_performance(
  p_project_id uuid,
  p_performed_at date,
  p_venue_name text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_status public.performance_status DEFAULT 'proposed',
  p_engagement_id uuid DEFAULT NULL,
  p_line_id uuid DEFAULT NULL
)
RETURNS public.performance
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_base_slug    text;
  v_slug         text;
  v_perf         public.performance;
  v_try          int := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_performed_at IS NULL THEN
    RAISE EXCEPTION 'performed_at cannot be null' USING ERRCODE = '22023';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.project
  WHERE id = p_project_id AND deleted_at IS NULL;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'project % not found', p_project_id
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_permission(p_project_id, 'edit:show') THEN
    RAISE EXCEPTION 'edit:show required to create a performance'
      USING ERRCODE = '42501';
  END IF;

  IF p_engagement_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.engagement
    WHERE id = p_engagement_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'engagement does not belong to project' USING ERRCODE = '22023';
  END IF;

  IF p_line_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.line
    WHERE id = p_line_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'line does not belong to project' USING ERRCODE = '22023';
  END IF;

  v_base_slug := public.slugify(
    coalesce(NULLIF(trim(p_venue_name), ''), NULLIF(trim(p_city), ''), 'gig')
  ) || '-' || to_char(p_performed_at, 'YYYY-MM-DD');
  v_slug := v_base_slug;

  LOOP
    BEGIN
      INSERT INTO public.performance (
        workspace_id, project_id, line_id, engagement_id,
        performed_at, status, venue_name, city, country, slug, created_by
      ) VALUES (
        v_workspace_id, p_project_id, p_line_id, p_engagement_id,
        p_performed_at, p_status,
        NULLIF(trim(p_venue_name), ''),
        NULLIF(trim(p_city), ''),
        NULLIF(upper(trim(p_country)), ''),
        v_slug, v_caller
      )
      RETURNING * INTO v_perf;
      RETURN v_perf;
    EXCEPTION WHEN unique_violation THEN
      v_try := v_try + 1;
      IF v_try > 20 THEN RAISE; END IF;
      v_slug := v_base_slug || '-' || (v_try + 1)::text;
    END;
  END LOOP;
END;
$function$;

-- Grants: strip the default PUBLIC EXECUTE (a bare REVOKE FROM anon
-- leaves it in place — caught in review, fixed live via
-- fix_create_performance_grants), authenticated only.
REVOKE ALL ON FUNCTION public.create_performance(uuid, date, text, text, text, public.performance_status, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_performance(uuid, date, text, text, text, public.performance_status, uuid, uuid) TO authenticated;
