-- Rollback for 20261120230000_perf_rpcs_and_rls.sql

DROP INDEX IF EXISTS public.bolo_city_trgm_idx;
DROP INDEX IF EXISTS public.bolo_venue_name_trgm_idx;
DROP INDEX IF EXISTS public.performance_city_trgm_idx;
DROP INDEX IF EXISTS public.performance_venue_name_trgm_idx;
DROP INDEX IF EXISTS public.venue_city_trgm_idx;
DROP INDEX IF EXISTS public.venue_name_trgm_idx;
DROP INDEX IF EXISTS public.workspace_organization_name_trgm_idx;
DROP INDEX IF EXISTS public.workspace_person_email_trgm_idx;
DROP INDEX IF EXISTS public.workspace_person_full_name_trgm_idx;
DROP INDEX IF EXISTS public.conversation_event_last_in_idx;
DROP INDEX IF EXISTS public.conversation_event_last_turn_idx;

ALTER POLICY mailout_select ON public.mailout
  USING (
    CASE kind
      WHEN 'outreach' THEN public.has_permission(project_id, 'read:conversation')
                           AND private.mailout_readable_by_caller(id, created_by)
      ELSE private.invitation_readable_by_caller(id, workspace_id, created_by)
    END
  );

DROP FUNCTION IF EXISTS public.list_roadsheet_share_counts(uuid[]);
DROP FUNCTION IF EXISTS public.money_access_any();

CREATE OR REPLACE FUNCTION public.accessible_project_ids(p_perm text)
RETURNS uuid[]
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  SELECT coalesce(array_agg(p.id), '{}'::uuid[])
  FROM public.project p
  WHERE p.deleted_at IS NULL
    AND public.has_permission(p.id, p_perm);
$$;
