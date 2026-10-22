-- Comms, carril 2, fase 1: el equipo de una noche (solo esquema).
--
-- Plan: `build/plans/2026-10-22-comms-threads-facets.md` § 2 (a), § 4, § 5 y
-- § 6 fase 1, con las cuatro recomendadas de § 7 que Marco aprobó el 22-10:
-- invitación al bolo con paquete; la membresía de bolo deja leer la ficha de
-- sus funciones, sin dinero; la invitación caduca sola el día después de la
-- última función, ampliable a mano.
--
--   1. `membership.expires_at` y `membership.expires_with_bolo`: solo en el
--      nivel bolo. Con `expires_with_bolo`, la membresía deja de valer al
--      acabar el día siguiente a la última función viva del bolo (en la zona
--      del espacio), calculado cada vez: si el bolo se mueve, el acceso se
--      mueve con él. Sin funciones vivas, no caduca. `expires_at` es la fecha
--      a mano (ampliar o acortar), y entonces no sigue al bolo.
--   2. `private.chain_memberships` deja fuera lo caducado. Es el embudo de
--      toda lectura por la cadena (container_verb, facetas, techo del
--      delegante, hilos, tablón, audiencia): una membresía caducada no da
--      nada, sin tocar ninguna otra función.
--   3. `workspace_invitation.bolo_id` y `bolo_preset` (Mínim o Equip). Una
--      invitación de bolo no lleva proyecto, deja rol `guest` en el espacio y
--      su paquete es de bolo.
--   4. RPC `create_bolo_invitation`: la crea quien puede dar ese paquete en
--      ese bolo (techo del delegante, ADR-085 § 10, ADR-104), no solo el
--      admin. `accept_workspace_invitation` crea la membresía de bolo y
--      vuelve a comprobar el techo de quien invitó; `preview_workspace_invitation`
--      dice el bolo y la función donde aterrizar; `revoke_workspace_invitation`
--      deja revocar una de bolo a quien podría haberla dado.
--   5. RPC `set_membership_expiry` (ampliar a mano) y `bolo_access` (quién
--      está en el bolo, qué invitaciones esperan y qué puede dar quien llama),
--      para la pantalla de la fase 2.
--   6. `performance_select` pasa a leer también por la cadena (línea, bolo,
--      función): ADR-100 § 1. La función no lleva dinero (ADR-087) y
--      `performance.bolo_id` sigue fuera del grant por columnas.
--   7. `venue_select`: además, la sala de una función que se lee por la
--      cadena; nunca el directorio entero (ADR-124). `venue_insert` y
--      `venue_update` pasan de `is_workspace_member` a
--      `is_workspace_internal_member`: desde ahora un no admin puede dejar un
--      `guest` en el espacio, y el guest que lee la sala de su bolo no la
--      edita. Hoy no hay ningún guest en producción (SELECT 2026-10-22).
--   8. `membership_facet.id` y su auditoría (deuda de `_tasks.md`).
--
-- Funciones existentes que se redefinen, con firma y cuerpo copiados de la
-- base viva con `pg_get_functiondef` el 2026-10-22 (regla de `_context.md`):
--   · private.chain_memberships(container_level, uuid, uuid): + caducidad.
--   · public.accept_workspace_invitation(text): + rama de bolo.
--   · public.revoke_workspace_invitation(uuid): + quien podría darla.
--   · public.preview_workspace_invitation(text): cambia lo que devuelve
--     (+ bolo_id, bolo_label, landing_performance_id), así que DROP y CREATE
--     con la misma firma de entrada; el Worker la llama por nombre y pasa la
--     fila tal cual (`api/invitations`), las columnas nuevas no le estorban.
-- Políticas que cambian, con el texto vivo de `pg_policies`: performance_select,
-- venue_select, venue_insert, venue_update.
-- Funciones que se llaman sin redefinir: private.container_chain,
-- private.model_container_verb_at, private.can_grant_preset,
-- private.can_manage_membership, private.expand_preset,
-- private.model_has_workspace_role, public.has_permission,
-- public.has_permission_for_user, public.is_workspace_internal_member.
--
-- Gate § 34: aditiva salvo cuatro políticas: dos amplían una lectura y dos
-- estrechan una escritura que hoy nadie usa. Los pasos 0 y 10 hacen la foto de
-- cuántas funciones y salas lee cada membresía de cada espacio real antes y
-- después, y abortan si cambia. Staging recomendado. El Worker desplegado no
-- lee nada nuevo.
-- Rollback: build/runbooks/rollback-20261022100000-bolo-membership.sql.

-- ── 0 · foto de antes ────────────────────────────────────────────────────
-- `playwright` queda fuera: sus fixtures cambian de membresía en cada pasada
-- de la suite, y no hay datos de nadie.
CREATE TEMP TABLE bolo_membership_access_before ON COMMIT DROP AS
SELECT m.id AS membership_id,
       (SELECT count(*)
        FROM public.performance p
        WHERE p.workspace_id = w.id
          AND p.deleted_at IS NULL
          AND public.has_permission_for_user(p.project_id, 'read:performance', m.user_id)) AS performances,
       (SELECT count(*)
        FROM public.venue v
        WHERE v.workspace_id = w.id
          AND v.deleted_at IS NULL
          AND private.model_has_workspace_role(v.workspace_id, m.user_id,
                ARRAY['owner', 'admin', 'member', 'viewer']::public.membership_role[])) AS venues
FROM public.membership m
JOIN public.workspace w ON w.id = m.workspace_id
WHERE w.slug <> 'playwright';

-- ── 1 · caducidad de la membresía de bolo ────────────────────────────────
ALTER TABLE public.membership
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN expires_with_bolo boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT membership_expiry_on_bolo CHECK (
    (expires_at IS NULL AND NOT expires_with_bolo)
    OR (level = 'bolo' AND NOT (expires_with_bolo AND expires_at IS NOT NULL))
  );
COMMENT ON COLUMN public.membership.expires_at IS
  'Solo nivel bolo. Fecha a mano en la que la membresía deja de valer (ampliar o acortar, set_membership_expiry). NULL = sin fecha a mano.';
COMMENT ON COLUMN public.membership.expires_with_bolo IS
  'Solo nivel bolo. true = deja de valer al acabar el día siguiente a la última función viva del bolo, en la zona del espacio (private.bolo_access_ends_at), calculado cada vez. Lo pone la invitación de bolo (plan 2026-10-22 § 7.4).';

-- El final del acceso de una invitación de bolo: el principio del segundo día
-- tras la última función viva, en la zona del espacio. NULL sin funciones.
CREATE FUNCTION private.bolo_access_ends_at(p_bolo_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT ((max(pf.performed_at) + 2)::timestamp AT TIME ZONE w.timezone)
  FROM public.performance pf
  JOIN public.workspace w ON w.id = pf.workspace_id
  WHERE pf.bolo_id = p_bolo_id AND pf.deleted_at IS NULL
  GROUP BY w.timezone;
$$;
REVOKE ALL ON FUNCTION private.bolo_access_ends_at(uuid) FROM PUBLIC, anon, authenticated;

-- Cuándo deja de valer una membresía; NULL = no caduca.
CREATE FUNCTION private.membership_ends_at(p_m public.membership)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN p_m.expires_with_bolo THEN private.bolo_access_ends_at(p_m.bolo_id)
    ELSE p_m.expires_at
  END;
$$;
REVOKE ALL ON FUNCTION private.membership_ends_at(public.membership) FROM PUBLIC, anon, authenticated;

-- ── 2 · la cadena deja fuera lo caducado ─────────────────────────────────
-- Firma y cuerpo de la base viva (2026-10-22); solo se añade el WHERE.
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
       END
  -- Caducidad (20261022100000): solo la llevan las de bolo.
  WHERE (m.expires_at IS NULL AND NOT m.expires_with_bolo)
     OR coalesce(private.membership_ends_at(m) > now(), true);
$function$;

-- ── 3 · invitación de bolo ───────────────────────────────────────────────
ALTER TABLE public.workspace_invitation
  ADD COLUMN bolo_id uuid REFERENCES public.bolo (id) ON DELETE CASCADE,
  ADD COLUMN bolo_preset text REFERENCES public.access_preset (key) ON UPDATE CASCADE,
  ADD CONSTRAINT workspace_invitation_bolo_shape CHECK (
    (bolo_id IS NULL AND bolo_preset IS NULL)
    OR (bolo_id IS NOT NULL
        AND bolo_preset IN ('minim', 'equip')
        AND project_id IS NULL
        AND role = 'guest')
  );
COMMENT ON COLUMN public.workspace_invitation.bolo_id IS
  'Invitación a un bolo (plan 2026-10-22 § 2 a): sin proyecto, rol guest en el espacio y membresía de bolo con bolo_preset al aceptarla, que caduca con el bolo.';
CREATE INDEX workspace_invitation_bolo_idx ON public.workspace_invitation (bolo_id) WHERE bolo_id IS NOT NULL;
CREATE INDEX workspace_invitation_bolo_preset_idx ON public.workspace_invitation (bolo_preset) WHERE bolo_preset IS NOT NULL;

-- El bolo es del espacio de la invitación (no hay FK compuesta a bolo).
CREATE FUNCTION private.guard_workspace_invitation_bolo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.bolo_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.bolo b WHERE b.id = NEW.bolo_id AND b.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'bolo does not belong to this workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_workspace_invitation_bolo() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER workspace_invitation_guard_bolo
  BEFORE INSERT OR UPDATE OF bolo_id, workspace_id ON public.workspace_invitation
  FOR EACH ROW EXECUTE FUNCTION private.guard_workspace_invitation_bolo();

-- ── 4 · crear, aceptar, ver y revocar ────────────────────────────────────
-- Invitar no es una capacidad (ADR-100 § 3): manda el techo de quien invita en
-- ese bolo. Solo Mínim o Equip: Coordinació y Direcció no tienen sentido para
-- una noche (plan § 2 a). El enlace caduca en 7 días; el acceso, con el bolo.
-- p_person_id: el dossier del que sale la invitación (ADR-107); la cuenta pasa
-- a ser esa persona al aceptar, con las reglas de siempre. No toca el dossier.
CREATE FUNCTION public.create_bolo_invitation(
  p_bolo_id uuid,
  p_email text,
  p_preset text DEFAULT 'equip',
  p_person_id uuid DEFAULT NULL
)
RETURNS TABLE(id uuid, email text, bolo_id uuid, bolo_preset text, expires_at timestamptz, token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
#variable_conflict use_column
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_bolo   public.bolo;
  v_token  text;
  v_inv    public.workspace_invitation%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_bolo FROM public.bolo b WHERE b.id = p_bolo_id AND b.deleted_at IS NULL;
  IF v_bolo.id IS NULL OR private.model_container_verb_at('bolo', v_bolo.id, v_caller) IS NULL THEN
    RAISE EXCEPTION 'bolo not found' USING ERRCODE = '42501';
  END IF;
  IF p_preset IS NULL OR p_preset NOT IN ('minim', 'equip') THEN
    RAISE EXCEPTION 'a bolo invitation is minim or equip' USING ERRCODE = '22023';
  END IF;
  IF NOT private.can_grant_preset('bolo', v_bolo.id, p_preset, v_caller) THEN
    RAISE EXCEPTION 'you can only grant what you hold' USING ERRCODE = '42501';
  END IF;
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'valid email required' USING ERRCODE = '22023';
  END IF;
  IF p_person_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workspace_person wp
    WHERE wp.workspace_id = v_bolo.workspace_id AND wp.person_id = p_person_id AND wp.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'person not found' USING ERRCODE = '42501';
  END IF;

  -- Solo la pendiente de este mismo bolo: quien no es admin no puede anular
  -- la invitación al espacio o a otro bolo que otro haya mandado.
  UPDATE public.workspace_invitation wi
  SET revoked_at = now()
  WHERE wi.bolo_id = v_bolo.id
    AND lower(wi.email::text) = v_email
    AND wi.accepted_at IS NULL
    AND wi.revoked_at IS NULL;

  v_token := replace(replace(rtrim(encode(gen_random_bytes(32), 'base64'), '='), '+', '-'), '/', '_');
  INSERT INTO public.workspace_invitation (
    workspace_id, email, role, bolo_id, bolo_preset, person_id, token_hash, invited_by, expires_at
  ) VALUES (
    v_bolo.workspace_id, v_email, 'guest', v_bolo.id, p_preset, p_person_id,
    encode(digest(v_token, 'sha256'), 'hex'), v_caller, now() + interval '7 days'
  )
  RETURNING * INTO v_inv;

  RETURN QUERY SELECT v_inv.id, v_inv.email::text, v_inv.bolo_id, v_inv.bolo_preset, v_inv.expires_at, v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.create_bolo_invitation(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_bolo_invitation(uuid, text, text, uuid) TO authenticated;

-- Firma y cuerpo de la base viva (2026-10-22); se añade la rama de bolo, que
-- vuelve a comprobar el techo de quien invitó: si entretanto lo ha perdido,
-- la invitación ya no vale.
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
  v_bolo_membership public.membership%ROWTYPE;
  v_bolo_membership_id uuid;
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

  IF v_invitation.bolo_id IS NOT NULL AND (
       NOT EXISTS (SELECT 1 FROM public.bolo b WHERE b.id = v_invitation.bolo_id AND b.deleted_at IS NULL)
       OR NOT private.can_grant_preset('bolo', v_invitation.bolo_id, v_invitation.bolo_preset,
                                       v_invitation.invited_by)
     ) THEN
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

  -- Invitación de bolo (20261022100000): membresía de bolo con su paquete, que
  -- caduca con el bolo. Si ya la tenía y sigue viva, no se toca (ni se rebaja
  -- ni se le pone fecha); si había caducado, vuelve con este paquete.
  IF v_invitation.bolo_id IS NOT NULL THEN
    SELECT m.* INTO v_bolo_membership
    FROM public.membership m
    WHERE m.level = 'bolo' AND m.bolo_id = v_invitation.bolo_id AND m.user_id = v_caller;

    IF v_bolo_membership.id IS NULL THEN
      INSERT INTO public.membership (
        workspace_id, level, bolo_id, user_id, container_verb, accepted_at, invited_by, expires_with_bolo
      ) VALUES (
        v_invitation.workspace_id, 'bolo', v_invitation.bolo_id, v_caller,
        (SELECT ap.container_verb FROM public.access_preset ap WHERE ap.key = v_invitation.bolo_preset),
        v_accepted, v_invitation.invited_by, true
      )
      RETURNING id INTO v_bolo_membership_id;
      PERFORM private.expand_preset(v_bolo_membership_id, v_invitation.bolo_preset, v_invitation.invited_by);
    ELSIF coalesce(private.membership_ends_at(v_bolo_membership) <= now(), false) THEN
      UPDATE public.membership m
      SET expires_at = NULL, expires_with_bolo = true, accepted_at = v_accepted
      WHERE m.id = v_bolo_membership.id;
      PERFORM private.expand_preset(v_bolo_membership.id, v_invitation.bolo_preset, v_invitation.invited_by);
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

-- Cambia lo que devuelve: DROP y CREATE con la misma entrada. Cuerpo de la
-- base viva (2026-10-22) más el bolo: su nombre (sala · ciudad, nunca dinero)
-- y la función donde aterrizar (la próxima viva, o la última si ya pasaron).
DROP FUNCTION public.preview_workspace_invitation(text);
CREATE FUNCTION public.preview_workspace_invitation(p_token text)
 RETURNS TABLE(workspace_id uuid, workspace_slug text, workspace_name text, email text, role membership_role,
               project_id uuid, project_name text, project_role_code text, expires_at timestamp with time zone,
               bolo_id uuid, bolo_label text, landing_performance_id uuid)
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
         wi.expires_at,
         b.id,
         nullif(concat_ws(' · ', nullif(btrim(b.venue_name), ''), nullif(btrim(b.city), '')), ''),
         (SELECT pf.id
          FROM public.performance pf
          WHERE pf.bolo_id = b.id AND pf.deleted_at IS NULL
          ORDER BY (pf.performed_at < current_date),
                   CASE WHEN pf.performed_at >= current_date THEN pf.performed_at END ASC,
                   pf.performed_at DESC
          LIMIT 1)
  FROM public.workspace_invitation wi
  JOIN public.workspace w ON w.id = wi.workspace_id AND w.deleted_at IS NULL
  LEFT JOIN public.project p ON p.id = wi.project_id AND p.deleted_at IS NULL
  LEFT JOIN public.bolo b ON b.id = wi.bolo_id AND b.deleted_at IS NULL
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

-- Firma y cuerpo de la base viva (2026-10-22); una de bolo la revoca también
-- quien podría haberla dado (el mismo techo que para crearla).
CREATE OR REPLACE FUNCTION public.revoke_workspace_invitation(p_invitation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_inv public.workspace_invitation%ROWTYPE;
BEGIN
  SELECT * INTO v_inv
  FROM public.workspace_invitation
  WHERE id = p_invitation_id AND accepted_at IS NULL;
  IF v_inv.id IS NULL OR NOT (
       public.is_workspace_admin(v_inv.workspace_id)
       OR (v_inv.bolo_id IS NOT NULL
           AND private.can_grant_preset('bolo', v_inv.bolo_id, v_inv.bolo_preset, (SELECT auth.uid())))
     ) THEN
    RAISE EXCEPTION 'invitation not found' USING ERRCODE = '42501';
  END IF;
  UPDATE public.workspace_invitation SET revoked_at = now()
  WHERE id = p_invitation_id AND revoked_at IS NULL;
END;
$function$;

-- ── 5 · ampliar a mano y quién está en el bolo ───────────────────────────
-- p_expires_at NULL = sin fecha (deja de seguir al bolo y no caduca). Quien
-- puede tocar la membresía (ADR-104: quien podría haberla dado, o el admin).
CREATE FUNCTION public.set_membership_expiry(p_membership_id uuid, p_expires_at timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_m      public.membership;
BEGIN
  SELECT * INTO v_m FROM public.membership WHERE id = p_membership_id;
  IF v_caller IS NULL OR v_m.id IS NULL OR NOT private.can_manage_membership(v_m.id, v_caller) THEN
    RAISE EXCEPTION 'membership not found' USING ERRCODE = '42501';
  END IF;
  IF v_m.level <> 'bolo' THEN
    RAISE EXCEPTION 'only a bolo membership expires' USING ERRCODE = '22023';
  END IF;
  -- La fecha la mueve quien está por encima del bolo (proyecto o línea) o el
  -- admin; ser del espacio sin más no cuenta. can_manage_membership deja tocar una de bolo a quien tiene lo
  -- mismo en el bolo (Mínim con Mínim): sin esto, el técnico de una noche se
  -- quitaría la fecha, o dos invitados se la ampliarían el uno al otro.
  IF NOT EXISTS (
    SELECT 1 FROM private.chain_memberships('bolo', v_m.bolo_id, v_caller) c
    WHERE c.level IN ('project', 'line')
       OR (c.level = 'workspace' AND c.workspace_role IN ('owner', 'admin'))
  ) THEN
    RAISE EXCEPTION 'membership not found' USING ERRCODE = '42501';
  END IF;
  UPDATE public.membership
  SET expires_at = p_expires_at, expires_with_bolo = false
  WHERE id = v_m.id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_membership_expiry(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_membership_expiry(uuid, timestamptz) TO authenticated;

-- Quién está en el bolo por una membresía de bolo, y qué invitaciones esperan.
-- La lista de gente la ve quien está en el bolo (los nombres ya los da
-- thread_audience); los emails pendientes y lo que se puede dar, solo quien
-- puede invitar (al menos Mínim). Sin dinero.
CREATE FUNCTION public.bolo_access(p_bolo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller    uuid := (SELECT auth.uid());
  v_bolo      public.bolo;
  v_minim     boolean;
  v_equip     boolean;
  v_members   jsonb;
  v_invites   jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_bolo FROM public.bolo b WHERE b.id = p_bolo_id AND b.deleted_at IS NULL;
  IF v_caller IS NULL OR v_bolo.id IS NULL
     OR private.model_container_verb_at('bolo', v_bolo.id, v_caller) IS NULL THEN
    RAISE EXCEPTION 'bolo not found' USING ERRCODE = '42501';
  END IF;
  v_minim := private.can_grant_preset('bolo', v_bolo.id, 'minim', v_caller);
  v_equip := private.can_grant_preset('bolo', v_bolo.id, 'equip', v_caller);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'membership_id', m.id,
           'user_id', m.user_id,
           'name', up.full_name,
           'preset', m.preset,
           'ends_at', private.membership_ends_at(m),
           'expires_with_bolo', m.expires_with_bolo,
           'live', coalesce(private.membership_ends_at(m) > now(), true),
           'can_manage', private.can_manage_membership(m.id, v_caller)
         ) ORDER BY up.full_name NULLS LAST, m.user_id), '[]'::jsonb)
  INTO v_members
  FROM public.membership m
  LEFT JOIN public.user_profile up ON up.user_id = m.user_id
  WHERE m.level = 'bolo' AND m.bolo_id = v_bolo.id AND m.accepted_at IS NOT NULL;

  IF v_minim THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', wi.id,
             'email', wi.email::text,
             'preset', wi.bolo_preset,
             'person_id', wi.person_id,
             'invited_by', wi.invited_by,
             'expires_at', wi.expires_at
           ) ORDER BY wi.created_at DESC), '[]'::jsonb)
    INTO v_invites
    FROM public.workspace_invitation wi
    WHERE wi.bolo_id = v_bolo.id
      AND wi.accepted_at IS NULL AND wi.revoked_at IS NULL AND wi.expires_at > now();
  END IF;

  RETURN jsonb_build_object(
    'bolo_id', v_bolo.id,
    'ends_at', private.bolo_access_ends_at(v_bolo.id),
    'can_invite', jsonb_build_object('minim', v_minim, 'equip', v_equip),
    'members', v_members,
    'invitations', v_invites
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bolo_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bolo_access(uuid) TO authenticated;

-- ── 6 · la función se lee por la cadena ──────────────────────────────────
-- Solo las membresías finas (línea, bolo, función): espacio y proyecto ya los
-- mira has_permission, y un miembro del espacio sin proyecto sigue sin ver.
-- La primera condición es un índice sobre membership(user_id): para quien no
-- tiene ninguna membresía fina, no se recorre la cadena.
CREATE FUNCTION private.reads_performance_through_chain(p_performance_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.membership f
      WHERE f.user_id = p_user_id AND f.level IN ('line', 'bolo', 'performance') AND f.accepted_at IS NOT NULL
    )
    AND EXISTS (
      SELECT 1 FROM private.chain_memberships('performance', p_performance_id, p_user_id) m
      WHERE m.level IN ('line', 'bolo', 'performance')
    );
$$;
REVOKE ALL ON FUNCTION private.reads_performance_through_chain(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Lo que llama la política: siempre con quien llama, como los demás
-- `*_by_caller`, para que nadie pregunte por otro login.
CREATE FUNCTION private.performance_readable_through_chain_by_caller(p_performance_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT private.reads_performance_through_chain(p_performance_id, (SELECT auth.uid()));
$$;
REVOKE ALL ON FUNCTION private.performance_readable_through_chain_by_caller(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.performance_readable_through_chain_by_caller(uuid) TO authenticated;

-- Texto vivo (pg_policies, 2026-10-22) más la rama de la cadena.
DROP POLICY performance_select ON public.performance;
CREATE POLICY performance_select ON public.performance
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      has_permission(project_id, 'read:performance'::text)
      OR private.performance_readable_through_chain_by_caller(id)
    )
  );

-- ── 7 · la sala de esas funciones, y el directorio solo para el equipo ────
CREATE FUNCTION private.reads_venue_through_chain(p_venue_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.membership f
      WHERE f.user_id = p_user_id AND f.level IN ('line', 'bolo', 'performance') AND f.accepted_at IS NOT NULL
    )
    AND EXISTS (
      SELECT 1 FROM public.performance pf
      WHERE pf.venue_id = p_venue_id AND pf.deleted_at IS NULL
        AND private.reads_performance_through_chain(pf.id, p_user_id)
    );
$$;
REVOKE ALL ON FUNCTION private.reads_venue_through_chain(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.venue_readable_through_chain_by_caller(p_venue_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT private.reads_venue_through_chain(p_venue_id, (SELECT auth.uid()));
$$;
REVOKE ALL ON FUNCTION private.venue_readable_through_chain_by_caller(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.venue_readable_through_chain_by_caller(uuid) TO authenticated;

DROP POLICY venue_select ON public.venue;
CREATE POLICY venue_select ON public.venue
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      is_workspace_internal_member(workspace_id)
      OR private.venue_readable_through_chain_by_caller(id)
    )
  );

DROP POLICY venue_insert ON public.venue;
CREATE POLICY venue_insert ON public.venue
  FOR INSERT TO authenticated
  WITH CHECK ((workspace_id = current_workspace_id()) AND is_workspace_internal_member(workspace_id));

DROP POLICY venue_update ON public.venue;
CREATE POLICY venue_update ON public.venue
  FOR UPDATE TO authenticated
  USING ((deleted_at IS NULL) AND is_workspace_internal_member(workspace_id))
  WITH CHECK (is_workspace_internal_member(workspace_id));

-- ── 8 · membership_facet con id y auditoría ──────────────────────────────
ALTER TABLE public.membership_facet
  ADD COLUMN id uuid NOT NULL DEFAULT uuid_generate_v7();
ALTER TABLE public.membership_facet
  ADD CONSTRAINT membership_facet_id_key UNIQUE (id);

-- write_audit saca el espacio de NEW.workspace_id, que esta tabla no tiene, y
-- caería en current_workspace_id() (el del JWT, que puede ser otro). Aquí el
-- espacio sale de la membresía; en un borrado en cascada ya no está y queda NULL.
CREATE FUNCTION private.audit_membership_facet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.membership_facet;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
  INSERT INTO public.audit_log (workspace_id, actor_id, entity_type, entity_id, action, changes)
  VALUES (
    (SELECT m.workspace_id FROM public.membership m WHERE m.id = v_row.membership_id),
    auth.uid(),
    'membership_facet',
    v_row.id,
    lower(TG_OP),
    CASE TG_OP
      WHEN 'UPDATE' THEN jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW))
      ELSE to_jsonb(v_row)
    END
  );
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION private.audit_membership_facet() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER membership_facet_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.membership_facet
  FOR EACH ROW EXECUTE FUNCTION private.audit_membership_facet();

-- ── 9 · grants ───────────────────────────────────────────────────────────
-- membership y membership_facet: authenticated tiene SELECT de tabla entera
-- (las columnas nuevas entran solas); nadie escribe por la API.
-- workspace_invitation: sin grant a authenticated; todo por RPC.

-- ── 10 · foto de después ─────────────────────────────────────────────────
DO $$
DECLARE
  v_changed int;
BEGIN
  SELECT count(*) INTO v_changed
  FROM bolo_membership_access_before b
  JOIN public.membership m ON m.id = b.membership_id
  JOIN public.workspace w ON w.id = m.workspace_id
  WHERE b.performances IS DISTINCT FROM (
          SELECT count(*)
          FROM public.performance p
          WHERE p.workspace_id = w.id
            AND p.deleted_at IS NULL
            AND (public.has_permission_for_user(p.project_id, 'read:performance', m.user_id)
                 OR private.reads_performance_through_chain(p.id, m.user_id)))
     OR b.venues IS DISTINCT FROM (
          SELECT count(*)
          FROM public.venue v
          WHERE v.workspace_id = w.id
            AND v.deleted_at IS NULL
            AND (private.model_has_workspace_role(v.workspace_id, m.user_id,
                   ARRAY['owner', 'admin', 'member', 'viewer']::public.membership_role[])
                 OR private.reads_venue_through_chain(v.id, m.user_id)));
  IF v_changed > 0 THEN
    RAISE EXCEPTION 'bolo_membership: % memberships would read different performances or venues', v_changed;
  END IF;
END;
$$;
