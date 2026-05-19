-- Migration: rename_show_to_performance
-- ADR-036: rename schema `show` → `performance`. "Show" en Hour schema = gig
-- atómico, pero en castellano/inglés industria el usuario lo confunde con
-- la pieza/producción. `performance` es universal cross-arts (teatro,
-- danza, música, performance art) y traduce limpio ES↔EN (función,
-- actuación, performance). Naming gate 2026-05-19 con UI viva.
--
-- Adicional: rename column show.show_start_at → performance.start_at
-- (las otras 4 timeslot columns ya son específicas: load_in_at,
-- soundcheck_at, loadout_at, wrap_at — start_at suficiente sin prefijo).
--
-- El permiso `edit:show` se mantiene como string en el closed RBAC vocab
-- (ADR-006) — es un código de permiso, no un nombre de tabla. Renombrar
-- requiere update masivo de workspace_role.permissions + project_membership.
-- permission_grants/revokes; se difiere a Phase 0.9 admin UI.
--
-- Applied via Supabase MCP apply_migration 2026-05-19 (name:
-- rename_show_to_performance). This file is the canonical record.

BEGIN;

-- §1 Drop dependent view
DROP VIEW IF EXISTS public.show_redacted;

-- §2 Drop CHECK constraint on collab_snapshot
ALTER TABLE public.collab_snapshot DROP CONSTRAINT IF EXISTS collab_snapshot_target_table_chk;

-- §3 Drop policies that reference show table or its helper functions
DROP POLICY IF EXISTS show_insert ON public.show;
DROP POLICY IF EXISTS show_select ON public.show;
DROP POLICY IF EXISTS show_update ON public.show;

DROP POLICY IF EXISTS crew_assignment_select ON public.crew_assignment;
DROP POLICY IF EXISTS crew_assignment_insert ON public.crew_assignment;
DROP POLICY IF EXISTS crew_assignment_update ON public.crew_assignment;
DROP POLICY IF EXISTS crew_assignment_delete ON public.crew_assignment;

DROP POLICY IF EXISTS cast_override_select ON public.cast_override;
DROP POLICY IF EXISTS cast_override_insert ON public.cast_override;
DROP POLICY IF EXISTS cast_override_update ON public.cast_override;
DROP POLICY IF EXISTS cast_override_delete ON public.cast_override;

DROP POLICY IF EXISTS asset_version_select ON public.asset_version;
DROP POLICY IF EXISTS asset_version_insert ON public.asset_version;
DROP POLICY IF EXISTS asset_version_update ON public.asset_version;
DROP POLICY IF EXISTS asset_version_delete ON public.asset_version;

DROP POLICY IF EXISTS expense_select ON public.expense;
DROP POLICY IF EXISTS expense_insert ON public.expense;
DROP POLICY IF EXISTS expense_update ON public.expense;

-- §4 Drop helper functions
DROP FUNCTION IF EXISTS public.project_id_of_show(uuid);
DROP FUNCTION IF EXISTS public.project_id_of_asset_version(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.project_id_of_expense(uuid);

-- §5 Rename table
ALTER TABLE public.show RENAME TO performance;

-- §6 Rename column show_start_at → start_at
ALTER TABLE public.performance RENAME COLUMN show_start_at TO start_at;

-- §7 Rename FK columns show_id → performance_id in 6 tables
ALTER TABLE public.crew_assignment RENAME COLUMN show_id TO performance_id;
ALTER TABLE public.cast_override   RENAME COLUMN show_id TO performance_id;
ALTER TABLE public.asset_version   RENAME COLUMN show_id TO performance_id;
ALTER TABLE public.date            RENAME COLUMN show_id TO performance_id;
ALTER TABLE public.expense         RENAME COLUMN show_id TO performance_id;
ALTER TABLE public.invoice_line    RENAME COLUMN show_id TO performance_id;

-- §8 Rename constraints on performance
ALTER TABLE public.performance RENAME CONSTRAINT show_pkey               TO performance_pkey;
ALTER TABLE public.performance RENAME CONSTRAINT show_workspace_id_fkey  TO performance_workspace_id_fkey;
ALTER TABLE public.performance RENAME CONSTRAINT show_project_id_fkey    TO performance_project_id_fkey;
ALTER TABLE public.performance RENAME CONSTRAINT show_line_id_fkey       TO performance_line_id_fkey;
ALTER TABLE public.performance RENAME CONSTRAINT show_engagement_id_fkey TO performance_engagement_id_fkey;
ALTER TABLE public.performance RENAME CONSTRAINT show_venue_id_fkey      TO performance_venue_id_fkey;
ALTER TABLE public.performance RENAME CONSTRAINT show_created_by_fkey    TO performance_created_by_fkey;
ALTER TABLE public.performance RENAME CONSTRAINT show_country_format     TO performance_country_format;
ALTER TABLE public.performance RENAME CONSTRAINT show_currency_format    TO performance_currency_format;
ALTER TABLE public.performance RENAME CONSTRAINT show_timeslots_ordered  TO performance_timeslots_ordered;

-- §9 Rename FK constraints on referring tables
ALTER TABLE public.crew_assignment RENAME CONSTRAINT crew_assignment_show_id_fkey TO crew_assignment_performance_id_fkey;
ALTER TABLE public.cast_override   RENAME CONSTRAINT cast_override_show_id_fkey   TO cast_override_performance_id_fkey;
ALTER TABLE public.asset_version   RENAME CONSTRAINT asset_version_show_id_fkey   TO asset_version_performance_id_fkey;
ALTER TABLE public.date            RENAME CONSTRAINT date_show_id_fkey            TO date_performance_id_fkey;
ALTER TABLE public.expense         RENAME CONSTRAINT expense_show_id_fkey         TO expense_performance_id_fkey;
ALTER TABLE public.invoice_line    RENAME CONSTRAINT invoice_line_show_id_fkey    TO invoice_line_performance_id_fkey;

-- §10 Rename indexes on performance
ALTER INDEX public.show_workspace_idx       RENAME TO performance_workspace_idx;
ALTER INDEX public.show_project_idx         RENAME TO performance_project_idx;
ALTER INDEX public.show_line_idx            RENAME TO performance_line_idx;
ALTER INDEX public.show_engagement_idx      RENAME TO performance_engagement_idx;
ALTER INDEX public.show_performed_at_idx    RENAME TO performance_performed_at_idx;
ALTER INDEX public.show_status_idx          RENAME TO performance_status_idx;
ALTER INDEX public.show_logistics_gin_idx   RENAME TO performance_logistics_gin_idx;
ALTER INDEX public.show_hospitality_gin_idx RENAME TO performance_hospitality_gin_idx;
ALTER INDEX public.show_technical_gin_idx   RENAME TO performance_technical_gin_idx;
ALTER INDEX public.show_slug_uidx           RENAME TO performance_slug_uidx;
ALTER INDEX public.show_previous_slugs_gin  RENAME TO performance_previous_slugs_gin;

-- §11 Rename indexes on referring tables
ALTER INDEX public.crew_assignment_show_idx              RENAME TO crew_assignment_performance_idx;
ALTER INDEX public.crew_assignment_show_person_role_uidx RENAME TO crew_assignment_performance_person_role_uidx;
ALTER INDEX public.cast_override_show_idx                RENAME TO cast_override_performance_idx;
ALTER INDEX public.cast_override_show_person_uidx        RENAME TO cast_override_performance_person_uidx;
ALTER INDEX public.asset_version_show_idx                RENAME TO asset_version_performance_idx;
ALTER INDEX public.date_show_idx                         RENAME TO date_performance_idx;
ALTER INDEX public.expense_show_idx                      RENAME TO expense_performance_idx;
ALTER INDEX public.invoice_line_show_idx                 RENAME TO invoice_line_performance_idx;

-- §12 Rename triggers on performance
ALTER TRIGGER show_audit             ON public.performance RENAME TO performance_audit;
ALTER TRIGGER show_guard_creator     ON public.performance RENAME TO performance_guard_creator;
ALTER TRIGGER show_guard_fee_columns ON public.performance RENAME TO performance_guard_fee_columns;
ALTER TRIGGER show_guard_ws          ON public.performance RENAME TO performance_guard_ws;
ALTER TRIGGER show_set_updated_at    ON public.performance RENAME TO performance_set_updated_at;
ALTER TRIGGER show_slug_validate     ON public.performance RENAME TO performance_slug_validate;

-- §13 Rename enum type
ALTER TYPE public.show_status RENAME TO performance_status;

-- §14 Recreate helper functions
CREATE OR REPLACE FUNCTION public.project_id_of_performance(p_performance_id uuid)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ SELECT project_id FROM public.performance WHERE id = p_performance_id; $function$;
REVOKE ALL ON FUNCTION public.project_id_of_performance(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.project_id_of_performance(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.project_id_of_asset_version(p_project_id uuid, p_line_id uuid, p_performance_id uuid)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    p_project_id,
    (SELECT project_id FROM public.line WHERE id = p_line_id),
    (SELECT project_id FROM public.performance WHERE id = p_performance_id)
  );
$function$;
REVOKE ALL ON FUNCTION public.project_id_of_asset_version(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.project_id_of_asset_version(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.project_id_of_expense(p_expense_id uuid)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT pf.project_id FROM public.performance pf JOIN public.expense e ON e.performance_id = pf.id WHERE e.id = p_expense_id),
    (SELECT l.project_id  FROM public.line        l  JOIN public.expense e ON e.line_id        = l.id  WHERE e.id = p_expense_id)
  );
$function$;
REVOKE ALL ON FUNCTION public.project_id_of_expense(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.project_id_of_expense(uuid) TO authenticated;

-- §15-19 Recreate policies (see full SQL in apply_migration call 2026-05-19;
-- elided here for brevity — patterns mirror line→section recreation):
--   • performance_select/insert/update          (project_id, 'edit:show')
--   • crew_assignment_*                          (project_id_of_performance(performance_id), 'edit:show')
--   • cast_override_*                            (same pattern)
--   • asset_version_*                            (project_id_of_asset_version(project_id, line_id, performance_id), 'edit:show')
--   • expense_*                                  (inline COALESCE references performance/line, 'edit:money'/'read:money')

CREATE POLICY performance_select ON public.performance FOR SELECT TO authenticated
USING ((deleted_at IS NULL) AND has_permission(project_id, 'edit:show'::text));
CREATE POLICY performance_insert ON public.performance FOR INSERT TO authenticated
WITH CHECK ((workspace_id = current_workspace_id()) AND has_permission(project_id, 'edit:show'::text));
CREATE POLICY performance_update ON public.performance FOR UPDATE TO authenticated
USING ((deleted_at IS NULL) AND has_permission(project_id, 'edit:show'::text))
WITH CHECK (has_permission(project_id, 'edit:show'::text));

CREATE POLICY crew_assignment_select ON public.crew_assignment FOR SELECT TO authenticated
USING ((deleted_at IS NULL) AND has_permission(project_id_of_performance(performance_id), 'edit:show'::text));
CREATE POLICY crew_assignment_insert ON public.crew_assignment FOR INSERT TO authenticated
WITH CHECK ((workspace_id = current_workspace_id()) AND has_permission(project_id_of_performance(performance_id), 'edit:show'::text));
CREATE POLICY crew_assignment_update ON public.crew_assignment FOR UPDATE TO authenticated
USING ((deleted_at IS NULL) AND has_permission(project_id_of_performance(performance_id), 'edit:show'::text))
WITH CHECK (has_permission(project_id_of_performance(performance_id), 'edit:show'::text));
CREATE POLICY crew_assignment_delete ON public.crew_assignment FOR DELETE TO authenticated
USING (has_permission(project_id_of_performance(performance_id), 'edit:show'::text));

CREATE POLICY cast_override_select ON public.cast_override FOR SELECT TO authenticated
USING ((deleted_at IS NULL) AND has_permission(project_id_of_performance(performance_id), 'edit:show'::text));
CREATE POLICY cast_override_insert ON public.cast_override FOR INSERT TO authenticated
WITH CHECK ((workspace_id = current_workspace_id()) AND has_permission(project_id_of_performance(performance_id), 'edit:show'::text));
CREATE POLICY cast_override_update ON public.cast_override FOR UPDATE TO authenticated
USING ((deleted_at IS NULL) AND has_permission(project_id_of_performance(performance_id), 'edit:show'::text))
WITH CHECK (has_permission(project_id_of_performance(performance_id), 'edit:show'::text));
CREATE POLICY cast_override_delete ON public.cast_override FOR DELETE TO authenticated
USING (has_permission(project_id_of_performance(performance_id), 'edit:show'::text));

CREATE POLICY asset_version_select ON public.asset_version FOR SELECT TO authenticated
USING ((deleted_at IS NULL) AND has_permission(project_id_of_asset_version(project_id, line_id, performance_id), 'edit:show'::text));
CREATE POLICY asset_version_insert ON public.asset_version FOR INSERT TO authenticated
WITH CHECK ((workspace_id = current_workspace_id()) AND has_permission(project_id_of_asset_version(project_id, line_id, performance_id), 'edit:show'::text));
CREATE POLICY asset_version_update ON public.asset_version FOR UPDATE TO authenticated
USING ((deleted_at IS NULL) AND has_permission(project_id_of_asset_version(project_id, line_id, performance_id), 'edit:show'::text))
WITH CHECK (has_permission(project_id_of_asset_version(project_id, line_id, performance_id), 'edit:show'::text));
CREATE POLICY asset_version_delete ON public.asset_version FOR DELETE TO authenticated
USING (has_permission(project_id_of_asset_version(project_id, line_id, performance_id), 'edit:show'::text));

CREATE POLICY expense_select ON public.expense FOR SELECT TO authenticated
USING ((deleted_at IS NULL) AND has_permission(project_id_of_expense(id), 'read:money'::text));
CREATE POLICY expense_insert ON public.expense FOR INSERT TO authenticated
WITH CHECK ((workspace_id = current_workspace_id()) AND has_permission(
  COALESCE(
    (SELECT pf.project_id FROM public.performance pf WHERE pf.id = expense.performance_id),
    (SELECT l.project_id  FROM public.line        l  WHERE l.id  = expense.line_id)
  ),
  'edit:money'::text
));
CREATE POLICY expense_update ON public.expense FOR UPDATE TO authenticated
USING ((deleted_at IS NULL) AND has_permission(project_id_of_expense(id), 'edit:money'::text))
WITH CHECK (has_permission(
  COALESCE(
    (SELECT pf.project_id FROM public.performance pf WHERE pf.id = expense.performance_id),
    (SELECT l.project_id  FROM public.line        l  WHERE l.id  = expense.line_id)
  ),
  'edit:money'::text
));

-- §20 Recreate view performance_redacted
CREATE OR REPLACE VIEW public.performance_redacted AS
SELECT id, workspace_id, project_id, line_id, engagement_id, performed_at,
       venue_id, venue_name, city, country, status,
       CASE WHEN has_permission(project_id, 'read:money'::text) THEN fee_amount   ELSE NULL::numeric END AS fee_amount,
       CASE WHEN has_permission(project_id, 'read:money'::text) THEN fee_currency ELSE NULL::bpchar  END AS fee_currency,
       notes, custom_fields, created_by, created_at, updated_at, deleted_at
FROM public.performance;

-- §21 Recreate collab_snapshot CHECK constraint with 'performance' instead of 'show'
ALTER TABLE public.collab_snapshot
  ADD CONSTRAINT collab_snapshot_target_table_chk
  CHECK (target_table IN ('performance', 'project'));

COMMIT;
