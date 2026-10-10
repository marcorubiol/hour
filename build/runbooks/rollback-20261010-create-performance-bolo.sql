-- ROLLBACK for 20261010100000_create_performance_bolo.sql (ADR-087, § 37)
--
-- Brings back the eight-argument create_performance and
-- create_performance_series (no p_bolo_id), with the same owner, grants
-- ({postgres=X, authenticated=X}), SECURITY DEFINER and search_path they had,
-- and gives EXECUTE back on the trigger functions of `public` that had it.
--
-- No data is touched: performances created linked keep their bolo_id (the
-- PATCH could always write it), they simply cannot be created linked anymore.
--
-- Worker: the deployed Worker only calls the eight named arguments, so it works
-- on both sides. A Worker that sends p_bolo_id (this branch) gets a PostgREST
-- 404 «function not found» on create after this rollback: roll the Worker back
-- first, or together.
--
-- Trigger functions: before the migration, in the local catalog, five had an
-- explicit ACL {PUBLIC, postgres, anon, authenticated, service_role}
-- (guard_immutable_author, guard_immutable_created_by,
-- guard_immutable_task_parents, guard_immutable_workspace_id, set_updated_at)
-- and three had a NULL ACL, i.e. PUBLIC (guard_immutable_note_anchor,
-- guard_performance_bolo_same_project, maintain_conversation_contact_timestamps).
-- Granting EXECUTE to PUBLIC, anon and authenticated on those eight gives back
-- the same effective privileges; the ACL of the NULL three is now spelled out
-- instead of implicit. If production carried other exposed trigger functions,
-- the migration revoked them too and this list does not give them back: compare
-- with the advisor output before running.

BEGIN;

DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT oid::regprocedure::text AS signature
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('create_performance', 'create_performance_series')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', fn.signature);
  END LOOP;
END;
$$;

CREATE FUNCTION public.create_performance(
  p_project_id uuid,
  p_performed_at date,
  p_venue_name text DEFAULT NULL::text,
  p_city text DEFAULT NULL::text,
  p_country text DEFAULT NULL::text,
  p_status public.performance_status DEFAULT 'proposed'::public.performance_status,
  p_conversation_id uuid DEFAULT NULL::uuid,
  p_line_id uuid DEFAULT NULL::uuid
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

  IF NOT public.has_permission(p_project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'edit:performance required to create a performance'
      USING ERRCODE = '42501';
  END IF;

  IF p_conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.conversation
    WHERE id = p_conversation_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'conversation does not belong to project' USING ERRCODE = '22023';
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
        workspace_id, project_id, line_id, conversation_id,
        performed_at, status, venue_name, city, country, slug, created_by
      ) VALUES (
        v_workspace_id, p_project_id, p_line_id, p_conversation_id,
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

CREATE FUNCTION public.create_performance_series(
  p_project_id uuid,
  p_performed_at date[],
  p_venue_name text DEFAULT NULL::text,
  p_city text DEFAULT NULL::text,
  p_country text DEFAULT NULL::text,
  p_status public.performance_status DEFAULT 'proposed'::public.performance_status,
  p_conversation_id uuid DEFAULT NULL::uuid,
  p_line_id uuid DEFAULT NULL::uuid
)
RETURNS SETOF public.performance
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_series       uuid := uuid_generate_v7();
  v_n            int;
  v_day          date;
  v_base_slug    text;
  v_slug         text;
  v_try          int;
  v_perf         public.performance;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  v_n := coalesce(array_length(p_performed_at, 1), 0);

  IF v_n < 2 THEN
    RAISE EXCEPTION 'a series needs at least 2 rows — use create_performance for one'
      USING ERRCODE = '22023';
  END IF;

  IF v_n > 92 THEN
    RAISE EXCEPTION 'a series is capped at 92 rows' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_performed_at) d WHERE d IS NULL) THEN
    RAISE EXCEPTION 'performed_at cannot be null' USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(DISTINCT d) FROM unnest(p_performed_at) d) <> v_n THEN
    RAISE EXCEPTION 'a series cannot repeat a day' USING ERRCODE = '22023';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.project
  WHERE id = p_project_id AND deleted_at IS NULL;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'project % not found', p_project_id
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_permission(p_project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'edit:performance required to create a performance'
      USING ERRCODE = '42501';
  END IF;

  IF p_conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.conversation
    WHERE id = p_conversation_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'conversation does not belong to project' USING ERRCODE = '22023';
  END IF;

  IF p_line_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.line
    WHERE id = p_line_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'line does not belong to project' USING ERRCODE = '22023';
  END IF;

  FOR v_day IN
    SELECT d FROM unnest(p_performed_at) AS d ORDER BY d
  LOOP
    v_base_slug := public.slugify(
      coalesce(NULLIF(trim(p_venue_name), ''), NULLIF(trim(p_city), ''), 'gig')
    ) || '-' || to_char(v_day, 'YYYY-MM-DD');
    v_slug := v_base_slug;
    v_try := 0;

    LOOP
      BEGIN
        INSERT INTO public.performance (
          workspace_id, project_id, line_id, conversation_id,
          performed_at, status, venue_name, city, country,
          slug, series_id, created_by
        ) VALUES (
          v_workspace_id, p_project_id, p_line_id, p_conversation_id,
          v_day, p_status,
          NULLIF(trim(p_venue_name), ''),
          NULLIF(trim(p_city), ''),
          NULLIF(upper(trim(p_country)), ''),
          v_slug, v_series, v_caller
        )
        RETURNING * INTO v_perf;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        v_try := v_try + 1;
        IF v_try > 20 THEN RAISE; END IF;
        v_slug := v_base_slug || '-' || (v_try + 1)::text;
      END;
    END LOOP;

    RETURN NEXT v_perf;
  END LOOP;
END;
$function$;


ALTER FUNCTION public.create_performance(
  uuid, date, text, text, text, public.performance_status, uuid, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_performance(
  uuid, date, text, text, text, public.performance_status, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_performance(
  uuid, date, text, text, text, public.performance_status, uuid, uuid
) TO authenticated;

ALTER FUNCTION public.create_performance_series(
  uuid, date[], text, text, text, public.performance_status, uuid, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_performance_series(
  uuid, date[], text, text, text, public.performance_status, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_performance_series(
  uuid, date[], text, text, text, public.performance_status, uuid, uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION
  public.guard_immutable_author(),
  public.guard_immutable_created_by(),
  public.guard_immutable_task_parents(),
  public.guard_immutable_workspace_id(),
  public.set_updated_at(),
  public.guard_immutable_note_anchor(),
  public.guard_performance_bolo_same_project(),
  public.maintain_conversation_contact_timestamps()
TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.guard_immutable_author(),
  public.guard_immutable_created_by(),
  public.guard_immutable_task_parents(),
  public.guard_immutable_workspace_id(),
  public.set_updated_at()
TO service_role;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261010100000';

COMMIT;
