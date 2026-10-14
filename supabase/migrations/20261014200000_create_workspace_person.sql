-- ADR-107 · Dar de alta a alguien del equipo sin conversación.
--
-- Hasta hoy una persona solo nacía de una conversación de difusión
-- (`create_conversation`, `add_conversation_contact`) o al compartir el perfil
-- (`share_my_profile_with_workspace`). Aquí:
--   1. `private.can_write_workspace_person`: quién escribe un dossier.
--   2. `create_workspace_person`: persona global anónima + dossier local, con el
--      patrón de `add_conversation_contact`; deduplica por email en el espacio.
--   3. `update_workspace_person`: nombre, email, teléfono y cargo desde la ficha.
--   4. `workspace_invitation.person_id` + `invite_workspace_person`: la
--      invitación sale de la ficha y nombra ese dossier.
--   5. `accept_workspace_invitation`: al aceptar, enlaza ESE dossier con la
--      cuenta (`user_profile.person_id`) si la cuenta aún no tiene persona. No
--      reescribe el `person_id` de ninguna fila ni copia el perfil (compartir
--      sigue siendo un acto aparte).
--
-- Aditiva: columna nueva con NULL, funciones nuevas y un CREATE OR REPLACE de
-- `accept_workspace_invitation` con la misma firma. El Worker desplegado no se
-- entera. Rollback: build/runbooks/rollback-20261014-create-workspace-person.sql

-- ── 1 · Quién escribe un dossier ────────────────────────────────────────────
-- Los miembros internos que escriben (owner, admin, member: lo mismo que las
-- políticas workspace_person_insert/update), o quien edita el reparto de algún
-- proyecto vivo del espacio (`edit:performance`), que es quien ve el selector.
CREATE FUNCTION private.can_write_workspace_person(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND (
    private.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']::public.membership_role[])
    OR EXISTS (
      SELECT 1 FROM public.project p
      WHERE p.workspace_id = p_workspace_id
        AND p.deleted_at IS NULL
        AND public.has_permission(p.id, 'edit:performance')
    )
  );
$$;
REVOKE ALL ON FUNCTION private.can_write_workspace_person(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ── 2 · create_workspace_person ─────────────────────────────────────────────
CREATE FUNCTION public.create_workspace_person(
  p_workspace_id uuid,
  p_full_name    text,
  p_email        text DEFAULT NULL,
  p_phone        text DEFAULT NULL,
  p_title        text DEFAULT NULL
) RETURNS public.workspace_person
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_caller    uuid := auth.uid();
  v_full_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_email     extensions.citext := nullif(btrim(coalesce(p_email, '')), '')::extensions.citext;
  v_phone     text := nullif(btrim(coalesce(p_phone, '')), '');
  v_title     text := nullif(btrim(coalesce(p_title, '')), '');
  v_person_id uuid;
  v_slug      text;
  v_row       public.workspace_person;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT private.can_write_workspace_person(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace % not found', p_workspace_id USING ERRCODE = '42501';
  END IF;
  IF v_full_name IS NULL OR length(v_full_name) > 200 THEN
    RAISE EXCEPTION 'full_name is required' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND v_email::text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'email is not valid' USING ERRCODE = '22023';
  END IF;
  IF length(v_phone) > 60 OR length(v_title) > 200 THEN
    RAISE EXCEPTION 'phone or title is too long' USING ERRCODE = '22023';
  END IF;

  -- Mismo email en el espacio: es la misma persona; se devuelve su dossier.
  IF v_email IS NOT NULL THEN
    SELECT wp.* INTO v_row
    FROM public.workspace_person wp
    WHERE wp.workspace_id = p_workspace_id AND wp.email = v_email AND wp.deleted_at IS NULL
    ORDER BY wp.created_at, wp.person_id
    LIMIT 1;
    IF v_row.person_id IS NOT NULL THEN
      RETURN v_row;
    END IF;
  END IF;

  v_person_id := public.uuid_generate_v7();
  INSERT INTO public.person (id, slug, full_name, email, created_by)
  VALUES (
    v_person_id,
    'person-' || right(replace(v_person_id::text, '-', ''), 12),
    'Person ' || right(replace(v_person_id::text, '-', ''), 8),
    NULL,
    v_caller
  );
  v_slug := coalesce(nullif(rtrim(left(public.slugify(v_full_name), 63), '-'), ''), 'person');
  IF EXISTS (
    SELECT 1 FROM public.workspace_person wp
    WHERE wp.workspace_id = p_workspace_id AND wp.slug = v_slug AND wp.deleted_at IS NULL
  ) THEN
    v_slug := rtrim(left(v_slug, 56), '-') || '-' || right(replace(v_person_id::text, '-', ''), 6);
  END IF;
  INSERT INTO public.workspace_person (
    workspace_id, person_id, slug, full_name, email, phone, title, created_by
  ) VALUES (
    p_workspace_id, v_person_id, v_slug, v_full_name, v_email, v_phone, v_title, v_caller
  )
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

COMMENT ON FUNCTION public.create_workspace_person(uuid, text, text, text, text) IS
  'ADR-107: a team member without a conversation. Anonymous global person + local dossier (add_conversation_contact pattern). Same email in the workspace returns the existing dossier. Gate: private.can_write_workspace_person.';
REVOKE ALL ON FUNCTION public.create_workspace_person(uuid, text, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_workspace_person(uuid, text, text, text, text) TO authenticated;

-- ── 3 · update_workspace_person ─────────────────────────────────────────────
-- Lo que la ficha deja cambiar después del alta. El slug no cambia: es la URL.
-- Todos los campos llegan siempre: NULL o vacío borra (salvo el nombre).
CREATE FUNCTION public.update_workspace_person(
  p_workspace_id uuid,
  p_person_id    uuid,
  p_full_name    text,
  p_email        text DEFAULT NULL,
  p_phone        text DEFAULT NULL,
  p_title        text DEFAULT NULL
) RETURNS public.workspace_person
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_full_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_email     extensions.citext := nullif(btrim(coalesce(p_email, '')), '')::extensions.citext;
  v_phone     text := nullif(btrim(coalesce(p_phone, '')), '');
  v_title     text := nullif(btrim(coalesce(p_title, '')), '');
  v_row       public.workspace_person;
BEGIN
  IF auth.uid() IS NULL OR NOT private.can_write_workspace_person(p_workspace_id) THEN
    RAISE EXCEPTION 'person not found' USING ERRCODE = '42501';
  END IF;
  IF v_full_name IS NULL OR length(v_full_name) > 200 THEN
    RAISE EXCEPTION 'full_name is required' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND v_email::text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'email is not valid' USING ERRCODE = '22023';
  END IF;
  IF length(v_phone) > 60 OR length(v_title) > 200 THEN
    RAISE EXCEPTION 'phone or title is too long' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workspace_person wp
    WHERE wp.workspace_id = p_workspace_id AND wp.email = v_email
      AND wp.person_id <> p_person_id AND wp.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'another person in this workspace has that email' USING ERRCODE = '23505';
  END IF;

  UPDATE public.workspace_person wp
  SET full_name = v_full_name, email = v_email, phone = v_phone, title = v_title
  WHERE wp.workspace_id = p_workspace_id AND wp.person_id = p_person_id AND wp.deleted_at IS NULL
  RETURNING * INTO v_row;
  IF v_row.person_id IS NULL THEN
    RAISE EXCEPTION 'person not found' USING ERRCODE = '42501';
  END IF;
  RETURN v_row;
END;
$function$;

COMMENT ON FUNCTION public.update_workspace_person(uuid, uuid, text, text, text, text) IS
  'ADR-107: edit a dossier''s name, email, phone and title from its file. Same gate as create_workspace_person; an email another dossier of the workspace holds is 23505.';
REVOKE ALL ON FUNCTION public.update_workspace_person(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_workspace_person(uuid, uuid, text, text, text, text) TO authenticated;

-- ── 4 · La invitación nombra un dossier ─────────────────────────────────────
ALTER TABLE public.workspace_invitation ADD COLUMN person_id uuid;
ALTER TABLE public.workspace_invitation
  ADD CONSTRAINT workspace_invitation_workspace_person_fkey
  FOREIGN KEY (workspace_id, person_id)
  REFERENCES public.workspace_person (workspace_id, person_id)
  ON DELETE SET NULL (person_id);
CREATE INDEX workspace_invitation_person_idx
  ON public.workspace_invitation (workspace_id, person_id) WHERE person_id IS NOT NULL;
COMMENT ON COLUMN public.workspace_invitation.person_id IS
  'ADR-107: the dossier this invitation was sent from. On acceptance the account is linked to it (user_profile.person_id) when the account has no person yet.';

CREATE FUNCTION public.invite_workspace_person(
  p_workspace_id uuid,
  p_person_id    uuid,
  p_email        text,
  p_role         public.membership_role DEFAULT 'member'::public.membership_role
)
 RETURNS TABLE(id uuid, email text, role membership_role, project_id uuid, project_role_code text, expires_at timestamp with time zone, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_email  extensions.citext := nullif(btrim(coalesce(p_email, '')), '')::extensions.citext;
  v_wp     public.workspace_person;
  v_inv    record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_workspace_admin(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace admin required' USING ERRCODE = '42501';
  END IF;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'valid email required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_wp FROM public.workspace_person wp
  WHERE wp.workspace_id = p_workspace_id AND wp.person_id = p_person_id AND wp.deleted_at IS NULL
  FOR UPDATE;
  IF v_wp.person_id IS NULL THEN
    RAISE EXCEPTION 'person not found' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_profile up WHERE up.person_id = p_person_id) THEN
    RAISE EXCEPTION 'this person already has an account' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workspace_person wp
    WHERE wp.workspace_id = p_workspace_id AND wp.email = v_email
      AND wp.person_id <> p_person_id AND wp.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'another person in this workspace has that email' USING ERRCODE = '23505';
  END IF;

  -- create_workspace_invitation valida el email, el papel y revoca la anterior.
  SELECT * INTO v_inv
  FROM public.create_workspace_invitation(p_workspace_id, v_email::text, p_role);

  UPDATE public.workspace_invitation wi SET person_id = p_person_id WHERE wi.id = v_inv.id;

  -- El dossier sin email se queda el de la invitación.
  UPDATE public.workspace_person wp SET email = v_email
  WHERE wp.workspace_id = p_workspace_id AND wp.person_id = p_person_id AND wp.email IS NULL;

  RETURN QUERY SELECT v_inv.id, v_inv.email, v_inv.role, v_inv.project_id,
                      v_inv.project_role_code, v_inv.expires_at, v_inv.token;
END;
$function$;

COMMENT ON FUNCTION public.invite_workspace_person(uuid, uuid, text, public.membership_role) IS
  'ADR-107: invite to Hour from a person''s file. Admin only (create_workspace_invitation does the rest). The invitation carries the dossier, and acceptance links the account to it.';
REVOKE ALL ON FUNCTION public.invite_workspace_person(uuid, uuid, text, public.membership_role) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.invite_workspace_person(uuid, uuid, text, public.membership_role) TO authenticated;

-- ── 5 · Aceptar enlaza el dossier ───────────────────────────────────────────
-- Igual que en 20261013300000 más el último paso antes de marcarla aceptada.
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
