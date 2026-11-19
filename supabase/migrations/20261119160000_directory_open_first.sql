-- Directory reads: the cheap «open» test first (19-11-2026, carga lenta).
--
-- Hoy reads every conversation with its organization and contacts
-- (`/api/conversations?lean=1`). Measured as a real member, 152 rows took
-- about 2 s, and 1.2 s of it was the organization embed: 8 ms per row in
-- the `workspace_organization_select` policy. The policy asked
-- `organization_supported_for_caller` first, which looks for a team member
-- or a readable invoice of that organization (`person_is_team` per person,
-- `model_has_permission` per invoice) and is false for almost every venue.
-- Only then did it ask `organization_open_for_caller`.
--
-- Two changes, same answers:
--
-- 1. `organization_open_for_caller` and `person_open_for_caller` start with
--    one index lookup: a conversation the caller can see (not private to
--    someone else) that names this organization, or that has this person as
--    a contact. When there is one the long test is true anyway, because it
--    only refuses records that live solely in someone else's private
--    conversations. Written as `fast OR (the old test)`, so the result is the
--    old one in every case.
--
-- 2. The two policies ask the open branch first and the team/supported
--    branch second. An OR is the same in either order.
--
-- Rollback: build/runbooks/rollback-20261119-directory-open-first.sql

CREATE OR REPLACE FUNCTION private.organization_open_for_caller(p_workspace_id uuid, p_organization_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH me AS (SELECT auth.uid() AS p_user_id)
  SELECT private.model_has_workspace_role(p_workspace_id, p_user_id,
                                          ARRAY['owner', 'admin', 'member', 'viewer']::public.membership_role[])
    AND (
      -- Fast path: a conversation the caller can see names it.
      EXISTS (
        SELECT 1 FROM public.conversation c
        WHERE c.workspace_id = p_workspace_id AND c.organization_id = p_organization_id
          AND (c.private_to IS NULL OR c.private_to = p_user_id)
      )
      OR NOT (
        (
          EXISTS (
            SELECT 1 FROM public.conversation c
            WHERE c.workspace_id = p_workspace_id AND c.organization_id = p_organization_id
              AND c.private_to IS NOT NULL AND c.private_to IS DISTINCT FROM p_user_id
          )
          OR EXISTS (
            SELECT 1 FROM public.workspace_person wp
            WHERE wp.workspace_id = p_workspace_id AND wp.organization_id = p_organization_id
              AND wp.deleted_at IS NULL
              AND private.person_only_in_foreign_private(p_workspace_id, wp.person_id, p_user_id)
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.conversation c
          WHERE c.workspace_id = p_workspace_id AND c.organization_id = p_organization_id
            AND (c.private_to IS NULL OR c.private_to = p_user_id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.workspace_person wp
          WHERE wp.workspace_id = p_workspace_id AND wp.organization_id = p_organization_id
            AND wp.deleted_at IS NULL
            AND NOT private.person_only_in_foreign_private(p_workspace_id, wp.person_id, p_user_id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.invoice i
          WHERE i.workspace_id = p_workspace_id AND i.payer_organization_id = p_organization_id
            AND i.deleted_at IS NULL
        )
      )
    )
  FROM me;
$function$;

CREATE OR REPLACE FUNCTION private.person_open_for_caller(p_workspace_id uuid, p_person_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT private.model_has_workspace_role(p_workspace_id, auth.uid(),
                                          ARRAY['owner', 'admin', 'member', 'viewer']::public.membership_role[])
    AND (
      -- Fast path: a contact of a conversation the caller can see.
      EXISTS (
        SELECT 1
        FROM public.conversation_contact cc
        JOIN public.conversation c ON c.id = cc.conversation_id
        WHERE cc.workspace_id = p_workspace_id AND cc.person_id = p_person_id
          AND (c.private_to IS NULL OR c.private_to = auth.uid())
      )
      OR NOT private.person_only_in_foreign_private(p_workspace_id, p_person_id, auth.uid())
    );
$function$;

ALTER POLICY workspace_organization_select ON public.workspace_organization USING (
  deleted_at IS NULL
  AND workspace_id = ANY (((SELECT private.caller_member_workspaces()))::uuid[])
  AND (
    ( workspace_id = ANY (((SELECT private.caller_conversation_workspaces()))::uuid[])
      AND private.organization_open_for_caller(workspace_id, id) )
    OR private.organization_supported_for_caller(workspace_id, id)
  )
);

ALTER POLICY workspace_person_select ON public.workspace_person USING (
  deleted_at IS NULL
  AND workspace_id = ANY (((SELECT private.caller_member_workspaces()))::uuid[])
  AND (
    ( workspace_id = ANY (((SELECT private.caller_conversation_workspaces()))::uuid[])
      AND private.person_open_for_caller(workspace_id, person_id) )
    OR private.person_team_for_caller(workspace_id, person_id)
  )
);
