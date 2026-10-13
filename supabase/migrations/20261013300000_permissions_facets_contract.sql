-- Permisos al modelo de facetas, CONTRACT (ADR-099 §8, ADR-100, ADR-104; plan
-- en build/permissions-facets-plan.md § 9).
--
-- Va DESPUÉS de 20261013200000_permissions_facets_writes. Desde la fase 3
-- `membership` + `membership_facet` son la única fuente del acceso y las
-- tablas viejas su proyección. El contract borra lo viejo sin capa de
-- compatibilidad (Marco, 2026-10-13: no hay nadie en producción ni en beta).
-- Lo único que no puede cambiar es el acceso efectivo de cada persona a cada
-- contenedor: la migración lo fotografía antes y después y aborta si difiere.
--
-- WHAT THIS DOES:
--   1. Comprueba, antes de tocar nada: paridad cero entre las tablas viejas y
--      el modelo, ninguna membresía de contenedor sin `container_verb`, y que
--      cada firma de correo tiene una fila de espacio donde caer.
--   2. Borra la proyección inversa (fase 3), el espejo (expand), los lectores
--      congelados `legacy_*` (fase 2), la paridad, y las RPC de comprobación
--      `has_permission_by_facets` y `access_parity_report`.
--   3. Mueve `workspace_membership.mail_signature` a `membership.mail_signature`
--      (solo en la fila de espacio) y reescribe my_mail_signature y
--      set_my_mail_signature (misma firma).
--   4. Borra `project.owner_id` (sin escritor ni lector; § 9.6, pendiente de
--      Marco), `project_membership` y `workspace_membership`.
--   5. `workspace_role` queda como catálogo de etiquetas: fuera `permissions`,
--      `access_level` y su tipo; la siembra deja de escribirlos; fuera
--      validate_project_membership_roles.
--   6. Fuera `can_manage_members` (membership y access_preset; ADR-100 §3) y
--      las cadenas muertas: has_permission conoce siete y una desconocida es
--      un error 22023.
--   7. `container_verb` obligatorio en toda membresía de contenedor (ADR-100
--      §2); la de espacio sigue con su rol y sin verbo (ADR-100 §4).
--      grant_container_preset y accept_workspace_invitation insertan la fila
--      con el verbo del paquete (antes lo ponía expand_preset después). Las
--      facetas `source = legacy` pasan a `override`.
--   8. `membership` se audita con write_audit (antes lo hacían, de rebote, las
--      tablas viejas).
--   9. Aborta si el acceso efectivo cambió, o si alguna función sigue
--      nombrando algo de lo borrado.
--
-- RLS: ninguna política nueva. Las de las dos tablas borradas se van con
-- ellas; membership.mail_signature queda bajo membership_select (la propia, o
-- todas si administras el espacio: lo mismo que workspace_membership_select) y
-- nadie escribe membership por la API.
--
-- DESTRUCTIVA según § 34 (DROP de tablas, columnas, un tipo y funciones;
-- reescribe filas de membership_facet): inspect + staging + plan + apply.
-- Vuelta atrás: restaurar el backup del apply (plan § 9.8); no hay rollback SQL.

-- ── 1 · antes de tocar nada ───────────────────────────────────────────────
DO $$
DECLARE
  v_count  integer;
  v_detail text;
BEGIN
  SELECT count(*), string_agg(format('%s %s %s %s legacy=%s model=%s',
                                     m.user_id, m.workspace_id, coalesce(m.project_id::text, '-'),
                                     m.probe, m.legacy, m.model), E'\n')
  INTO v_count, v_detail
  FROM private.access_parity_mismatches() m;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'permissions_facets_contract: % parity mismatch(es); nothing applied', v_count
      USING DETAIL = v_detail;
  END IF;

  SELECT count(*), string_agg(format('%s %s user=%s', m.id, m.level, m.user_id), E'\n')
  INTO v_count, v_detail
  FROM public.membership m
  WHERE m.level <> 'workspace' AND m.container_verb IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'permissions_facets_contract: % container membership(s) without container_verb; nothing applied', v_count
      USING DETAIL = v_detail,
            HINT = 'Darles view o quitarlas cambia su acceso: lo decide Marco (plan § 9.4, punto 2).';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.membership m
  WHERE m.level = 'workspace' AND m.container_verb IS NOT NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'permissions_facets_contract: % workspace membership(s) with container_verb; nothing applied', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.workspace_membership wm
  WHERE wm.mail_signature IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.membership m
      WHERE m.level = 'workspace' AND m.workspace_id = wm.workspace_id AND m.user_id = wm.user_id
    );
  IF v_count > 0 THEN
    RAISE EXCEPTION 'permissions_facets_contract: % mail signature(s) without a workspace membership; nothing applied', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.project WHERE owner_id IS NOT NULL;
  RAISE NOTICE 'permissions_facets_contract: project.owner_id set on % project(s); the column is dropped', v_count;
END;
$$;

-- La foto del acceso efectivo, con los mismos lectores antes y después.
-- Vive en pg_temp y se borra al final.
CREATE FUNCTION pg_temp.contract_access_snapshot()
RETURNS TABLE (k text, v text)
LANGUAGE sql VOLATILE
AS $$
  WITH pair AS (
    SELECT DISTINCT m.workspace_id, m.user_id
    FROM public.membership m
    WHERE m.level IN ('workspace', 'project')
  ),
  project_pair AS (
    SELECT DISTINCT x.user_id, p.id AS project_id
    FROM pair x
    JOIN public.project p ON p.workspace_id = x.workspace_id
  )
  SELECT format('workspace %s %s', x.workspace_id, x.user_id),
         format('role=%s money=%s',
                private.model_workspace_role(x.workspace_id, x.user_id),
                private.model_can_read_workspace_money(x.workspace_id, x.user_id))
  FROM pair x
  UNION ALL
  SELECT format('project %s %s', x.project_id, x.user_id),
         format('access=%s %s',
                private.model_can_access_project(x.project_id, x.user_id),
                (SELECT string_agg(perm || '=' || public.has_permission_for_user(x.project_id, perm, x.user_id), ','
                                   ORDER BY perm)
                 FROM unnest(ARRAY['read:performance', 'edit:performance', 'read:money', 'edit:money',
                                   'read:conversation', 'edit:conversation', 'edit:project_meta']) perm))
  FROM project_pair x
  UNION ALL
  SELECT format('membership %s', m.id),
         format('%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
                m.level, m.workspace_id, m.project_id, m.line_id, m.bolo_id, m.performance_id, m.user_id,
                m.workspace_role, m.container_verb, m.can_edit_meta, m.accepted_at,
                (SELECT string_agg(format('%s:%s', mf.facet_id, mf.verb), ',' ORDER BY mf.facet_id)
                 FROM public.membership_facet mf WHERE mf.membership_id = m.id))
  FROM public.membership m;
$$;

CREATE TEMP TABLE permissions_facets_contract_before AS
  SELECT * FROM pg_temp.contract_access_snapshot();

-- ── 2 · fuera la proyección, el espejo, lo congelado y la paridad ─────────
DROP TRIGGER membership_project_legacy ON public.membership;
DROP TRIGGER membership_facet_project_legacy ON public.membership_facet;

DROP FUNCTION private.membership_to_legacy();
DROP FUNCTION private.membership_facet_to_legacy();
DROP FUNCTION private.project_legacy_pair(public.container_level, uuid, uuid, uuid);
DROP FUNCTION private.project_legacy_workspace(uuid, uuid);
DROP FUNCTION private.project_legacy_project(uuid, uuid);
DROP FUNCTION private.legacy_project_grants(uuid);

DROP FUNCTION private.mirror_workspace_membership();
DROP FUNCTION private.mirror_project_membership();
DROP FUNCTION private.mirror_workspace_role();
DROP FUNCTION private.sync_workspace_access(uuid, uuid);
DROP FUNCTION private.sync_project_access(uuid, uuid);
DROP FUNCTION private.standard_facet_id(text);

DROP FUNCTION public.access_parity_report();
DROP FUNCTION public.has_permission_by_facets(uuid, text);
DROP FUNCTION private.access_parity_mismatches();

-- has_permission_for_user deja de tener rama vieja antes de borrar lo que la
-- contestaba. Una cadena desconocida es un error, no un false callado.
CREATE FUNCTION private.unknown_permission(p_perm text)
RETURNS boolean
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RAISE EXCEPTION 'unknown permission: %', p_perm USING ERRCODE = '22023';
END;
$$;
REVOKE ALL ON FUNCTION private.unknown_permission(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.model_has_permission(p_project_id uuid, p_perm text, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN p_perm = 'read:money'        THEN private.model_has_facet(p_project_id, 'diners',    'view', p_user_id)
    WHEN p_perm = 'edit:money'        THEN private.model_has_facet(p_project_id, 'diners',    'edit', p_user_id)
    WHEN p_perm = 'read:conversation' THEN private.model_has_facet(p_project_id, 'converses', 'view', p_user_id)
    WHEN p_perm = 'edit:conversation' THEN private.model_has_facet(p_project_id, 'converses', 'edit', p_user_id)
    WHEN p_perm IN ('read:performance', 'edit:performance', 'edit:project_meta') THEN
      p_user_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.project p
        JOIN public.membership w
          ON w.level = 'workspace'
         AND w.workspace_id = p.workspace_id
         AND w.user_id = p_user_id
         AND w.accepted_at IS NOT NULL
        WHERE p.id = p_project_id
          AND p.deleted_at IS NULL
          AND (
            w.workspace_role IN ('owner', 'admin')
            OR EXISTS (
              SELECT 1
              FROM public.membership m
              WHERE m.level = 'project'
                AND m.project_id = p.id
                AND m.user_id = p_user_id
                AND m.accepted_at IS NOT NULL
                AND CASE p_perm
                      WHEN 'read:performance'  THEN true
                      WHEN 'edit:performance'  THEN m.container_verb = 'edit'
                      WHEN 'edit:project_meta' THEN m.can_edit_meta
                    END
            )
          )
      )
    ELSE private.unknown_permission(p_perm)
  END;
$$;

CREATE OR REPLACE FUNCTION public.has_permission_for_user(p_project_id uuid, p_perm text, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  -- Siete permisos: read/edit de performance, money y conversation, y
  -- edit:project_meta (plan § 3 y § 9).
  SELECT private.model_has_permission(p_project_id, p_perm, p_user_id);
$$;

DROP FUNCTION private.legacy_can_read_workspace_money(uuid, uuid);
DROP FUNCTION private.legacy_can_access_project(uuid, uuid);
DROP FUNCTION private.legacy_has_permission_for_user(uuid, text, uuid);
DROP FUNCTION private.legacy_workspace_role(uuid, uuid);

-- ── 3 · la firma de correo pasa a la fila de espacio de membership ────────
ALTER TABLE public.membership
  ADD COLUMN mail_signature text,
  ADD CONSTRAINT membership_mail_signature_workspace
    CHECK (mail_signature IS NULL OR (level = 'workspace' AND length(mail_signature) <= 2000));
COMMENT ON COLUMN public.membership.mail_signature IS
  'Firma de correo personal en este espacio (ADR-099, añadido). Solo en la fila de espacio; NULL = la propuesta. Se escribe con set_my_mail_signature.';

UPDATE public.membership m
SET mail_signature = wm.mail_signature
FROM public.workspace_membership wm
WHERE m.level = 'workspace'
  AND m.workspace_id = wm.workspace_id
  AND m.user_id = wm.user_id
  AND wm.mail_signature IS NOT NULL;

CREATE OR REPLACE FUNCTION public.my_mail_signature(p_workspace_id uuid)
 RETURNS TABLE(full_name text, title text, company_name text, company_website text, company_phone text, signature text, company_signature text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce(nullif(btrim(wp.full_name), ''), nullif(btrim(up.full_name), '')),
         nullif(btrim(wp.title), ''),
         w.name,
         nullif(btrim(w.website), ''),
         nullif(btrim(w.phone), ''),
         m.mail_signature,
         w.mail_signature
  FROM public.membership m
  JOIN public.workspace w ON w.id = m.workspace_id AND w.deleted_at IS NULL
  LEFT JOIN public.user_profile up ON up.user_id = m.user_id
  LEFT JOIN public.workspace_person wp
    ON wp.workspace_id = m.workspace_id AND wp.person_id = up.person_id AND wp.deleted_at IS NULL
  WHERE m.level = 'workspace'
    AND m.workspace_id = p_workspace_id
    AND m.user_id = (SELECT auth.uid())
    AND public.is_workspace_member(p_workspace_id);
$function$;

CREATE OR REPLACE FUNCTION public.set_my_mail_signature(p_workspace_id uuid, p_signature text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_sig    text := nullif(btrim(coalesce(p_signature, '')), '');
BEGIN
  IF v_caller IS NULL OR NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace % not found', p_workspace_id USING ERRCODE = '42501';
  END IF;
  IF length(v_sig) > 2000 THEN
    RAISE EXCEPTION 'signature too long' USING ERRCODE = '22023';
  END IF;
  UPDATE public.membership
  SET mail_signature = v_sig
  WHERE level = 'workspace' AND workspace_id = p_workspace_id AND user_id = v_caller
    AND mail_signature IS DISTINCT FROM v_sig;
END;
$function$;

-- ── 4 · fuera las tablas viejas ───────────────────────────────────────────
-- project.owner_id apuntaba a workspace_membership.id y nadie la escribe ni la
-- lee (plan § 9.6, punto 1).
ALTER TABLE public.project DROP COLUMN owner_id;

DROP TABLE public.project_membership;
DROP TABLE public.workspace_membership;

-- ── 5 · workspace_role, catálogo de etiquetas ─────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_system_roles_on_workspace()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Los roles son etiquetas (ADR-082): lo que haces, no lo que puedes. El
  -- acceso lo dan la membresía y sus facetas.
  INSERT INTO public.workspace_role (workspace_id, code, label, is_system) VALUES
    (NEW.id, 'owner',              'Owner',              true),
    (NEW.id, 'admin',              'Admin',              true),
    (NEW.id, 'producer',           'Producer',           true),
    (NEW.id, 'production_manager', 'Production Manager', true),
    (NEW.id, 'tour_manager',       'Tour Manager',       true),
    (NEW.id, 'distribution',       'Distribution',       true),
    (NEW.id, 'director',           'Director',           true),
    (NEW.id, 'author',             'Author',             true),
    (NEW.id, 'technical_director', 'Technical Director', true),
    (NEW.id, 'performer',          'Performer',          true),
    (NEW.id, 'light_design',       'Light Design',       true),
    (NEW.id, 'sound_design',       'Sound Design',       true),
    (NEW.id, 'stage_design',       'Stage Design',       true),
    (NEW.id, 'costume_design',     'Costume Design',     true),
    (NEW.id, 'press',              'Press',              true),
    (NEW.id, 'viewer',             'Viewer',             true);
  RETURN NEW;
END;
$function$;

ALTER TABLE public.workspace_role
  DROP COLUMN permissions,
  DROP COLUMN access_level;
DROP TYPE public.workspace_role_access_level;
COMMENT ON TABLE public.workspace_role IS
  'Catálogo de roles de un espacio como ETIQUETAS (ADR-082): membership.roles y las invitaciones usan sus códigos. No da acceso; lo dan membership y membership_facet.';

DROP FUNCTION public.validate_project_membership_roles();

-- ── 6 · fuera can_manage_members (ADR-100 §3) ─────────────────────────────
CREATE OR REPLACE FUNCTION private.expand_preset(p_membership_id uuid, p_preset text, p_granted_by uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_m public.membership;
  v_p public.access_preset;
BEGIN
  SELECT * INTO v_m FROM public.membership WHERE id = p_membership_id;
  SELECT * INTO v_p FROM public.access_preset WHERE key = p_preset;
  IF v_m.id IS NULL OR v_p.key IS NULL THEN
    RAISE EXCEPTION 'unknown membership or preset' USING ERRCODE = '22023';
  END IF;

  UPDATE public.membership
  SET preset = v_p.key,
      container_verb = v_p.container_verb,
      can_edit_meta = v_p.can_edit_meta
  WHERE id = v_m.id;

  DELETE FROM public.membership_facet WHERE membership_id = v_m.id AND source = 'preset';

  INSERT INTO public.membership_facet (membership_id, facet_id, verb, source, granted_by)
  SELECT v_m.id, f.id, pf.verb, 'preset', p_granted_by
  FROM public.access_preset_facet pf
  JOIN public.facet f ON f.key = pf.facet_key AND f.workspace_id IS NULL
  JOIN public.facet_level fl ON fl.facet_id = f.id AND fl.level = v_m.level
  WHERE pf.preset_key = v_p.key
    AND NOT EXISTS (
      SELECT 1 FROM public.membership_facet o
      WHERE o.membership_id = v_m.id AND o.facet_id = f.id
    );
END;
$$;

CREATE OR REPLACE FUNCTION private.can_grant_preset(
  p_level public.container_level, p_id uuid, p_preset text, p_user_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_p     public.access_preset;
  v_verb  public.access_verb := private.model_container_verb_at(p_level, p_id, p_user_id);
  v_admin boolean;
  v_meta  boolean;
BEGIN
  SELECT * INTO v_p FROM public.access_preset WHERE key = p_preset;
  IF v_p.key IS NULL OR v_verb IS NULL THEN
    RETURN false;
  END IF;
  IF v_p.container_verb = 'edit' AND v_verb <> 'edit' THEN
    RETURN false;
  END IF;

  -- El techo del delegante (ADR-085 §10): contenedor, metadatos y facetas.
  -- Invitar no es una capacidad aparte (ADR-100 §3).
  SELECT coalesce(bool_or(m.level = 'workspace' AND m.workspace_role IN ('owner', 'admin')), false),
         coalesce(bool_or(m.can_edit_meta), false)
  INTO v_admin, v_meta
  FROM private.chain_memberships(p_level, p_id, p_user_id) m;

  IF NOT v_admin AND v_p.can_edit_meta AND NOT v_meta THEN
    RETURN false;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1
    FROM public.access_preset_facet pf
    JOIN public.facet f ON f.key = pf.facet_key AND f.workspace_id IS NULL
    JOIN public.facet_level fl ON fl.facet_id = f.id AND fl.level = p_level
    WHERE pf.preset_key = p_preset
      AND NOT private.model_has_facet_at(p_level, p_id, f.id, pf.verb, p_user_id)
  );
END;
$$;

ALTER TABLE public.membership DROP COLUMN can_manage_members;
ALTER TABLE public.access_preset DROP COLUMN can_manage_members;

-- ── 7 · container_verb obligatorio; las facetas del espejo, override ──────
-- Las dos RPC que crean membresías de contenedor las insertaban sin verbo y
-- dejaban que expand_preset lo pusiera después; con container_verb
-- obligatorio, la fila nace con el verbo del paquete. Mismo cuerpo que la
-- fase 3 salvo ese INSERT.
-- · grant_container_preset
CREATE OR REPLACE FUNCTION public.grant_container_preset(
  p_level public.container_level, p_container_id uuid, p_user_id uuid, p_preset text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_ws     uuid;
  v_id     uuid;
  v_role   public.membership_role;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT c.workspace_id INTO v_ws
  FROM private.container_chain(p_level, p_container_id) c
  WHERE c.level = p_level;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'container not found' USING ERRCODE = '42501';
  END IF;

  IF NOT private.can_grant_preset(p_level, p_container_id, p_preset, v_caller) THEN
    RAISE EXCEPTION 'you can only grant what you hold' USING ERRCODE = '42501';
  END IF;
  IF NOT private.model_has_workspace_role(v_ws, p_user_id) THEN
    RAISE EXCEPTION 'grantee is not a member of this workspace' USING ERRCODE = '42501';
  END IF;

  -- En el espacio el paquete se traduce al rol (plan § 8.5): Direcció es admin
  -- (ADR-100 §4); cualquier otro quita admin. Sin facetas de espacio.
  IF p_level = 'workspace' THEN
    SELECT m.id, m.workspace_role INTO v_id, v_role
    FROM public.membership m
    WHERE m.level = 'workspace' AND m.workspace_id = v_ws AND m.user_id = p_user_id;
    IF v_role = 'owner' THEN
      RAISE EXCEPTION 'owner transfer is a separate operation' USING ERRCODE = '42501';
    END IF;
    UPDATE public.membership
    SET workspace_role = CASE
          WHEN p_preset = 'direccio' THEN 'admin'::public.membership_role
          WHEN workspace_role = 'admin' THEN 'member'::public.membership_role
          ELSE workspace_role
        END
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  SELECT m.id INTO v_id FROM public.membership m
  WHERE m.level = p_level AND m.user_id = p_user_id
    AND private.membership_container_id(m) = p_container_id;

  IF v_id IS NULL THEN
    INSERT INTO public.membership (workspace_id, level, project_id, line_id, bolo_id, performance_id,
                                   user_id, container_verb, accepted_at, invited_by)
    VALUES (v_ws, p_level,
            CASE WHEN p_level = 'project' THEN p_container_id END,
            CASE WHEN p_level = 'line' THEN p_container_id END,
            CASE WHEN p_level = 'bolo' THEN p_container_id END,
            CASE WHEN p_level = 'performance' THEN p_container_id END,
            p_user_id,
            (SELECT ap.container_verb FROM public.access_preset ap WHERE ap.key = p_preset),
            now(), v_caller)
    RETURNING id INTO v_id;
  ELSIF NOT private.can_manage_membership(v_id, v_caller) THEN
    RAISE EXCEPTION 'you can only change what you could have granted' USING ERRCODE = '42501';
  END IF;

  PERFORM private.expand_preset(v_id, p_preset, v_caller);
  RETURN v_id;
END;
$$;

-- · accept_workspace_invitation
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

ALTER TABLE public.membership DROP CONSTRAINT membership_level_shape;
ALTER TABLE public.membership ADD CONSTRAINT membership_level_shape CHECK (
     (level = 'workspace'   AND num_nonnulls(project_id, line_id, bolo_id, performance_id) = 0
        AND workspace_role IS NOT NULL AND container_verb IS NULL)
  OR (level = 'project'     AND project_id IS NOT NULL     AND num_nonnulls(line_id, bolo_id, performance_id) = 0
        AND workspace_role IS NULL AND container_verb IS NOT NULL)
  OR (level = 'line'        AND line_id IS NOT NULL        AND num_nonnulls(project_id, bolo_id, performance_id) = 0
        AND workspace_role IS NULL AND container_verb IS NOT NULL)
  OR (level = 'bolo'        AND bolo_id IS NOT NULL        AND num_nonnulls(project_id, line_id, performance_id) = 0
        AND workspace_role IS NULL AND container_verb IS NOT NULL)
  OR (level = 'performance' AND performance_id IS NOT NULL AND num_nonnulls(project_id, line_id, bolo_id) = 0
        AND workspace_role IS NULL AND container_verb IS NOT NULL)
);

-- Las facetas que escribió el espejo se dieron a mano, fuera de un paquete
-- (plan § 9.6, punto 2).
UPDATE public.membership_facet SET source = 'override' WHERE source = 'legacy';
ALTER TABLE public.membership_facet DROP CONSTRAINT membership_facet_source_check;
ALTER TABLE public.membership_facet ADD CONSTRAINT membership_facet_source_check
  CHECK (source IN ('preset', 'override'));

COMMENT ON TABLE public.membership IS
  'Membresía por nivel de contenedor (ADR-082): la única fuente del acceso. Estar es ver el contenedor y su hilo General. El espacio lleva workspace_role (su propia dimensión, ADR-100 §4); cualquier otro nivel, container_verb. La escribe solo el servidor: invitaciones, grant_container_preset, set_membership_facet, revoke_membership y las RPC de miembros del espacio.';
COMMENT ON COLUMN public.membership.container_verb IS
  'Acceso al propio contenedor (ADR-100 §1): view = read:performance, edit = edit:performance. Obligatorio fuera del espacio (ADR-100 §2); NULL en el espacio.';
COMMENT ON COLUMN public.membership.preset IS
  'Paquete del que se expandieron las filas. NULL en las membresías de antes de la fase 3 de facetas, que no vinieron de un paquete.';
COMMENT ON TABLE public.membership_facet IS
  'Quién tiene qué faceta en qué contenedor. Sin fila = res. source: preset (vino con el paquete) u override (alguien la dio a mano, o venía del modelo de roles de antes del contract); la vista «de dónde sale cada permiso» de ADR-082 §4 lee esta columna.';
COMMENT ON TABLE public.access_preset IS
  'Escalera de paquetes (ADR-082 enmienda §2, contenido ADR-100 §6). Un paquete se EXPANDE en filas al conceder (source = preset); no se resuelve al leer. Direcció = Coordinació + Diners edit (ADR-100 §3).';

-- ── 8 · membership se audita ──────────────────────────────────────────────
CREATE TRIGGER membership_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.membership
  FOR EACH ROW EXECUTE FUNCTION public.write_audit();

-- ── 9 · el acceso no cambió y nada nombra lo borrado ──────────────────────
DO $$
DECLARE
  v_count  integer;
  v_detail text;
BEGIN
  CREATE TEMP TABLE permissions_facets_contract_after AS
    SELECT * FROM pg_temp.contract_access_snapshot();

  WITH diff AS (
    (SELECT 'before' AS side, * FROM permissions_facets_contract_before
     EXCEPT SELECT 'before', * FROM permissions_facets_contract_after)
    UNION ALL
    (SELECT 'after', * FROM permissions_facets_contract_after
     EXCEPT SELECT 'after', * FROM permissions_facets_contract_before)
  )
  SELECT count(*), string_agg(format('%s %s: %s', side, k, v), E'\n' ORDER BY k, side)
  INTO v_count, v_detail
  FROM (SELECT * FROM diff LIMIT 50) d;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'permissions_facets_contract: effective access changed; nothing applied'
      USING DETAIL = v_detail;
  END IF;

  SELECT count(*), string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY p.proname)
  INTO v_count, v_detail
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'private')
    AND p.prosrc ~ '\m(workspace_membership|project_membership|can_manage_members|legacy_[a-z_]+|access_parity_[a-z_]+|has_permission_by_facets|standard_facet_id|access_level)\M';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'permissions_facets_contract: functions still name dropped objects: %', v_detail;
  END IF;
END;
$$;

DROP TABLE pg_temp.permissions_facets_contract_before, pg_temp.permissions_facets_contract_after;
DROP FUNCTION pg_temp.contract_access_snapshot();
