-- Rollback of 20261119160000_directory_open_first: the open tests without
-- the fast path, and the policies asking team/supported first (as left by
-- 20261119140000_directory_select_once).

CREATE OR REPLACE FUNCTION private.organization_open_for_caller(p_workspace_id uuid, p_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH me AS (SELECT auth.uid() AS p_user_id)
  SELECT private.model_has_workspace_role(p_workspace_id, p_user_id,
                                          ARRAY['owner', 'admin', 'member', 'viewer']::public.membership_role[])
    AND NOT (
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
    AND NOT private.person_only_in_foreign_private(p_workspace_id, p_person_id, auth.uid());
$function$;

ALTER POLICY workspace_organization_select ON public.workspace_organization USING (
  deleted_at IS NULL
  AND workspace_id = ANY (((SELECT private.caller_member_workspaces()))::uuid[])
  AND ( private.organization_supported_for_caller(workspace_id, id)
    OR ( workspace_id = ANY (((SELECT private.caller_conversation_workspaces()))::uuid[])
         AND private.organization_open_for_caller(workspace_id, id) ) )
);

ALTER POLICY workspace_person_select ON public.workspace_person USING (
  deleted_at IS NULL
  AND workspace_id = ANY (((SELECT private.caller_member_workspaces()))::uuid[])
  AND ( private.person_team_for_caller(workspace_id, person_id)
    OR ( workspace_id = ANY (((SELECT private.caller_conversation_workspaces()))::uuid[])
         AND private.person_open_for_caller(workspace_id, person_id) ) )
);
