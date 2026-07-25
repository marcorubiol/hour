-- Take the project_id_of_* helpers off the public API surface
-- (hardening audit 2026-07-24, closed 2026-07-25).
--
-- These three SECURITY DEFINER helpers exist to let RLS policies resolve a
-- row's owning project. But living in `public` with EXECUTE granted to
-- `authenticated`, PostgREST also publishes them as RPCs — so any signed-in
-- user could ask, for ANY row id in the database:
--
--   POST /rest/v1/rpc/project_id_of_expense {"p_expense_id": "<uuid from tenant B>"}
--
-- and get back a non-null project_id: a cross-tenant existence-and-linkage
-- oracle that bypasses RLS by construction (they are DEFINER and take an id,
-- not a permission).
--
-- Impact is low — row ids are uuid v7/random and not secret, and nothing but
-- existence leaks — which is why the audit rated it LOW and deferred it. It is
-- closed here rather than left open.
--
-- The obvious fix, REVOKE EXECUTE FROM authenticated, WOULD BREAK THE APP: the
-- helpers are called from inside 14 RLS policies (asset_version, cast_override,
-- crew_assignment, expense) which are evaluated as the INVOKING role, and a
-- policy calling a function the caller cannot execute fails the whole query.
-- So the grant has to stay; what has to go is the API exposure.
--
-- PostgREST only publishes functions from its exposed schemas (`public`,
-- `graphql_public` here). Moving the helpers into a schema it does not expose
-- keeps them fully usable from SQL — policies, other functions — while making
-- the RPC endpoint 404. Same pattern Supabase documents for internal helpers.

CREATE SCHEMA IF NOT EXISTS private;

COMMENT ON SCHEMA private IS
  'Internal SQL helpers that must NOT be reachable through PostgREST. Not in the exposed-schema list, so nothing here is an API endpoint. Callable from policies and functions only.';

-- `authenticated` still needs to reach them: RLS policies run as the invoker.
GRANT USAGE ON SCHEMA private TO authenticated;
REVOKE ALL ON SCHEMA private FROM anon, PUBLIC;

-- ── the helpers, unchanged bodies ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.project_id_of_performance(p_performance_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$ SELECT project_id FROM public.performance WHERE id = p_performance_id; $$;

CREATE OR REPLACE FUNCTION private.project_id_of_asset_version(
  p_project_id uuid,
  p_line_id uuid,
  p_performance_id uuid
) RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
    p_project_id,
    (SELECT project_id FROM public.line WHERE id = p_line_id),
    (SELECT project_id FROM public.performance WHERE id = p_performance_id)
  );
$$;

CREATE OR REPLACE FUNCTION private.project_id_of_expense(p_expense_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  SELECT COALESCE(
    (SELECT b.project_id FROM public.bolo b JOIN public.expense e ON e.bolo_id = b.id WHERE e.id = p_expense_id),
    (SELECT l.project_id FROM public.line l JOIN public.expense e ON e.line_id = l.id WHERE e.id = p_expense_id)
  );
$$;

REVOKE ALL ON FUNCTION private.project_id_of_performance(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.project_id_of_asset_version(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.project_id_of_expense(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.project_id_of_performance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.project_id_of_asset_version(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.project_id_of_expense(uuid) TO authenticated;

-- ── repoint the 14 policies (bodies otherwise byte-identical) ───────────────

-- asset_version
DROP POLICY IF EXISTS asset_version_select ON public.asset_version;
CREATE POLICY asset_version_select ON public.asset_version
  FOR SELECT TO authenticated
  USING ((deleted_at IS NULL) AND public.has_permission(private.project_id_of_asset_version(project_id, line_id, performance_id), 'read:performance'));

DROP POLICY IF EXISTS asset_version_insert ON public.asset_version;
CREATE POLICY asset_version_insert ON public.asset_version
  FOR INSERT TO authenticated
  WITH CHECK ((workspace_id = public.current_workspace_id()) AND public.has_permission(private.project_id_of_asset_version(project_id, line_id, performance_id), 'edit:performance'));

DROP POLICY IF EXISTS asset_version_update ON public.asset_version;
CREATE POLICY asset_version_update ON public.asset_version
  FOR UPDATE TO authenticated
  USING ((deleted_at IS NULL) AND public.has_permission(private.project_id_of_asset_version(project_id, line_id, performance_id), 'edit:performance'))
  WITH CHECK (public.has_permission(private.project_id_of_asset_version(project_id, line_id, performance_id), 'edit:performance'));

DROP POLICY IF EXISTS asset_version_delete ON public.asset_version;
CREATE POLICY asset_version_delete ON public.asset_version
  FOR DELETE TO authenticated
  USING (public.has_permission(private.project_id_of_asset_version(project_id, line_id, performance_id), 'edit:performance'));

-- cast_override
DROP POLICY IF EXISTS cast_override_select ON public.cast_override;
CREATE POLICY cast_override_select ON public.cast_override
  FOR SELECT TO authenticated
  USING ((deleted_at IS NULL) AND public.has_permission(private.project_id_of_performance(performance_id), 'read:performance'));

DROP POLICY IF EXISTS cast_override_insert ON public.cast_override;
CREATE POLICY cast_override_insert ON public.cast_override
  FOR INSERT TO authenticated
  WITH CHECK ((workspace_id = public.current_workspace_id()) AND public.has_permission(private.project_id_of_performance(performance_id), 'edit:performance'));

DROP POLICY IF EXISTS cast_override_update ON public.cast_override;
CREATE POLICY cast_override_update ON public.cast_override
  FOR UPDATE TO authenticated
  USING ((deleted_at IS NULL) AND public.has_permission(private.project_id_of_performance(performance_id), 'edit:performance'))
  WITH CHECK (public.has_permission(private.project_id_of_performance(performance_id), 'edit:performance'));

DROP POLICY IF EXISTS cast_override_delete ON public.cast_override;
CREATE POLICY cast_override_delete ON public.cast_override
  FOR DELETE TO authenticated
  USING (public.has_permission(private.project_id_of_performance(performance_id), 'edit:performance'));

-- crew_assignment
DROP POLICY IF EXISTS crew_assignment_select ON public.crew_assignment;
CREATE POLICY crew_assignment_select ON public.crew_assignment
  FOR SELECT TO authenticated
  USING ((deleted_at IS NULL) AND public.has_permission(private.project_id_of_performance(performance_id), 'read:performance'));

DROP POLICY IF EXISTS crew_assignment_insert ON public.crew_assignment;
CREATE POLICY crew_assignment_insert ON public.crew_assignment
  FOR INSERT TO authenticated
  WITH CHECK ((workspace_id = public.current_workspace_id()) AND public.has_permission(private.project_id_of_performance(performance_id), 'edit:performance'));

DROP POLICY IF EXISTS crew_assignment_update ON public.crew_assignment;
CREATE POLICY crew_assignment_update ON public.crew_assignment
  FOR UPDATE TO authenticated
  USING ((deleted_at IS NULL) AND public.has_permission(private.project_id_of_performance(performance_id), 'edit:performance'))
  WITH CHECK (public.has_permission(private.project_id_of_performance(performance_id), 'edit:performance'));

DROP POLICY IF EXISTS crew_assignment_delete ON public.crew_assignment;
CREATE POLICY crew_assignment_delete ON public.crew_assignment
  FOR DELETE TO authenticated
  USING (public.has_permission(private.project_id_of_performance(performance_id), 'edit:performance'));

-- expense (its UPDATE ... WITH CHECK already inlines the lookup — kept verbatim)
DROP POLICY IF EXISTS expense_select ON public.expense;
CREATE POLICY expense_select ON public.expense
  FOR SELECT TO authenticated
  USING ((deleted_at IS NULL) AND public.has_permission(private.project_id_of_expense(id), 'read:money'));

DROP POLICY IF EXISTS expense_update ON public.expense;
CREATE POLICY expense_update ON public.expense
  FOR UPDATE TO authenticated
  USING ((deleted_at IS NULL) AND public.has_permission(private.project_id_of_expense(id), 'edit:money'))
  WITH CHECK (public.has_permission(
    COALESCE(
      (SELECT b.project_id FROM public.bolo b WHERE b.id = expense.bolo_id),
      (SELECT l.project_id FROM public.line l WHERE l.id = expense.line_id)
    ), 'edit:money'));

-- ── and the public (API-reachable) copies go ───────────────────────────────
DROP FUNCTION IF EXISTS public.project_id_of_performance(uuid);
DROP FUNCTION IF EXISTS public.project_id_of_asset_version(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.project_id_of_expense(uuid);
