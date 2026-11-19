-- Rollback de 20261119140000_directory_select_once: las dos políticas y las
-- dos funciones `*_readable_by_caller` vuelven a su cuerpo de
-- 20261018100000_directory_privacy (el vivo hasta el 19-11, leído con
-- pg_get_functiondef), y se borran las seis funciones nuevas. Sin datos.

BEGIN;

ALTER POLICY workspace_person_select ON public.workspace_person
  USING (deleted_at IS NULL
         AND private.workspace_person_readable_by_caller(workspace_id, person_id));

ALTER POLICY workspace_organization_select ON public.workspace_organization
  USING (deleted_at IS NULL
         AND private.workspace_organization_readable_by_caller(workspace_id, id));

CREATE OR REPLACE FUNCTION private.workspace_person_readable_by_caller(p_workspace_id uuid, p_person_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH me AS (SELECT auth.uid() AS p_user_id)
  SELECT private.model_has_workspace_role(p_workspace_id, p_user_id,
                                          ARRAY['owner', 'admin', 'member', 'viewer']::public.membership_role[])
    AND (
      private.person_is_team(p_workspace_id, p_person_id)
      OR (
        private.reads_conversations_in(p_workspace_id, p_user_id)
        AND NOT private.person_only_in_foreign_private(p_workspace_id, p_person_id, p_user_id)
      )
    )
  FROM me;
$$;

CREATE OR REPLACE FUNCTION private.workspace_organization_readable_by_caller(p_workspace_id uuid, p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH me AS (SELECT auth.uid() AS p_user_id)
  SELECT private.model_has_workspace_role(p_workspace_id, p_user_id,
                                          ARRAY['owner', 'admin', 'member', 'viewer']::public.membership_role[])
    AND (
      EXISTS (
        SELECT 1 FROM public.workspace_person wp
        WHERE wp.workspace_id = p_workspace_id AND wp.organization_id = p_organization_id
          AND wp.deleted_at IS NULL
          AND private.person_is_team(p_workspace_id, wp.person_id)
      )
      OR EXISTS (
        SELECT 1 FROM public.invoice i
        WHERE i.workspace_id = p_workspace_id AND i.payer_organization_id = p_organization_id
          AND i.deleted_at IS NULL
          AND private.model_has_permission(i.project_id, 'read:money', p_user_id)
      )
      OR (
        private.reads_conversations_in(p_workspace_id, p_user_id)
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
      )
    )
  FROM me;
$$;

DROP FUNCTION private.caller_conversation_workspaces();
DROP FUNCTION private.caller_member_workspaces();
DROP FUNCTION private.person_team_for_caller(uuid, uuid);
DROP FUNCTION private.person_open_for_caller(uuid, uuid);
DROP FUNCTION private.organization_supported_for_caller(uuid, uuid);
DROP FUNCTION private.organization_open_for_caller(uuid, uuid);

COMMIT;
