-- ROLLBACK for 20261014200000_create_workspace_person.sql (ADR-107)
--
-- What it undoes: create_workspace_person, update_workspace_person,
-- invite_workspace_person, private.can_write_workspace_person, the column
-- workspace_invitation.person_id (with its FK and index), and it puts back
-- accept_workspace_invitation as 20261013300000 left it.
--
-- What it does not undo, on purpose: the dossiers created in between (people
-- of the team, already cast or with notes) and the user_profile.person_id
-- links that acceptances made. Both are ordinary data the rest of the schema
-- already knew how to hold before this migration.
--
-- Symptom that would call for it: none of the deployed code depends on it
-- until a Worker that offers «Añadir» or «Invitar a X» is live. If it is, roll
-- the Worker back first.

BEGIN;

DROP FUNCTION IF EXISTS public.invite_workspace_person(uuid, uuid, text, public.membership_role);
DROP FUNCTION IF EXISTS public.update_workspace_person(uuid, uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.create_workspace_person(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS private.can_write_workspace_person(uuid);

DROP INDEX IF EXISTS public.workspace_invitation_person_idx;
ALTER TABLE public.workspace_invitation DROP CONSTRAINT IF EXISTS workspace_invitation_workspace_person_fkey;
ALTER TABLE public.workspace_invitation DROP COLUMN IF EXISTS person_id;

-- accept_workspace_invitation as in 20261013300000_permissions_facets_contract.sql
CREATE OR REPLACE FUNCTION public.accept_workspace_invitation(p_token text)
 RETURNS TABLE(workspace_id uuid, workspace_slug text, workspace_name text, role membership_role)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_invitation public.workspace_invitation%ROWTYPE;
  v_workspace public.workspace%ROWTYPE;
  v_accepted timestamptz;
  v_project_membership uuid;
BEGIN
  SELECT wi.* INTO v_invitation
  FROM public.workspace_invitation wi
  JOIN auth.users au
    ON au.id = v_caller
   AND au.email_confirmed_at IS NOT NULL
   AND lower(au.email::text) = lower(wi.email::text)
  WHERE wi.token_hash = encode(digest(p_token, 'sha256'), 'hex')
    AND wi.accepted_at IS NULL
    AND wi.revoked_at IS NULL
    AND wi.expires_at > now()
  FOR UPDATE;

  IF v_invitation.id IS NULL THEN
    RAISE EXCEPTION 'invitation unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_workspace
  FROM public.workspace w
  WHERE w.id = v_invitation.workspace_id AND w.deleted_at IS NULL;
  IF v_workspace.id IS NULL THEN
    RAISE EXCEPTION 'invitation unavailable' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.membership AS m (
    workspace_id, level, user_id, workspace_role, accepted_at, invited_by
  ) VALUES (
    v_invitation.workspace_id, 'workspace', v_caller, v_invitation.role, now(),
    v_invitation.invited_by
  )
  ON CONFLICT (workspace_id, user_id) WHERE level = 'workspace' DO UPDATE
  SET workspace_role = CASE
        WHEN m.accepted_at IS NULL THEN EXCLUDED.workspace_role
        ELSE m.workspace_role
      END,
      accepted_at = coalesce(m.accepted_at, EXCLUDED.accepted_at),
      invited_by = coalesce(m.invited_by, EXCLUDED.invited_by)
  RETURNING m.accepted_at INTO v_accepted;

  UPDATE public.membership m
  SET accepted_at = v_accepted
  WHERE m.workspace_id = v_invitation.workspace_id
    AND m.user_id = v_caller
    AND m.level <> 'workspace'
    AND m.accepted_at IS NULL;

  IF v_invitation.project_id IS NOT NULL THEN
    SELECT m.id INTO v_project_membership
    FROM public.membership m
    WHERE m.level = 'project' AND m.project_id = v_invitation.project_id AND m.user_id = v_caller;

    IF v_project_membership IS NULL THEN
      INSERT INTO public.membership (
        workspace_id, level, project_id, user_id, roles, container_verb, accepted_at, invited_by
      ) VALUES (
        v_invitation.workspace_id, 'project', v_invitation.project_id, v_caller,
        ARRAY[v_invitation.project_role_code]::text[],
        (SELECT ap.container_verb FROM public.access_preset ap
         WHERE ap.key = coalesce(v_invitation.project_preset, 'minim')),
        v_accepted, v_invitation.invited_by
      )
      RETURNING id INTO v_project_membership;
      PERFORM private.expand_preset(v_project_membership,
                                    coalesce(v_invitation.project_preset, 'minim'),
                                    v_invitation.invited_by);
    ELSE
      UPDATE public.membership m
      SET roles = (
            SELECT array_agg(DISTINCT role_code ORDER BY role_code)
            FROM unnest(m.roles || ARRAY[v_invitation.project_role_code]::text[]) AS role_code
          )
      WHERE m.id = v_project_membership;
    END IF;
  END IF;

  UPDATE public.workspace_invitation
  SET accepted_at = now(), accepted_by = v_caller
  WHERE id = v_invitation.id;

  RETURN QUERY SELECT
    v_workspace.id,
    v_workspace.slug,
    v_workspace.name,
    (
      SELECT m.workspace_role
      FROM public.membership m
      WHERE m.level = 'workspace' AND m.workspace_id = v_workspace.id AND m.user_id = v_caller
    );
END;
$function$;

COMMIT;
