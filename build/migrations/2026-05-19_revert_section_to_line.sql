-- Migration: revert_section_to_line
-- ADR-035: supersede ADR-031. Naming gate vivido con UI productiva
-- (2026-05-19, demo data + 1 día de UI viva) confirmó preferencia por
-- `line` sobre `section`. "Línea de trabajo" funciona en castellano y en
-- inglés ("line of work") para los 10 kinds — el chirría que motivó
-- ADR-031 estaba sobre-estimado, `line` es polisémico, no exclusivo del
-- touring. Los 4 enum values añadidos por ADR-031 (creation, campaign,
-- comms, misc) se conservan dentro del enum renombrado a line_kind.
--
-- Mirror inverso de 2026-05-18_rename_line_to_section.sql.
--
-- Applied via Supabase MCP apply_migration 2026-05-19 (name:
-- revert_section_to_line). This file is the canonical record.

-- 1) Drop dependent view.
DROP VIEW IF EXISTS public.show_redacted;

-- 2) Drop policies that need recreation.
DROP POLICY IF EXISTS asset_version_select ON public.asset_version;
DROP POLICY IF EXISTS asset_version_insert ON public.asset_version;
DROP POLICY IF EXISTS asset_version_update ON public.asset_version;
DROP POLICY IF EXISTS asset_version_delete ON public.asset_version;
DROP POLICY IF EXISTS expense_select ON public.expense;
DROP POLICY IF EXISTS expense_insert ON public.expense;
DROP POLICY IF EXISTS expense_update ON public.expense;
DROP POLICY IF EXISTS section_insert ON public.section;
DROP POLICY IF EXISTS section_select ON public.section;
DROP POLICY IF EXISTS section_update ON public.section;

-- 3) Drop helper functions.
DROP FUNCTION IF EXISTS public.project_id_of_asset_version(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.project_id_of_expense(uuid);

-- 4) Rename the table.
ALTER TABLE public.section RENAME TO line;

-- 5) Rename FK columns.
ALTER TABLE public.asset_version RENAME COLUMN section_id TO line_id;
ALTER TABLE public.expense        RENAME COLUMN section_id TO line_id;
ALTER TABLE public."show"         RENAME COLUMN section_id TO line_id;

-- 6a) Rename FK constraints.
ALTER TABLE public.asset_version RENAME CONSTRAINT asset_version_section_id_fkey TO asset_version_line_id_fkey;
ALTER TABLE public.expense        RENAME CONSTRAINT expense_section_id_fkey        TO expense_line_id_fkey;
ALTER TABLE public."show"         RENAME CONSTRAINT show_section_id_fkey           TO show_line_id_fkey;

-- 6b) Rename triggers.
ALTER TRIGGER section_audit            ON public.line RENAME TO line_audit;
ALTER TRIGGER section_guard_creator    ON public.line RENAME TO line_guard_creator;
ALTER TRIGGER section_guard_ws         ON public.line RENAME TO line_guard_ws;
ALTER TRIGGER section_set_updated_at   ON public.line RENAME TO line_set_updated_at;
ALTER TRIGGER section_slug_validate    ON public.line RENAME TO line_slug_validate;

-- 7) Rename enum types.
ALTER TYPE public.section_kind   RENAME TO line_kind;
ALTER TYPE public.section_status RENAME TO line_status;

-- 8) Recreate helper functions (with p_line_id parameter).
CREATE OR REPLACE FUNCTION public.project_id_of_asset_version(p_project_id uuid, p_line_id uuid, p_show_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    p_project_id,
    (SELECT project_id FROM public.line WHERE id = p_line_id),
    (SELECT project_id FROM public.show WHERE id = p_show_id)
  );
$function$;
REVOKE ALL ON FUNCTION public.project_id_of_asset_version(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.project_id_of_asset_version(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.project_id_of_expense(p_expense_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT s.project_id FROM public.show s JOIN public.expense e ON e.show_id = s.id WHERE e.id = p_expense_id),
    (SELECT l.project_id FROM public.line l JOIN public.expense e ON e.line_id  = l.id WHERE e.id = p_expense_id)
  );
$function$;
REVOKE ALL ON FUNCTION public.project_id_of_expense(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.project_id_of_expense(uuid) TO authenticated;

-- 9) Recreate policies.
CREATE POLICY line_select ON public.line FOR SELECT TO authenticated
USING ((deleted_at IS NULL) AND (has_permission(project_id, 'edit:show'::text) OR has_permission(project_id, 'edit:project_meta'::text)));

CREATE POLICY line_insert ON public.line FOR INSERT TO authenticated
WITH CHECK ((workspace_id = current_workspace_id()) AND (has_permission(project_id, 'edit:show'::text) OR has_permission(project_id, 'edit:project_meta'::text)));

CREATE POLICY line_update ON public.line FOR UPDATE TO authenticated
USING ((deleted_at IS NULL) AND (has_permission(project_id, 'edit:show'::text) OR has_permission(project_id, 'edit:project_meta'::text)))
WITH CHECK (has_permission(project_id, 'edit:show'::text) OR has_permission(project_id, 'edit:project_meta'::text));

CREATE POLICY asset_version_select ON public.asset_version FOR SELECT TO authenticated
USING ((deleted_at IS NULL) AND has_permission(project_id_of_asset_version(project_id, line_id, show_id), 'edit:show'::text));

CREATE POLICY asset_version_insert ON public.asset_version FOR INSERT TO authenticated
WITH CHECK ((workspace_id = current_workspace_id()) AND has_permission(project_id_of_asset_version(project_id, line_id, show_id), 'edit:show'::text));

CREATE POLICY asset_version_update ON public.asset_version FOR UPDATE TO authenticated
USING ((deleted_at IS NULL) AND has_permission(project_id_of_asset_version(project_id, line_id, show_id), 'edit:show'::text))
WITH CHECK (has_permission(project_id_of_asset_version(project_id, line_id, show_id), 'edit:show'::text));

CREATE POLICY asset_version_delete ON public.asset_version FOR DELETE TO authenticated
USING (has_permission(project_id_of_asset_version(project_id, line_id, show_id), 'edit:show'::text));

CREATE POLICY expense_select ON public.expense FOR SELECT TO authenticated
USING ((deleted_at IS NULL) AND has_permission(project_id_of_expense(id), 'read:money'::text));

CREATE POLICY expense_insert ON public.expense FOR INSERT TO authenticated
WITH CHECK ((workspace_id = current_workspace_id()) AND has_permission(
  COALESCE(
    (SELECT s.project_id FROM public.show s WHERE s.id = expense.show_id),
    (SELECT l.project_id FROM public.line l WHERE l.id = expense.line_id)
  ),
  'edit:money'::text
));

CREATE POLICY expense_update ON public.expense FOR UPDATE TO authenticated
USING ((deleted_at IS NULL) AND has_permission(project_id_of_expense(id), 'edit:money'::text))
WITH CHECK (has_permission(
  COALESCE(
    (SELECT s.project_id FROM public.show s WHERE s.id = expense.show_id),
    (SELECT l.project_id FROM public.line l WHERE l.id = expense.line_id)
  ),
  'edit:money'::text
));

-- 10) Recreate the redacted view with line_id.
CREATE OR REPLACE VIEW public.show_redacted AS
SELECT id,
    workspace_id,
    project_id,
    line_id,
    engagement_id,
    performed_at,
    venue_id,
    venue_name,
    city,
    country,
    status,
    CASE
        WHEN has_permission(project_id, 'read:money'::text) THEN fee_amount
        ELSE NULL::numeric
    END AS fee_amount,
    CASE
        WHEN has_permission(project_id, 'read:money'::text) THEN fee_currency
        ELSE NULL::bpchar
    END AS fee_currency,
    notes,
    custom_fields,
    created_by,
    created_at,
    updated_at,
    deleted_at
FROM public.show;
