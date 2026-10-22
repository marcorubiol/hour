-- Rollback de 20261022100000_bolo_membership (comms carril 2, fase 1: el equipo de una noche).
-- Devuelve las cuatro políticas (performance_select, venue_select, venue_insert,
-- venue_update) y las cuatro funciones redefinidas (chain_memberships,
-- accept/preview/revoke_workspace_invitation) a su texto vivo del 2026-10-22, y
-- borra lo nuevo: RPC create_bolo_invitation, set_membership_expiry y
-- bolo_access, los ayudantes private.*, la guarda de bolo de la invitación, las
-- columnas de caducidad e invitación de bolo y membership_facet.id con su
-- auditoría.
--
-- Lo que cambia para la gente, y por eso va antes de quitar columnas:
--   · Una membresía de bolo ya caducada volvería a valer al perder sus
--     columnas: se BORRA. Una que aún no ha caducado se queda, sin fecha.
--   · Una invitación de bolo pendiente se volvería una invitación de guest al
--     espacio sin bolo: se REVOCA. Las aceptadas no cambian (ya son membresías).
--   · Un guest que solo tenía un bolo deja de leer sus funciones y su sala por
--     PostgREST (el tablón por RPC lo sigue viendo mientras la membresía viva).
-- Las filas de audit_log de membership_facet se quedan (son historia).
-- Antes de aplicarlo, desplegar un Worker que no llame a las tres RPC nuevas ni
-- lea las columnas nuevas de preview_workspace_invitation.
-- Probado en local dentro de una transacción con ROLLBACK (2026-10-22).

BEGIN;

-- ── personas: lo que resucitaría o cambiaría de sentido ──────────────────
DELETE FROM public.membership m
WHERE m.level = 'bolo'
  AND (m.expires_at IS NOT NULL OR m.expires_with_bolo)
  AND coalesce(private.membership_ends_at(m) <= now(), false);

UPDATE public.workspace_invitation
SET revoked_at = now()
WHERE bolo_id IS NOT NULL AND accepted_at IS NULL AND revoked_at IS NULL;

-- ── políticas (texto vivo de pg_policies, 2026-10-22) ────────────────────
DROP POLICY performance_select ON public.performance;
CREATE POLICY performance_select ON public.performance
  FOR SELECT TO authenticated
  USING ((deleted_at IS NULL) AND has_permission(project_id, 'read:performance'::text));

DROP POLICY venue_select ON public.venue;
CREATE POLICY venue_select ON public.venue
  FOR SELECT TO authenticated
  USING ((deleted_at IS NULL) AND is_workspace_internal_member(workspace_id));

DROP POLICY venue_insert ON public.venue;
CREATE POLICY venue_insert ON public.venue
  FOR INSERT TO authenticated
  WITH CHECK ((workspace_id = current_workspace_id()) AND is_workspace_member(workspace_id));

DROP POLICY venue_update ON public.venue;
CREATE POLICY venue_update ON public.venue
  FOR UPDATE TO authenticated
  USING ((deleted_at IS NULL) AND is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

DROP FUNCTION private.venue_readable_through_chain_by_caller(uuid);
DROP FUNCTION private.reads_venue_through_chain(uuid, uuid);
DROP FUNCTION private.performance_readable_through_chain_by_caller(uuid);
DROP FUNCTION private.reads_performance_through_chain(uuid, uuid);

-- ── RPC nuevas ───────────────────────────────────────────────────────────
DROP FUNCTION public.bolo_access(uuid);
DROP FUNCTION public.set_membership_expiry(uuid, timestamptz);
DROP FUNCTION public.create_bolo_invitation(uuid, text, text, uuid);

-- ── funciones redefinidas: cuerpo vivo del 2026-10-22 ────────────────────
CREATE OR REPLACE FUNCTION private.chain_memberships(p_level container_level, p_id uuid, p_user_id uuid)
 RETURNS SETOF membership
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT m.*
  FROM private.container_chain(p_level, p_id) c
  JOIN public.membership m
    ON m.user_id = p_user_id
   AND m.accepted_at IS NOT NULL
   AND m.level = c.level
   AND CASE c.level
         WHEN 'workspace'   THEN m.workspace_id = c.id
         WHEN 'project'     THEN m.project_id = c.id
         WHEN 'line'        THEN m.line_id = c.id
         WHEN 'bolo'        THEN m.bolo_id = c.id
         WHEN 'performance' THEN m.performance_id = c.id
       END;
$function$;

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

  -- ADR-107: la invitación salió de una ficha. La cuenta pasa a ser esa
  -- persona solo si aún no es ninguna y nadie más la ha reclamado: no se
  -- reescribe el person_id de ninguna fila. Si la cuenta ya es otra persona,
  -- la invitación se acepta igual y el dossier queda sin enlazar.
  IF v_invitation.person_id IS NOT NULL THEN
    UPDATE public.user_profile up
    SET person_id = v_invitation.person_id
    WHERE up.user_id = v_caller
      AND up.person_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.workspace_person wp
        WHERE wp.workspace_id = v_invitation.workspace_id
          AND wp.person_id = v_invitation.person_id
          AND wp.deleted_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.user_profile other
        WHERE other.person_id = v_invitation.person_id
      );
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

DROP FUNCTION public.preview_workspace_invitation(text);
CREATE FUNCTION public.preview_workspace_invitation(p_token text)
 RETURNS TABLE(workspace_id uuid, workspace_slug text, workspace_name text, email text, role membership_role, project_id uuid, project_name text, project_role_code text, expires_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT wi.workspace_id,
         w.slug,
         w.name,
         wi.email::text,
         wi.role,
         wi.project_id,
         p.name,
         wi.project_role_code,
         wi.expires_at
  FROM public.workspace_invitation wi
  JOIN public.workspace w ON w.id = wi.workspace_id AND w.deleted_at IS NULL
  LEFT JOIN public.project p ON p.id = wi.project_id AND p.deleted_at IS NULL
  JOIN auth.users au
    ON au.id = (SELECT auth.uid())
   AND au.email_confirmed_at IS NOT NULL
   AND lower(au.email::text) = lower(wi.email::text)
  WHERE wi.token_hash = encode(digest(p_token, 'sha256'), 'hex')
    AND wi.accepted_at IS NULL
    AND wi.revoked_at IS NULL
    AND wi.expires_at > now();
$function$;
REVOKE ALL ON FUNCTION public.preview_workspace_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_workspace_invitation(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_workspace_invitation(p_invitation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_workspace_id uuid;
BEGIN
  SELECT workspace_id INTO v_workspace_id
  FROM public.workspace_invitation
  WHERE id = p_invitation_id AND accepted_at IS NULL;
  IF v_workspace_id IS NULL OR NOT public.is_workspace_admin(v_workspace_id) THEN
    RAISE EXCEPTION 'invitation not found' USING ERRCODE = '42501';
  END IF;
  UPDATE public.workspace_invitation SET revoked_at = now()
  WHERE id = p_invitation_id AND revoked_at IS NULL;
END;
$function$;

-- ── invitación de bolo ───────────────────────────────────────────────────
DROP TRIGGER workspace_invitation_guard_bolo ON public.workspace_invitation;
DROP FUNCTION private.guard_workspace_invitation_bolo();
ALTER TABLE public.workspace_invitation
  DROP CONSTRAINT workspace_invitation_bolo_shape,
  DROP COLUMN bolo_preset,
  DROP COLUMN bolo_id;

-- ── caducidad ────────────────────────────────────────────────────────────
DROP FUNCTION private.membership_ends_at(public.membership);
DROP FUNCTION private.bolo_access_ends_at(uuid);
ALTER TABLE public.membership
  DROP CONSTRAINT membership_expiry_on_bolo,
  DROP COLUMN expires_with_bolo,
  DROP COLUMN expires_at;

-- ── membership_facet.id y su auditoría ───────────────────────────────────
DROP TRIGGER membership_facet_audit ON public.membership_facet;
DROP FUNCTION private.audit_membership_facet();
ALTER TABLE public.membership_facet
  DROP CONSTRAINT membership_facet_id_key,
  DROP COLUMN id;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261022100000';

COMMIT;
