-- Migration: rename_line_to_section
-- Applied: 2026-05-18 via Supabase MCP apply_migration
-- ADR: ADR-031 (_decisions.md)
--
-- The word "line" was industry slang for touring (tour / season / festival
-- circuit / residency block — see ADR-005). The 2026-05-18 boceto from
-- Marco introduced kinds that aren't touring: creation phase, distribution
-- campaign, communication & press, one-offs. The abstract concept is
-- "operational grouping inside a Project"; the variety lives in the kind
-- enum, same pattern as `date.kind`.
--
-- Schema-only rename. Data untouched. Application code only referenced
-- the auto-generated db-types.ts, which is regenerated post-migration.
--
-- Sequence:
--   1. Drop the redacted view (depends on show.line_id).
--   2. Drop policies that inline `line` or call helper functions.
--   3. Drop helper functions (will recreate with new param name).
--   4. Rename table line → section.
--   5. Rename FK columns line_id → section_id (asset_version, expense, show).
--   6. Rename FK constraints and triggers.
--   7. Rename enum types line_kind → section_kind, line_status → section_status.
--   8. Recreate helper functions with renamed params + table refs.
--   9. Recreate RLS policies referencing the new names.
--  10. Recreate show_redacted view with the renamed column.
--
-- After this migration, a separate non-transactional call adds the new
-- kinds (creation, campaign, comms, misc) — ALTER TYPE ADD VALUE has
-- transaction restrictions, so it runs after the main block.

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
DROP POLICY IF EXISTS line_insert ON public.line;
DROP POLICY IF EXISTS line_select ON public.line;
DROP POLICY IF EXISTS line_update ON public.line;

-- 3) Drop helper functions.
DROP FUNCTION IF EXISTS public.project_id_of_asset_version(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.project_id_of_expense(uuid);

-- 4) Rename the table.
ALTER TABLE public.line RENAME TO section;

-- 5) Rename FK columns.
ALTER TABLE public.asset_version RENAME COLUMN line_id TO section_id;
ALTER TABLE public.expense RENAME COLUMN line_id TO section_id;
ALTER TABLE public."show" RENAME COLUMN line_id TO section_id;

-- 6a) Rename FK constraints.
ALTER TABLE public.asset_version RENAME CONSTRAINT asset_version_line_id_fkey TO asset_version_section_id_fkey;
ALTER TABLE public.expense RENAME CONSTRAINT expense_line_id_fkey TO expense_section_id_fkey;
ALTER TABLE public."show" RENAME CONSTRAINT show_line_id_fkey TO show_section_id_fkey;

-- 6b) Rename triggers.
ALTER TRIGGER line_audit ON public.section RENAME TO section_audit;
ALTER TRIGGER line_guard_creator ON public.section RENAME TO section_guard_creator;
ALTER TRIGGER line_guard_ws ON public.section RENAME TO section_guard_ws;
ALTER TRIGGER line_set_updated_at ON public.section RENAME TO section_set_updated_at;
ALTER TRIGGER line_slug_validate ON public.section RENAME TO section_slug_validate;

-- 7) Rename enum types.
ALTER TYPE public.line_kind RENAME TO section_kind;
ALTER TYPE public.line_status RENAME TO section_status;

-- 8) Recreate helper functions.
CREATE OR REPLACE FUNCTION public.project_id_of_asset_version(p_project_id uuid, p_section_id uuid, p_show_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    p_project_id,
    (SELECT project_id FROM public.section WHERE id = p_section_id),
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
    (SELECT l.project_id FROM public.section l JOIN public.expense e ON e.section_id = l.id WHERE e.id = p_expense_id)
  );
$function$;
REVOKE ALL ON FUNCTION public.project_id_of_expense(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.project_id_of_expense(uuid) TO authenticated;

-- 9) Recreate policies.
CREATE POLICY section_select ON public.section FOR SELECT TO authenticated
USING ((deleted_at IS NULL) AND (has_permission(project_id, 'edit:show'::text) OR has_permission(project_id, 'edit:project_meta'::text)));

CREATE POLICY section_insert ON public.section FOR INSERT TO authenticated
WITH CHECK ((workspace_id = current_workspace_id()) AND (has_permission(project_id, 'edit:show'::text) OR has_permission(project_id, 'edit:project_meta'::text)));

CREATE POLICY section_update ON public.section FOR UPDATE TO authenticated
USING ((deleted_at IS NULL) AND (has_permission(project_id, 'edit:show'::text) OR has_permission(project_id, 'edit:project_meta'::text)))
WITH CHECK (has_permission(project_id, 'edit:show'::text) OR has_permission(project_id, 'edit:project_meta'::text));

CREATE POLICY asset_version_select ON public.asset_version FOR SELECT TO authenticated
USING ((deleted_at IS NULL) AND has_permission(project_id_of_asset_version(project_id, section_id, show_id), 'edit:show'::text));

CREATE POLICY asset_version_insert ON public.asset_version FOR INSERT TO authenticated
WITH CHECK ((workspace_id = current_workspace_id()) AND has_permission(project_id_of_asset_version(project_id, section_id, show_id), 'edit:show'::text));

CREATE POLICY asset_version_update ON public.asset_version FOR UPDATE TO authenticated
USING ((deleted_at IS NULL) AND has_permission(project_id_of_asset_version(project_id, section_id, show_id), 'edit:show'::text))
WITH CHECK (has_permission(project_id_of_asset_version(project_id, section_id, show_id), 'edit:show'::text));

CREATE POLICY asset_version_delete ON public.asset_version FOR DELETE TO authenticated
USING (has_permission(project_id_of_asset_version(project_id, section_id, show_id), 'edit:show'::text));

CREATE POLICY expense_select ON public.expense FOR SELECT TO authenticated
USING ((deleted_at IS NULL) AND has_permission(project_id_of_expense(id), 'read:money'::text));

CREATE POLICY expense_insert ON public.expense FOR INSERT TO authenticated
WITH CHECK ((workspace_id = current_workspace_id()) AND has_permission(
  COALESCE(
    (SELECT s.project_id FROM public.show s WHERE s.id = expense.show_id),
    (SELECT l.project_id FROM public.section l WHERE l.id = expense.section_id)
  ),
  'edit:money'::text
));

CREATE POLICY expense_update ON public.expense FOR UPDATE TO authenticated
USING ((deleted_at IS NULL) AND has_permission(project_id_of_expense(id), 'edit:money'::text))
WITH CHECK (has_permission(
  COALESCE(
    (SELECT s.project_id FROM public.show s WHERE s.id = expense.show_id),
    (SELECT l.project_id FROM public.section l WHERE l.id = expense.section_id)
  ),
  'edit:money'::text
));

-- 10) Recreate the redacted view.
CREATE OR REPLACE VIEW public.show_redacted AS
SELECT id,
    workspace_id,
    project_id,
    section_id,
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

-- 11) Non-transactional follow-up (executed separately via execute_sql):
--     ALTER TYPE public.section_kind ADD VALUE IF NOT EXISTS 'creation';
--     ALTER TYPE public.section_kind ADD VALUE IF NOT EXISTS 'campaign';
--     ALTER TYPE public.section_kind ADD VALUE IF NOT EXISTS 'comms';
--     ALTER TYPE public.section_kind ADD VALUE IF NOT EXISTS 'misc';
-- Post-migration enum order: tour, season, phase, circuit, residency, other,
-- creation, campaign, comms, misc.
