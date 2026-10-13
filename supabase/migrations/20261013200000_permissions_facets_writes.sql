-- Permisos al modelo de facetas, FASE 3: las escrituras pasan al modelo nuevo
-- (ADR-099 §8, ADR-100; plan en build/permissions-facets-plan.md § 8).
--
-- Va DESPUÉS de 20261011100000_permissions_facets_expand y
-- 20261011300000_permissions_facets_reads. Desde aquí la única tabla que se
-- escribe para dar o quitar acceso es `membership` (con `membership_facet`).
-- workspace_membership y project_membership pasan a ser una PROYECCIÓN del
-- modelo nuevo, escrita por trigger en el mismo statement, para que el rollback
-- no pierda accesos y la paridad siga vigilando hasta el contract.
--
-- WHAT THIS DOES:
--   1. Proyección inversa: triggers en `membership` y `membership_facet` que
--      recalculan la fila vieja de la pareja tocada. En proyecto, los ocho
--      permisos vivos van explícitos (grants = lo concedido, revokes = el
--      resto), así que los permisos de los roles ya no cambian el acceso.
--   2. Apaga el espejo del expand (los tres triggers *_mirror_access) y la
--      validación de roles en project_membership; la validación de etiquetas
--      pasa a `membership` (solo las nuevas de cada fila).
--   3. Cierra project_membership a la API (sin INSERT, UPDATE ni DELETE para
--      anon y authenticated; workspace_membership ya no los tenía).
--   4. El techo del delegante deja de mirar can_manage_members (ADR-100 §3) y
--      sirve también para gestionar una membresía ajena (can_manage_membership).
--   5. grant_container_preset en todos los niveles (espacio: el paquete se
--      traduce al rol, § 8.5), y dos RPC nuevas: set_membership_facet (override
--      de una faceta) y revoke_membership (quitar una membresía de proyecto,
--      línea, bolo o función).
--   6. Reescribe las RPC que escribían las tablas viejas: handle_new_user,
--      create_workspace, accept_workspace_invitation, update_workspace_member_role,
--      revoke_workspace_member, list_workspace_access (ids de membership) y
--      create_workspace_invitation (paquete del proyecto, por defecto Mínim,
--      ADR-085 §11; columna workspace_invitation.project_preset).
--   7. Proyecta todas las membresías de espacio y de proyecto una vez (forma
--      canónica de project_membership) y ABORTA si la paridad no es cero.
--
-- NO hace el contract: las tablas viejas, legacy_*, la paridad,
-- has_permission_by_facets y las funciones del espejo se quedan.
-- seed_system_roles_on_workspace no cambia (plan § 8.3).
--
-- RLS: ninguna política nueva. Las RPC nuevas son SECURITY DEFINER con el
-- techo en el servidor; las funciones de proyección y de techo viven en
-- `private`, sin EXECUTE para nadie.
--
-- DESTRUCTIVA según § 34 (reescribe funciones SECURITY DEFINER, borra triggers,
-- quita grants, cambia una firma y reescribe filas de project_membership):
-- inspect + staging + plan + apply.
-- Rollback: build/runbooks/rollback-20261013-permissions-facets-writes.sql.

-- ── 1 · proyección inversa ────────────────────────────────────────────────
-- Lo que una membresía de proyecto concede, en las cadenas del modelo viejo.
CREATE FUNCTION private.legacy_project_grants(p_membership_id uuid)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(array_agg(DISTINCT g ORDER BY g), '{}')
  FROM (
    SELECT unnest(CASE m.container_verb
                    WHEN 'edit' THEN ARRAY['read:performance', 'edit:performance']
                    WHEN 'view' THEN ARRAY['read:performance']
                    ELSE '{}'::text[] END) AS g
    FROM public.membership m WHERE m.id = p_membership_id
    UNION ALL
    SELECT 'edit:project_meta' FROM public.membership m WHERE m.id = p_membership_id AND m.can_edit_meta
    UNION ALL
    SELECT 'edit:membership' FROM public.membership m WHERE m.id = p_membership_id AND m.can_manage_members
    UNION ALL
    -- Diners y Converses como las lee model_has_facet: por clave, estándar o
    -- del espacio, y solo donde la faceta existe en el nivel de la fila.
    SELECT unnest(CASE WHEN mf.verb = 'edit' THEN ARRAY['read:' || k.noun, 'edit:' || k.noun]
                       ELSE ARRAY['read:' || k.noun] END)
    FROM public.membership m
    JOIN public.membership_facet mf ON mf.membership_id = m.id
    JOIN public.facet f ON f.id = mf.facet_id
                       AND (f.workspace_id IS NULL OR f.workspace_id = m.workspace_id)
    JOIN public.facet_level fl ON fl.facet_id = f.id AND fl.level = m.level
    CROSS JOIN LATERAL (
      SELECT CASE f.key WHEN 'diners' THEN 'money' WHEN 'converses' THEN 'conversation' END AS noun
    ) k
    WHERE m.id = p_membership_id AND k.noun IS NOT NULL
  ) s;
$$;

CREATE FUNCTION private.project_legacy_workspace(p_workspace_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_m public.membership;
BEGIN
  SELECT * INTO v_m FROM public.membership
  WHERE level = 'workspace' AND workspace_id = p_workspace_id AND user_id = p_user_id;

  IF v_m.id IS NULL THEN
    DELETE FROM public.workspace_membership
    WHERE workspace_id = p_workspace_id AND user_id = p_user_id;
    RETURN;
  END IF;

  -- mail_signature no es acceso: la proyección no la toca.
  INSERT INTO public.workspace_membership AS wm (
    workspace_id, user_id, role, accepted_at, invited_by, created_at
  ) VALUES (
    v_m.workspace_id, v_m.user_id, v_m.workspace_role, v_m.accepted_at, v_m.invited_by, v_m.created_at
  )
  ON CONFLICT ON CONSTRAINT workspace_membership_workspace_id_user_id_key DO UPDATE SET
    role        = EXCLUDED.role,
    accepted_at = EXCLUDED.accepted_at,
    invited_by  = EXCLUDED.invited_by
  WHERE (wm.role, wm.accepted_at, wm.invited_by)
        IS DISTINCT FROM (EXCLUDED.role, EXCLUDED.accepted_at, EXCLUDED.invited_by);
END;
$$;

CREATE FUNCTION private.project_legacy_project(p_project_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  c_live   CONSTANT text[] := ARRAY[
    'edit:conversation', 'edit:membership', 'edit:money', 'edit:performance',
    'edit:project_meta', 'read:conversation', 'read:money', 'read:performance'
  ];
  v_m      public.membership;
  v_grants text[];
  v_revoke text[];
BEGIN
  SELECT * INTO v_m FROM public.membership
  WHERE level = 'project' AND project_id = p_project_id AND user_id = p_user_id;

  IF v_m.id IS NULL THEN
    DELETE FROM public.project_membership
    WHERE project_id = p_project_id AND user_id = p_user_id;
    RETURN;
  END IF;

  v_grants := private.legacy_project_grants(v_m.id);
  SELECT coalesce(array_agg(x ORDER BY x), '{}') INTO v_revoke
  FROM unnest(c_live) x WHERE x <> ALL (v_grants);

  -- Con los ocho explícitos, roles + grants − revokes da exactamente lo
  -- concedido, digan lo que digan los permisos de los roles.
  INSERT INTO public.project_membership AS pm (
    project_id, user_id, roles, permission_grants, permission_revokes, invited_by, created_at
  ) VALUES (
    p_project_id, p_user_id, v_m.roles, v_grants, v_revoke, v_m.invited_by, v_m.created_at
  )
  ON CONFLICT ON CONSTRAINT project_membership_project_id_user_id_key DO UPDATE SET
    roles              = EXCLUDED.roles,
    permission_grants  = EXCLUDED.permission_grants,
    permission_revokes = EXCLUDED.permission_revokes,
    invited_by         = EXCLUDED.invited_by
  WHERE (pm.roles, pm.permission_grants, pm.permission_revokes, pm.invited_by)
        IS DISTINCT FROM (EXCLUDED.roles, EXCLUDED.permission_grants, EXCLUDED.permission_revokes, EXCLUDED.invited_by);
END;
$$;

CREATE FUNCTION private.project_legacy_pair(
  p_level public.container_level, p_workspace_id uuid, p_project_id uuid, p_user_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_level = 'workspace' THEN
    PERFORM private.project_legacy_workspace(p_workspace_id, p_user_id);
  ELSIF p_level = 'project' THEN
    PERFORM private.project_legacy_project(p_project_id, p_user_id);
  END IF;
END;
$$;

CREATE FUNCTION private.membership_to_legacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM private.project_legacy_pair(OLD.level, OLD.workspace_id, OLD.project_id, OLD.user_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM private.project_legacy_pair(NEW.level, NEW.workspace_id, NEW.project_id, NEW.user_id);
  END IF;
  RETURN NULL;
END;
$$;

-- Una faceta cambia lo que concede su membresía de proyecto. Si la membresía
-- ya no existe (borrado en cascada), su propio trigger ya proyectó.
CREATE FUNCTION private.membership_facet_to_legacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT m.project_id, m.user_id
    FROM public.membership m
    WHERE m.level = 'project'
      AND m.id IN (
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.membership_id END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.membership_id END
      )
  LOOP
    PERFORM private.project_legacy_project(r.project_id, r.user_id);
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.legacy_project_grants(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.project_legacy_workspace(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.project_legacy_project(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.project_legacy_pair(public.container_level, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.membership_to_legacy() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.membership_facet_to_legacy() FROM PUBLIC;

CREATE TRIGGER membership_project_legacy
  AFTER INSERT OR UPDATE OR DELETE ON public.membership
  FOR EACH ROW EXECUTE FUNCTION private.membership_to_legacy();
CREATE TRIGGER membership_facet_project_legacy
  AFTER INSERT OR UPDATE OR DELETE ON public.membership_facet
  FOR EACH ROW EXECUTE FUNCTION private.membership_facet_to_legacy();

-- ── 2 · el espejo se apaga; la validación de etiquetas pasa a membership ──
DROP TRIGGER workspace_membership_mirror_access ON public.workspace_membership;
DROP TRIGGER project_membership_mirror_access ON public.project_membership;
DROP TRIGGER workspace_role_mirror_access ON public.workspace_role;
DROP TRIGGER project_membership_validate_roles ON public.project_membership;

-- Solo las etiquetas NUEVAS de una fila: un rol archivado después no bloquea
-- ninguna escritura de esa membresía.
CREATE FUNCTION private.validate_membership_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_code text;
BEGIN
  FOR v_code IN
    SELECT r FROM unnest(NEW.roles) r
    EXCEPT
    SELECT r FROM unnest(CASE WHEN TG_OP = 'UPDATE' THEN OLD.roles ELSE '{}'::text[] END) r
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_role wr
      WHERE wr.workspace_id = NEW.workspace_id AND wr.code = v_code AND wr.archived_at IS NULL
    ) THEN
      RAISE EXCEPTION 'unknown or archived role: % (workspace %)', v_code, NEW.workspace_id
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_membership_roles() FROM PUBLIC;
CREATE TRIGGER membership_validate_roles
  BEFORE INSERT OR UPDATE OF roles ON public.membership
  FOR EACH ROW EXECUTE FUNCTION private.validate_membership_roles();

COMMENT ON TABLE public.membership IS
  'Membresía por nivel de contenedor (ADR-082). Estar es ver el contenedor y su hilo General. Desde la fase 3 es la única fuente: workspace_membership y project_membership son su proyección (trigger membership_project_legacy) hasta el contract.';
COMMENT ON COLUMN public.membership.can_manage_members IS
  'edit:membership. No gatea nada desde la fase 3 (invitar no es una capacidad, manda el techo del delegante, ADR-100 §3); se sigue escribiendo para la paridad hasta el contract.';
COMMENT ON TABLE public.workspace_membership IS
  'Proyección de membership (nivel workspace) desde la fase 3 de facetas: no se escribe directamente salvo mail_signature. El contract decide qué queda.';
COMMENT ON TABLE public.project_membership IS
  'Proyección de membership (nivel project) desde la fase 3 de facetas: grants = lo concedido, revokes = el resto de los ocho permisos vivos. No se escribe directamente. Muere en el contract.';

-- ── 3 · las tablas viejas, cerradas a la API ──────────────────────────────
REVOKE INSERT, UPDATE, DELETE ON public.project_membership FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.workspace_membership FROM anon, authenticated;

-- ── 4 · el techo, sin can_manage_members; y quién gestiona una membresía ──
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

  -- Invitar no es una capacidad (ADR-100 §3): can_manage_members ya no cuenta.
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

CREATE FUNCTION private.membership_container_id(p_m public.membership)
RETURNS uuid
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE p_m.level
    WHEN 'workspace'   THEN p_m.workspace_id
    WHEN 'project'     THEN p_m.project_id
    WHEN 'line'        THEN p_m.line_id
    WHEN 'bolo'        THEN p_m.bolo_id
    WHEN 'performance' THEN p_m.performance_id
  END;
$$;

-- Gestiona una membresía ajena el admin del espacio, o quien podría haberla
-- dado: su acceso al contenedor, sus metadatos y cada faceta caben en su techo
-- (ADR-085 §10 aplicado también a quitar; plan § 8.6, punto 2). La del
-- espacio, solo el admin.
CREATE FUNCTION private.can_manage_membership(p_membership_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_m    public.membership;
  v_id   uuid;
  v_verb public.access_verb;
BEGIN
  SELECT * INTO v_m FROM public.membership WHERE id = p_membership_id;
  IF v_m.id IS NULL OR p_user_id IS NULL THEN
    RETURN false;
  END IF;
  IF private.model_has_workspace_role(v_m.workspace_id, p_user_id, ARRAY['owner', 'admin']::public.membership_role[]) THEN
    RETURN true;
  END IF;
  IF v_m.level = 'workspace' THEN
    RETURN false;
  END IF;

  v_id := private.membership_container_id(v_m);
  v_verb := private.model_container_verb_at(v_m.level, v_id, p_user_id);
  IF v_verb IS NULL OR (v_m.container_verb = 'edit' AND v_verb <> 'edit') THEN
    RETURN false;
  END IF;
  IF v_m.can_edit_meta AND NOT coalesce((
    SELECT bool_or(c.can_edit_meta) FROM private.chain_memberships(v_m.level, v_id, p_user_id) c
  ), false) THEN
    RETURN false;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM public.membership_facet mf
    WHERE mf.membership_id = v_m.id
      AND NOT private.model_has_facet_at(v_m.level, v_id, mf.facet_id, mf.verb, p_user_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION private.membership_container_id(public.membership) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_manage_membership(uuid, uuid) FROM PUBLIC;

-- ── 5 · paquetes en todos los niveles, overrides y revocar ────────────────
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
                                   user_id, accepted_at, invited_by)
    VALUES (v_ws, p_level,
            CASE WHEN p_level = 'project' THEN p_container_id END,
            CASE WHEN p_level = 'line' THEN p_container_id END,
            CASE WHEN p_level = 'bolo' THEN p_container_id END,
            CASE WHEN p_level = 'performance' THEN p_container_id END,
            p_user_id, now(), v_caller)
    RETURNING id INTO v_id;
  ELSIF NOT private.can_manage_membership(v_id, v_caller) THEN
    RAISE EXCEPTION 'you can only change what you could have granted' USING ERRCODE = '42501';
  END IF;

  PERFORM private.expand_preset(v_id, p_preset, v_caller);
  RETURN v_id;
END;
$$;

-- Override de una faceta en una membresía; p_verb NULL la quita. No en el
-- espacio: Diners o Converses ahí valdrían en todos los proyectos (§ 8.5).
CREATE FUNCTION public.set_membership_facet(
  p_membership_id uuid, p_facet_id uuid, p_verb public.access_verb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_m      public.membership;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_m FROM public.membership WHERE id = p_membership_id;
  IF v_m.id IS NULL OR NOT private.can_manage_membership(v_m.id, v_caller) THEN
    RAISE EXCEPTION 'membership not found' USING ERRCODE = '42501';
  END IF;
  IF v_m.level = 'workspace' THEN
    RAISE EXCEPTION 'workspace-level facets are not decided yet' USING ERRCODE = '0A000';
  END IF;

  IF p_verb IS NULL THEN
    DELETE FROM public.membership_facet
    WHERE membership_id = v_m.id AND facet_id = p_facet_id;
    RETURN;
  END IF;

  IF NOT private.model_has_facet_at(v_m.level, private.membership_container_id(v_m), p_facet_id, p_verb, v_caller) THEN
    RAISE EXCEPTION 'you can only grant what you hold' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.membership_facet (membership_id, facet_id, verb, source, granted_by)
  VALUES (v_m.id, p_facet_id, p_verb, 'override', v_caller)
  ON CONFLICT (membership_id, facet_id) DO UPDATE SET
    verb       = EXCLUDED.verb,
    source     = 'override',
    granted_by = EXCLUDED.granted_by;
END;
$$;

-- Quita una membresía de proyecto, línea, bolo o función. Lo que cuelga debajo
-- se queda: una membresía de bolo existe sin la de proyecto.
CREATE FUNCTION public.revoke_membership(p_membership_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_m      public.membership;
BEGIN
  SELECT * INTO v_m FROM public.membership WHERE id = p_membership_id;
  IF v_caller IS NULL OR v_m.id IS NULL OR NOT private.can_manage_membership(v_m.id, v_caller) THEN
    RAISE EXCEPTION 'membership not found' USING ERRCODE = '42501';
  END IF;
  IF v_m.level = 'workspace' THEN
    RAISE EXCEPTION 'a workspace membership is revoked with revoke_workspace_member' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.membership WHERE id = v_m.id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_membership_facet(uuid, uuid, public.access_verb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_membership(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_membership_facet(uuid, uuid, public.access_verb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_membership(uuid) TO authenticated;

-- ── 6 · las RPC que escribían las tablas viejas ───────────────────────────
-- · handle_new_user: mismo cuerpo; la membresía de dueño va a membership.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_full_name    text;
  v_slug         text;
  v_account_slug text;
  v_account_id   uuid;
  v_workspace_id uuid;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1));

  INSERT INTO public.user_profile (user_id, full_name, locale)
  VALUES (NEW.id, v_full_name, COALESCE(NEW.raw_user_meta_data ->> 'locale', 'es'))
  ON CONFLICT (user_id) DO NOTHING;

  -- ADR-067: personal workspace gets a machine short-id, not the email
  -- local-part — no signup can ever fight another over a name.
  v_slug := public.generate_workspace_sid();

  v_account_slug := v_slug || '-acc';
  WHILE EXISTS (SELECT 1 FROM public.account WHERE slug = v_account_slug AND deleted_at IS NULL) LOOP
    v_account_slug := v_slug || '-acc-' || substr(gen_random_uuid()::text, 1, 4);
  END LOOP;

  INSERT INTO public.account (slug, name, kind)
  VALUES (v_account_slug, v_full_name, 'personal')
  RETURNING id INTO v_account_id;

  INSERT INTO public.account_membership (account_id, user_id, role, accepted_at)
  VALUES (v_account_id, NEW.id, 'owner', now());

  INSERT INTO public.workspace (slug, name, kind, account_id)
  VALUES (v_slug, v_full_name, 'personal', v_account_id)
  RETURNING id INTO v_workspace_id;

  INSERT INTO public.membership (workspace_id, level, user_id, workspace_role, accepted_at)
  VALUES (v_workspace_id, 'workspace', NEW.id, 'owner', now());

  RETURN NEW;
END;
$function$;

-- · create_workspace: ídem.
CREATE OR REPLACE FUNCTION public.create_workspace(p_name text, p_slug text DEFAULT NULL::text, p_accent text DEFAULT NULL::text, p_description text DEFAULT NULL::text)
 RETURNS workspace
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller      uuid := auth.uid();
  v_account_id  uuid;
  v_accent      text;
  v_description text;
  v_workspace   public.workspace;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'name cannot be empty' USING ERRCODE = '22023';
  END IF;

  SELECT a.id INTO v_account_id
  FROM public.account a
  JOIN public.account_membership am ON am.account_id = a.id
  WHERE a.kind = 'personal'
    AND a.deleted_at IS NULL
    AND am.user_id = v_caller
    AND am.role = 'owner'
    AND am.accepted_at IS NOT NULL
    AND am.revoked_at IS NULL
  ORDER BY am.invited_at ASC
  LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'caller has no personal account — cannot create workspace'
      USING ERRCODE = '42501';
  END IF;

  v_accent := NULLIF(trim(COALESCE(p_accent, '')), '');
  v_description := NULLIF(trim(COALESCE(p_description, '')), '');

  -- ADR-067: identity is machine-chosen. p_slug is ignored (kept for
  -- signature compat); the pretty name goes to workspace.name and, if the
  -- client wants a pretty URL, through the alias request flow.
  INSERT INTO public.workspace (slug, name, kind, account_id, accent, description)
  VALUES (public.generate_workspace_sid(), trim(p_name), 'personal', v_account_id, v_accent, v_description)
  RETURNING * INTO v_workspace;

  INSERT INTO public.membership (workspace_id, level, user_id, workspace_role, accepted_at)
  VALUES (v_workspace.id, 'workspace', v_caller, 'owner', now());

  RETURN v_workspace;
END;
$function$;

-- · invitaciones: el proyecto llega con paquete (por defecto Mínim, ADR-085 §11).
ALTER TABLE public.workspace_invitation
  ADD COLUMN project_preset text REFERENCES public.access_preset (key) ON UPDATE CASCADE,
  ADD CONSTRAINT workspace_invitation_project_preset_needs_project
    CHECK (project_preset IS NULL OR project_id IS NOT NULL);
COMMENT ON COLUMN public.workspace_invitation.project_preset IS
  'Paquete que da la invitación en el proyecto (fase 3 de facetas). NULL en las de antes: al aceptarse dan Mínim (ADR-085 §11).';
CREATE INDEX workspace_invitation_project_preset_idx ON public.workspace_invitation (project_preset);

-- La firma vieja se borra para que PostgREST no vea dos funciones con los
-- mismos argumentos con nombre; el Worker desplegado llama con seis y el
-- séptimo tiene defecto.
DROP FUNCTION public.create_workspace_invitation(uuid, text, public.membership_role, uuid, text, integer);

CREATE FUNCTION public.create_workspace_invitation(
  p_workspace_id uuid,
  p_email text,
  p_role public.membership_role DEFAULT 'guest'::public.membership_role,
  p_project_id uuid DEFAULT NULL::uuid,
  p_project_role_code text DEFAULT NULL::text,
  p_expires_days integer DEFAULT 7,
  p_project_preset text DEFAULT NULL::text
)
 RETURNS TABLE(id uuid, email text, role membership_role, project_id uuid, project_role_code text, expires_at timestamp with time zone, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_email text := lower(btrim(p_email));
  v_token text;
  v_invitation public.workspace_invitation%ROWTYPE;
BEGIN
  IF v_caller IS NULL OR NOT public.is_workspace_admin(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace admin required' USING ERRCODE = '42501';
  END IF;
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'valid email required' USING ERRCODE = '22023';
  END IF;
  IF p_role = 'owner' THEN
    RAISE EXCEPTION 'owner transfer is a separate operation' USING ERRCODE = '22023';
  END IF;
  IF p_expires_days < 1 OR p_expires_days > 30 THEN
    RAISE EXCEPTION 'expiry must be between 1 and 30 days' USING ERRCODE = '22023';
  END IF;
  IF (p_project_id IS NULL) <> (p_project_role_code IS NULL) THEN
    RAISE EXCEPTION 'project and project role must be supplied together'
      USING ERRCODE = '22023';
  END IF;
  IF p_project_preset IS NOT NULL AND (
       p_project_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.access_preset ap WHERE ap.key = p_project_preset)
     ) THEN
    RAISE EXCEPTION 'project preset needs a project and must exist' USING ERRCODE = '22023';
  END IF;
  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.project p
    JOIN public.workspace_role wr
      ON wr.workspace_id = p.workspace_id
     AND wr.code = p_project_role_code
     AND wr.archived_at IS NULL
    WHERE p.id = p_project_id
      AND p.workspace_id = p_workspace_id
      AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'project role does not belong to this workspace'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.workspace_invitation wi
  SET revoked_at = now()
  WHERE wi.workspace_id = p_workspace_id
    AND lower(wi.email::text) = v_email
    AND wi.accepted_at IS NULL
    AND wi.revoked_at IS NULL;

  v_token := replace(replace(rtrim(encode(gen_random_bytes(32), 'base64'), '='), '+', '-'), '/', '_');
  INSERT INTO public.workspace_invitation (
    workspace_id, email, role, project_id, project_role_code, project_preset, token_hash,
    invited_by, expires_at
  ) VALUES (
    p_workspace_id, v_email, p_role, p_project_id, p_project_role_code,
    CASE WHEN p_project_id IS NOT NULL THEN coalesce(p_project_preset, 'minim') END,
    encode(digest(v_token, 'sha256'), 'hex'), v_caller,
    now() + make_interval(days => p_expires_days)
  )
  RETURNING * INTO v_invitation;

  RETURN QUERY SELECT
    v_invitation.id,
    v_invitation.email::text,
    v_invitation.role,
    v_invitation.project_id,
    v_invitation.project_role_code,
    v_invitation.expires_at,
    v_token;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_workspace_invitation(uuid, text, public.membership_role, uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_workspace_invitation(uuid, text, public.membership_role, uuid, text, integer, text) TO authenticated;

-- · accept_workspace_invitation: la fila de espacio en membership; lo que
-- estuviera pendiente debajo hereda la aceptación; con proyecto, una
-- membresía nueva con la etiqueta y el paquete, o solo la etiqueta si ya era
-- miembro (una invitación no rebaja ni sube a nadie).
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
        workspace_id, level, project_id, user_id, roles, accepted_at, invited_by
      ) VALUES (
        v_invitation.workspace_id, 'project', v_invitation.project_id, v_caller,
        ARRAY[v_invitation.project_role_code]::text[], v_accepted, v_invitation.invited_by
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

-- · list_workspace_access: los miembros salen de membership (ids de membership).
CREATE OR REPLACE FUNCTION public.list_workspace_access(p_workspace_id uuid)
 RETURNS TABLE(access_kind text, id uuid, user_id uuid, email text, display_name text, role membership_role, project_id uuid, project_name text, project_role_code text, status text, accepted_at timestamp with time zone, expires_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_workspace_admin(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace admin required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT 'member'::text,
         m.id,
         m.user_id,
         au.email::text,
         coalesce(up.full_name, au.raw_user_meta_data->>'full_name', au.email::text),
         m.workspace_role,
         NULL::uuid,
         NULL::text,
         NULL::text,
         CASE WHEN m.accepted_at IS NULL THEN 'pending' ELSE 'active' END,
         m.accepted_at,
         NULL::timestamptz,
         m.created_at
  FROM public.membership m
  JOIN auth.users au ON au.id = m.user_id
  LEFT JOIN public.user_profile up ON up.user_id = m.user_id
  WHERE m.level = 'workspace' AND m.workspace_id = p_workspace_id

  UNION ALL

  SELECT 'invitation'::text,
         wi.id,
         wi.accepted_by,
         wi.email::text,
         wi.email::text,
         wi.role,
         wi.project_id,
         p.name,
         wi.project_role_code,
         CASE
           WHEN wi.accepted_at IS NOT NULL THEN 'accepted'
           WHEN wi.revoked_at IS NOT NULL THEN 'revoked'
           WHEN wi.expires_at <= now() THEN 'expired'
           ELSE 'pending'
         END,
         wi.accepted_at,
         wi.expires_at,
         wi.created_at
  FROM public.workspace_invitation wi
  LEFT JOIN public.project p ON p.id = wi.project_id
  WHERE wi.workspace_id = p_workspace_id
  ORDER BY created_at DESC;
END;
$function$;

-- · update_workspace_member_role: por id de membership de espacio.
CREATE OR REPLACE FUNCTION public.update_workspace_member_role(p_membership_id uuid, p_role membership_role)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_target public.membership%ROWTYPE;
BEGIN
  SELECT * INTO v_target FROM public.membership
  WHERE id = p_membership_id AND level = 'workspace';
  IF v_target.id IS NULL OR NOT public.is_workspace_admin(v_target.workspace_id) THEN
    RAISE EXCEPTION 'membership not found' USING ERRCODE = '42501';
  END IF;
  IF v_target.workspace_role = 'owner' OR p_role = 'owner' THEN
    RAISE EXCEPTION 'owner transfer is a separate operation' USING ERRCODE = '42501';
  END IF;
  UPDATE public.membership
  SET workspace_role = p_role
  WHERE id = p_membership_id;
END;
$function$;

-- · revoke_workspace_member: por id de membership de espacio; quita a la
-- persona de todos los contenedores del espacio.
CREATE OR REPLACE FUNCTION public.revoke_workspace_member(p_membership_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_target public.membership%ROWTYPE;
  v_caller_role public.membership_role;
BEGIN
  SELECT * INTO v_target FROM public.membership
  WHERE id = p_membership_id AND level = 'workspace';
  IF v_target.id IS NULL OR NOT public.is_workspace_admin(v_target.workspace_id) THEN
    RAISE EXCEPTION 'membership not found' USING ERRCODE = '42501';
  END IF;
  v_caller_role := private.model_workspace_role(v_target.workspace_id, v_caller);

  IF v_target.workspace_role = 'owner' THEN
    IF v_caller_role <> 'owner' OR (
      SELECT count(*) FROM public.membership
      WHERE level = 'workspace'
        AND workspace_id = v_target.workspace_id
        AND workspace_role = 'owner'
        AND accepted_at IS NOT NULL
    ) <= 1 THEN
      RAISE EXCEPTION 'the last owner cannot be revoked' USING ERRCODE = '42501';
    END IF;
  END IF;

  DELETE FROM public.membership
  WHERE workspace_id = v_target.workspace_id AND user_id = v_target.user_id;
END;
$function$;

-- ── 7 · proyectar una vez, y la migración no se aplica si la paridad no es 0 ─
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT 'workspace'::public.container_level AS level, x.workspace_id, NULL::uuid AS project_id, x.user_id
    FROM (
      SELECT m.workspace_id, m.user_id FROM public.membership m WHERE m.level = 'workspace'
      UNION
      SELECT wm.workspace_id, wm.user_id FROM public.workspace_membership wm
    ) x
    UNION ALL
    SELECT 'project'::public.container_level, p.workspace_id, x.project_id, x.user_id
    FROM (
      SELECT m.project_id, m.user_id FROM public.membership m WHERE m.level = 'project'
      UNION
      SELECT pm.project_id, pm.user_id FROM public.project_membership pm
    ) x
    JOIN public.project p ON p.id = x.project_id
  LOOP
    PERFORM private.project_legacy_pair(r.level, r.workspace_id, r.project_id, r.user_id);
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_count  integer;
  v_detail text;
BEGIN
  CREATE TEMP TABLE permissions_facets_writes_parity ON COMMIT DROP AS
    SELECT * FROM private.access_parity_mismatches();

  SELECT count(*) INTO v_count FROM permissions_facets_writes_parity;
  SELECT string_agg(format('%s %s %s %s legacy=%s model=%s',
                           m.user_id, m.workspace_id, coalesce(m.project_id::text, '-'),
                           m.probe, m.legacy, m.model), E'\n')
  INTO v_detail
  FROM (SELECT * FROM permissions_facets_writes_parity LIMIT 50) m;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'permissions_facets_writes: % parity mismatch(es); nothing applied', v_count
      USING DETAIL = v_detail;
  END IF;
END;
$$;
