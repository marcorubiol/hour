-- ADR-042 follow-up: people on the call sheet (crew_assignment,
-- cast_member, cast_override incl. the replaced person) of any workspace
-- the caller belongs to are visible — same accepted-membership rule as
-- the existing engagement clause. Fixes cast/crew rendering as em-dashes
-- for members who neither created the person nor share an engagement
-- (found while building the road sheet, _notes/_flux.md 2026-07-02 §1).
--
-- Applied 2026-07-02 via Supabase MCP apply_migration
-- (name: extend_can_see_person_call_sheet). Verified after applying:
-- demo cast person still invisible to a non-member (cross-tenant intact)
-- + full RLS suite 17/17.

CREATE OR REPLACE FUNCTION public.can_see_person(p_person_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.person WHERE id = p_person_id AND created_by = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.engagement e
    JOIN public.workspace_membership m ON m.workspace_id = e.workspace_id
    WHERE e.person_id = p_person_id AND e.deleted_at IS NULL
      AND m.user_id = auth.uid() AND m.accepted_at IS NOT NULL
  )
  OR EXISTS (
    SELECT 1 FROM public.crew_assignment c
    JOIN public.workspace_membership m ON m.workspace_id = c.workspace_id
    WHERE c.person_id = p_person_id AND c.deleted_at IS NULL
      AND m.user_id = auth.uid() AND m.accepted_at IS NOT NULL
  )
  OR EXISTS (
    SELECT 1 FROM public.cast_member cm
    JOIN public.workspace_membership m ON m.workspace_id = cm.workspace_id
    WHERE cm.person_id = p_person_id AND cm.deleted_at IS NULL
      AND m.user_id = auth.uid() AND m.accepted_at IS NOT NULL
  )
  OR EXISTS (
    SELECT 1 FROM public.cast_override co
    JOIN public.workspace_membership m ON m.workspace_id = co.workspace_id
    WHERE (co.person_id = p_person_id OR co.replaces_person_id = p_person_id)
      AND co.deleted_at IS NULL
      AND m.user_id = auth.uid() AND m.accepted_at IS NOT NULL
  );
$function$;
