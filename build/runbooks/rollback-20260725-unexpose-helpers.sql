-- ROLLBACK for 20260725100000_unexpose_project_id_helpers.sql
--
-- Captured from live production immediately BEFORE applying, on 2026-07-25.
-- This is the proportional preflight for that migration: it changes no data at
-- all (it creates a schema, moves three functions and recreates fourteen
-- policies), so the risk is not data loss but an RLS misconfiguration — and the
-- fix for that is putting the previous definitions back, verbatim, which is
-- exactly what this file does.
--
-- Symptom that would call for it: after the migration, authenticated users get
-- permission errors or empty reads on asset_version / cast_override /
-- crew_assignment / expense.
--
-- Run against production with psql, then re-run `pnpm --filter web test:rls`.

BEGIN;

-- 1. restore the public (API-exposed) helpers exactly as they were
CREATE OR REPLACE FUNCTION public.project_id_of_asset_version(p_project_id uuid, p_line_id uuid, p_performance_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    p_project_id,
    (SELECT project_id FROM public.line WHERE id = p_line_id),
    (SELECT project_id FROM public.performance WHERE id = p_performance_id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.project_id_of_expense(p_expense_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT b.project_id FROM public.bolo b JOIN public.expense e ON e.bolo_id = b.id WHERE e.id = p_expense_id),
    (SELECT l.project_id FROM public.line l JOIN public.expense e ON e.line_id = l.id WHERE e.id = p_expense_id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.project_id_of_performance(p_performance_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ SELECT project_id FROM public.performance WHERE id = p_performance_id; $function$;

REVOKE ALL ON FUNCTION public.project_id_of_asset_version(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.project_id_of_expense(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.project_id_of_performance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_id_of_asset_version(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_id_of_expense(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_id_of_performance(uuid) TO authenticated;

-- 2. restore the fourteen policies exactly as they were
DROP POLICY IF EXISTS asset_version_delete ON public.asset_version;
CREATE POLICY asset_version_delete ON public.asset_version FOR DELETE TO authenticated
  USING (has_permission(project_id_of_asset_version(project_id, line_id, performance_id), 'edit:performance'::text));
DROP POLICY IF EXISTS asset_version_insert ON public.asset_version;
CREATE POLICY asset_version_insert ON public.asset_version FOR INSERT TO authenticated
  WITH CHECK (((workspace_id = current_workspace_id()) AND has_permission(project_id_of_asset_version(project_id, line_id, performance_id), 'edit:performance'::text)));
DROP POLICY IF EXISTS asset_version_select ON public.asset_version;
CREATE POLICY asset_version_select ON public.asset_version FOR SELECT TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id_of_asset_version(project_id, line_id, performance_id), 'read:performance'::text)));
DROP POLICY IF EXISTS asset_version_update ON public.asset_version;
CREATE POLICY asset_version_update ON public.asset_version FOR UPDATE TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id_of_asset_version(project_id, line_id, performance_id), 'edit:performance'::text)))
  WITH CHECK (has_permission(project_id_of_asset_version(project_id, line_id, performance_id), 'edit:performance'::text));

DROP POLICY IF EXISTS cast_override_delete ON public.cast_override;
CREATE POLICY cast_override_delete ON public.cast_override FOR DELETE TO authenticated
  USING (has_permission(project_id_of_performance(performance_id), 'edit:performance'::text));
DROP POLICY IF EXISTS cast_override_insert ON public.cast_override;
CREATE POLICY cast_override_insert ON public.cast_override FOR INSERT TO authenticated
  WITH CHECK (((workspace_id = current_workspace_id()) AND has_permission(project_id_of_performance(performance_id), 'edit:performance'::text)));
DROP POLICY IF EXISTS cast_override_select ON public.cast_override;
CREATE POLICY cast_override_select ON public.cast_override FOR SELECT TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id_of_performance(performance_id), 'read:performance'::text)));
DROP POLICY IF EXISTS cast_override_update ON public.cast_override;
CREATE POLICY cast_override_update ON public.cast_override FOR UPDATE TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id_of_performance(performance_id), 'edit:performance'::text)))
  WITH CHECK (has_permission(project_id_of_performance(performance_id), 'edit:performance'::text));

DROP POLICY IF EXISTS crew_assignment_delete ON public.crew_assignment;
CREATE POLICY crew_assignment_delete ON public.crew_assignment FOR DELETE TO authenticated
  USING (has_permission(project_id_of_performance(performance_id), 'edit:performance'::text));
DROP POLICY IF EXISTS crew_assignment_insert ON public.crew_assignment;
CREATE POLICY crew_assignment_insert ON public.crew_assignment FOR INSERT TO authenticated
  WITH CHECK (((workspace_id = current_workspace_id()) AND has_permission(project_id_of_performance(performance_id), 'edit:performance'::text)));
DROP POLICY IF EXISTS crew_assignment_select ON public.crew_assignment;
CREATE POLICY crew_assignment_select ON public.crew_assignment FOR SELECT TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id_of_performance(performance_id), 'read:performance'::text)));
DROP POLICY IF EXISTS crew_assignment_update ON public.crew_assignment;
CREATE POLICY crew_assignment_update ON public.crew_assignment FOR UPDATE TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id_of_performance(performance_id), 'edit:performance'::text)))
  WITH CHECK (has_permission(project_id_of_performance(performance_id), 'edit:performance'::text));

DROP POLICY IF EXISTS expense_select ON public.expense;
CREATE POLICY expense_select ON public.expense FOR SELECT TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id_of_expense(id), 'read:money'::text)));
DROP POLICY IF EXISTS expense_update ON public.expense;
CREATE POLICY expense_update ON public.expense FOR UPDATE TO authenticated
  USING (((deleted_at IS NULL) AND has_permission(project_id_of_expense(id), 'edit:money'::text)))
  WITH CHECK (has_permission(COALESCE(( SELECT b.project_id
   FROM bolo b
  WHERE (b.id = expense.bolo_id)), ( SELECT l.project_id
   FROM line l
  WHERE (l.id = expense.line_id))), 'edit:money'::text));

-- 3. drop the private copies + schema
DROP FUNCTION IF EXISTS private.project_id_of_performance(uuid);
DROP FUNCTION IF EXISTS private.project_id_of_asset_version(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS private.project_id_of_expense(uuid);
DROP SCHEMA IF EXISTS private;

-- 4. un-record the migration so the history matches reality
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260725100000';

COMMIT;
