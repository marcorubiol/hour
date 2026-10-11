-- Permisos al modelo de facetas, fase EXPAND (ADR-099 §8; ADR-082, ADR-083,
-- ADR-085; plan completo en build/permissions-facets-plan.md).
--
-- ADR-099 §8: todo el sistema de permisos pasa al modelo nuevo, en
-- expand/contract, con una sola fuente de verdad al final. Esta migración es
-- SOLO el expand: crea el modelo nuevo, lo rellena desde el actual y lo
-- mantiene en espejo. NINGUNA lectura existente cambia: has_permission, las
-- políticas, las RPC y el Worker siguen leyendo workspace_membership,
-- project_membership y workspace_role exactamente como antes.
--
-- WHAT THIS DOES:
--   1. Vocabulario: `container_level` (workspace, project, line, bolo) y
--      `access_verb` (view, edit; edit implica view, ADR-082 §4).
--   2. `facet` + `facet_level`: las seis facetas y la tabla de niveles de la
--      enmienda de ADR-082, COMO FILAS (mover una faceta de nivel es un
--      UPDATE). La cuarta columna es el bolo (ADR-099 §6: el tablón cuelga del
--      bolo). `General` no está: es la membresía.
--   3. `access_preset`: los cuatro paquetes (Mínim, Equip, Coordinació,
--      Direcció) como nombres. Su contenido NO está decidido y no se escribe
--      aquí (plan § Paquetes).
--   4. `membership`: una fila por persona con login y contenedor. Lleva lo que
--      no es faceta: el rol del espacio (owner..guest), el acceso al propio
--      contenedor (`container_verb`, hoy read/edit:performance), y dos
--      capacidades (`can_edit_meta` = edit:project_meta,
--      `can_manage_members` = edit:membership). `roles` guarda los códigos de
--      rol como ETIQUETA (ADR-082: el rol no da poder).
--   5. `membership_facet`: las filas de faceta (Diners = read/edit:money,
--      Converses = read/edit:conversation), con `source` (legacy hoy;
--      preset y override cuando exista la RPC de paquetes). Un trigger impide
--      escribir una faceta en un nivel donde no existe (hallazgo abierto del
--      review de julio).
--   6. Lectores del modelo nuevo en `private` (no expuestos): responden las
--      MISMAS preguntas que los lectores actuales. La fase 2 cambia el cuerpo
--      de los lectores actuales por estos, sin reescribir políticas.
--   7. Espejo: triggers en workspace_membership, project_membership y
--      workspace_role que recalculan las filas nuevas de la pareja tocada.
--   8. Relleno desde el estado actual.
--   9. Paridad: `private.access_parity_mismatches()` compara, para cada
--      persona y cada proyecto o espacio, la respuesta actual y la nueva. La
--      migración ABORTA si hay una sola diferencia: si producción guarda un
--      estado que el modelo no representa, no se aplica nada.
--  10. Dos RPC de solo comprobación, para los tests: `has_permission_by_facets`
--      (la del que llama, como has_permission) y `access_parity_report`
--      (solo service_role). Mueren en el contract.
--
-- RLS: las tablas nuevas se leen (vocabulario: cualquiera autenticado;
-- membresías y facetas: las propias, o todas si eres owner/admin del espacio,
-- el patrón de workspace_membership_select). Nadie escribe por la API: sin
-- GRANT de escritura y sin política de escritura. Escriben solo los triggers.
--
-- ADITIVA según § 34: tipos, tablas y funciones nuevas, y triggers AFTER en
-- tres tablas que solo escriben en las tablas nuevas. El Worker desplegado no
-- lee nada de esto.
-- Rollback: build/runbooks/rollback-20261011-permissions-facets-expand.sql.

-- ── 1 · vocabulario ───────────────────────────────────────────────────────
CREATE TYPE public.container_level AS ENUM ('workspace', 'project', 'line', 'bolo');
COMMENT ON TYPE public.container_level IS
  'Niveles de contenedor donde se puede ser miembro y tener facetas (ADR-082 enmienda 2026-07-20). El cuarto es el bolo (ADR-099 §6).';

CREATE TYPE public.access_verb AS ENUM ('view', 'edit');
COMMENT ON TYPE public.access_verb IS
  'veure | veure+editar (ADR-082 §4). edit implica view. No hay `none`: la ausencia de fila es «res».';

-- ── 2 · facetas, como datos ───────────────────────────────────────────────
CREATE TABLE public.facet (
  key        text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,31}$'),
  sort       smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.facet IS
  'Vocabulario cerrado de facetas (ADR-083 §4): nombra un subhilo, es la unidad de permiso y la etiqueta. Las etiquetas visibles son claves i18n. General NO está: es la membresía.';

CREATE TABLE public.facet_level (
  facet_key text NOT NULL REFERENCES public.facet (key) ON DELETE CASCADE ON UPDATE CASCADE,
  level     public.container_level NOT NULL,
  PRIMARY KEY (facet_key, level)
);
COMMENT ON TABLE public.facet_level IS
  'En qué nivel existe cada faceta. Mover una faceta de nivel es una fila (ADR-082 enmienda §6). Ausente no es denegado: sin fila, la faceta no está en ese nivel.';

INSERT INTO public.facet (key, sort) VALUES
  ('converses',   10),
  ('materials',   20),
  ('tecnica',     30),
  ('logistica',   40),
  ('full_de_ruta', 50),
  ('diners',      60);

INSERT INTO public.facet_level (facet_key, level) VALUES
  ('converses',    'workspace'), ('converses', 'project'), ('converses', 'line'),
  ('materials',    'project'),   ('materials', 'line'),    ('materials', 'bolo'),
  ('tecnica',      'project'),   ('tecnica',   'line'),    ('tecnica',   'bolo'),
  ('logistica',    'line'),      ('logistica', 'bolo'),
  ('full_de_ruta', 'bolo'),
  ('diners',       'workspace'), ('diners',    'project'), ('diners',    'line'), ('diners', 'bolo');

-- ── 3 · paquetes (solo los nombres) ───────────────────────────────────────
CREATE TABLE public.access_preset (
  key  text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,31}$'),
  sort smallint NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.access_preset IS
  'Escalera de paquetes (ADR-082 enmienda §2). Un paquete se EXPANDE en filas de membership_facet al conceder; su contenido llega con la RPC de paquetes (fase 2), no aquí.';

INSERT INTO public.access_preset (key, sort) VALUES
  ('minim', 10), ('equip', 20), ('coordinacio', 30), ('direccio', 40);

-- ── 4 · membresía ─────────────────────────────────────────────────────────
CREATE TABLE public.membership (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id       uuid NOT NULL REFERENCES public.workspace (id) ON DELETE CASCADE,
  level              public.container_level NOT NULL,
  project_id         uuid REFERENCES public.project (id) ON DELETE CASCADE,
  line_id            uuid REFERENCES public.line (id) ON DELETE CASCADE,
  bolo_id            uuid REFERENCES public.bolo (id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  workspace_role     public.membership_role,
  container_verb     public.access_verb,
  can_edit_meta      boolean NOT NULL DEFAULT false,
  can_manage_members boolean NOT NULL DEFAULT false,
  roles              text[] NOT NULL DEFAULT '{}',
  preset             text REFERENCES public.access_preset (key) ON UPDATE CASCADE,
  accepted_at        timestamptz,
  invited_by         uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_level_shape CHECK (
       (level = 'workspace' AND project_id IS NULL AND line_id IS NULL AND bolo_id IS NULL
          AND workspace_role IS NOT NULL)
    OR (level = 'project'   AND project_id IS NOT NULL AND line_id IS NULL AND bolo_id IS NULL
          AND workspace_role IS NULL)
    OR (level = 'line'      AND line_id IS NOT NULL AND project_id IS NULL AND bolo_id IS NULL
          AND workspace_role IS NULL)
    OR (level = 'bolo'      AND bolo_id IS NOT NULL AND project_id IS NULL AND line_id IS NULL
          AND workspace_role IS NULL)
  )
);

COMMENT ON TABLE public.membership IS
  'Membresía por nivel de contenedor (ADR-082). Estar es ver el contenedor y su hilo General. Expand: espejo de workspace_membership y project_membership, escrito solo por triggers.';
COMMENT ON COLUMN public.membership.workspace_role IS
  'Solo en el nivel workspace: owner | admin | member | viewer | guest, como hoy. owner/admin lo ven todo (la misma regla que has_permission).';
COMMENT ON COLUMN public.membership.container_verb IS
  'Acceso al propio contenedor (calendario, funciones, fechas, líneas, reparto, equipo, horarios, viajes, materiales): view = read:performance, edit = edit:performance. NULL solo en filas heredadas sin ese permiso; el contract decide si ese estado sigue existiendo (plan § Riesgos).';
COMMENT ON COLUMN public.membership.roles IS
  'Códigos de rol como etiqueta (ADR-082: el rol es lo que haces, no lo que puedes). En expand es copia de project_membership.roles.';
COMMENT ON COLUMN public.membership.preset IS
  'Paquete del que se expandieron las facetas. NULL en las filas heredadas.';

CREATE UNIQUE INDEX membership_workspace_user_key ON public.membership (workspace_id, user_id) WHERE level = 'workspace';
CREATE UNIQUE INDEX membership_project_user_key   ON public.membership (project_id, user_id)   WHERE level = 'project';
CREATE UNIQUE INDEX membership_line_user_key      ON public.membership (line_id, user_id)      WHERE level = 'line';
CREATE UNIQUE INDEX membership_bolo_user_key      ON public.membership (bolo_id, user_id)      WHERE level = 'bolo';
CREATE INDEX membership_user_idx       ON public.membership (user_id);
CREATE INDEX membership_invited_by_idx ON public.membership (invited_by);
CREATE INDEX membership_preset_idx     ON public.membership (preset);

CREATE TRIGGER membership_guard_ws BEFORE UPDATE ON public.membership
  FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_workspace_id();
CREATE TRIGGER membership_set_updated_at BEFORE UPDATE ON public.membership
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 5 · filas de faceta ───────────────────────────────────────────────────
CREATE TABLE public.membership_facet (
  membership_id uuid NOT NULL REFERENCES public.membership (id) ON DELETE CASCADE,
  facet_key     text NOT NULL REFERENCES public.facet (key) ON DELETE RESTRICT ON UPDATE CASCADE,
  verb          public.access_verb NOT NULL,
  source        text NOT NULL CHECK (source IN ('legacy', 'preset', 'override')),
  granted_by    uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, facet_key)
);
COMMENT ON TABLE public.membership_facet IS
  'Quién tiene qué faceta en qué contenedor. Sin fila = res. source: legacy (calculada desde los roles de hoy), preset (vino con el paquete), override (alguien la tocó a mano); la vista «de dónde sale cada permiso» de ADR-082 §4 lee esta columna.';
CREATE INDEX membership_facet_facet_idx      ON public.membership_facet (facet_key);
CREATE INDEX membership_facet_granted_by_idx ON public.membership_facet (granted_by);

-- La tabla de niveles se cumple al escribir, no solo al leer: no se puede
-- conceder una faceta donde no existe (ganancia de seguridad de la enmienda).
CREATE FUNCTION private.guard_membership_facet_level()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.membership m
    JOIN public.facet_level fl ON fl.level = m.level AND fl.facet_key = NEW.facet_key
    WHERE m.id = NEW.membership_id
  ) THEN
    RAISE EXCEPTION 'facet % does not exist at the level of membership %', NEW.facet_key, NEW.membership_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_membership_facet_level() FROM PUBLIC;

CREATE TRIGGER membership_facet_guard_level BEFORE INSERT OR UPDATE ON public.membership_facet
  FOR EACH ROW EXECUTE FUNCTION private.guard_membership_facet_level();

-- ── 6 · lectores del modelo nuevo ─────────────────────────────────────────
-- Mismas preguntas que los lectores actuales, con el usuario como parámetro.
-- La fase 2 los usa como cuerpo de has_permission_for_user, can_access_project
-- e is_workspace_*. Nada los llama todavía salvo la paridad y la RPC de test.

CREATE FUNCTION private.model_workspace_role(p_workspace_id uuid, p_user_id uuid)
RETURNS public.membership_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT m.workspace_role
  FROM public.membership m
  WHERE m.level = 'workspace'
    AND m.workspace_id = p_workspace_id
    AND m.user_id = p_user_id
    AND m.accepted_at IS NOT NULL;
$$;

-- Diners/Converses en un proyecto: fila en el proyecto o en el espacio (la
-- unión hacia abajo de ADR-082 §3), solo donde la faceta existe, y owner/admin
-- lo ven todo. Las filas de línea y bolo llegan con los hilos (fase 2).
CREATE FUNCTION private.model_has_facet(
  p_project_id uuid, p_facet text, p_verb public.access_verb, p_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
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
          JOIN public.membership_facet mf ON mf.membership_id = m.id AND mf.facet_key = p_facet
          JOIN public.facet_level fl ON fl.facet_key = p_facet AND fl.level = m.level
          WHERE m.user_id = p_user_id
            AND m.accepted_at IS NOT NULL
            AND (
                 (m.level = 'project'   AND m.project_id = p.id)
              OR (m.level = 'workspace' AND m.workspace_id = p.workspace_id)
            )
            AND (mf.verb = 'edit' OR mf.verb = p_verb)
        )
      )
  );
$$;

-- La traducción de cada permiso de hoy al modelo nuevo (plan § Equivalencias).
-- read:internal_notes y admin:project no tienen lector: solo el bypass de
-- owner/admin los contesta, como hoy.
CREATE FUNCTION private.model_has_permission(p_project_id uuid, p_perm text, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE p_perm
    WHEN 'read:money'        THEN private.model_has_facet(p_project_id, 'diners',    'view', p_user_id)
    WHEN 'edit:money'        THEN private.model_has_facet(p_project_id, 'diners',    'edit', p_user_id)
    WHEN 'read:conversation' THEN private.model_has_facet(p_project_id, 'converses', 'view', p_user_id)
    WHEN 'edit:conversation' THEN private.model_has_facet(p_project_id, 'converses', 'edit', p_user_id)
    ELSE p_user_id IS NOT NULL AND EXISTS (
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
                    WHEN 'read:performance'  THEN m.container_verb IS NOT NULL
                    WHEN 'edit:performance'  THEN m.container_verb = 'edit'
                    WHEN 'edit:project_meta' THEN m.can_edit_meta
                    WHEN 'edit:membership'   THEN m.can_manage_members
                    ELSE false
                  END
          )
        )
    )
  END;
$$;

CREATE FUNCTION private.model_can_access_project(p_project_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
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
          SELECT 1 FROM public.membership m
          WHERE m.level = 'project' AND m.project_id = p.id AND m.user_id = p_user_id
        )
      )
  );
$$;

CREATE FUNCTION private.model_can_read_workspace_money(p_workspace_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_workspace_id IS NOT NULL AND (
    coalesce(private.model_workspace_role(p_workspace_id, p_user_id) IN ('owner', 'admin'), false)
    OR EXISTS (
      SELECT 1 FROM public.project p
      WHERE p.workspace_id = p_workspace_id
        AND p.deleted_at IS NULL
        AND private.model_has_facet(p.id, 'diners', 'view', p_user_id)
    )
  );
$$;

REVOKE ALL ON FUNCTION private.model_workspace_role(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.model_has_facet(uuid, text, public.access_verb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.model_has_permission(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.model_can_access_project(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.model_can_read_workspace_money(uuid, uuid) FROM PUBLIC;

-- ── 7 · espejo ────────────────────────────────────────────────────────────
-- Recalcula la fila de proyecto de una pareja (proyecto, persona) desde
-- project_membership + workspace_role + workspace_membership. Es la misma
-- cuenta que has_permission_for_user: unión de los permisos de los roles no
-- archivados, más grants, menos revokes.
CREATE FUNCTION private.sync_project_access(p_project_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_pm        public.project_membership;
  v_ws        uuid;
  v_accepted  timestamptz;
  v_eff       text[];
  v_id        uuid;
BEGIN
  SELECT * INTO v_pm FROM public.project_membership
  WHERE project_id = p_project_id AND user_id = p_user_id;
  SELECT workspace_id INTO v_ws FROM public.project WHERE id = p_project_id;

  -- Sin membresía, sin proyecto o sin usuario (borrados en cascada): fuera.
  IF v_pm.id IS NULL OR v_ws IS NULL
     OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    DELETE FROM public.membership
    WHERE level = 'project' AND project_id = p_project_id AND user_id = p_user_id;
    RETURN;
  END IF;

  SELECT wm.accepted_at INTO v_accepted
  FROM public.workspace_membership wm
  WHERE wm.workspace_id = v_ws AND wm.user_id = p_user_id;

  SELECT coalesce(array_agg(e.permission), '{}') INTO v_eff
  FROM (
    SELECT unnest(wr.permissions) AS permission
    FROM public.workspace_role wr
    WHERE wr.workspace_id = v_ws
      AND wr.code = ANY (v_pm.roles)
      AND wr.archived_at IS NULL
    UNION
    SELECT unnest(v_pm.permission_grants)
    EXCEPT
    SELECT unnest(v_pm.permission_revokes)
  ) e;

  INSERT INTO public.membership AS m (
    workspace_id, level, project_id, user_id,
    container_verb, can_edit_meta, can_manage_members, roles,
    accepted_at, invited_by, created_at
  ) VALUES (
    v_ws, 'project', p_project_id, p_user_id,
    CASE WHEN 'edit:performance' = ANY (v_eff) THEN 'edit'::public.access_verb
         WHEN 'read:performance' = ANY (v_eff) THEN 'view'::public.access_verb END,
    'edit:project_meta' = ANY (v_eff),
    'edit:membership'   = ANY (v_eff),
    v_pm.roles,
    v_accepted, v_pm.invited_by, v_pm.created_at
  )
  ON CONFLICT (project_id, user_id) WHERE level = 'project' DO UPDATE SET
    container_verb     = EXCLUDED.container_verb,
    can_edit_meta      = EXCLUDED.can_edit_meta,
    can_manage_members = EXCLUDED.can_manage_members,
    roles              = EXCLUDED.roles,
    accepted_at        = EXCLUDED.accepted_at,
    invited_by         = EXCLUDED.invited_by
  RETURNING m.id INTO v_id;

  DELETE FROM public.membership_facet WHERE membership_id = v_id AND source = 'legacy';

  INSERT INTO public.membership_facet (membership_id, facet_key, verb, source)
  SELECT v_id, f.facet_key, f.verb, 'legacy'
  FROM (VALUES
    ('diners',
     CASE WHEN 'edit:money' = ANY (v_eff) THEN 'edit'::public.access_verb
          WHEN 'read:money' = ANY (v_eff) THEN 'view'::public.access_verb END),
    ('converses',
     CASE WHEN 'edit:conversation' = ANY (v_eff) THEN 'edit'::public.access_verb
          WHEN 'read:conversation' = ANY (v_eff) THEN 'view'::public.access_verb END)
  ) AS f (facet_key, verb)
  WHERE f.verb IS NOT NULL;
END;
$$;

-- La fila de espacio de una pareja (espacio, persona), y después sus filas de
-- proyecto en ese espacio: llevan la aceptación del espacio, como hoy
-- has_permission exige workspace_membership.accepted_at.
CREATE FUNCTION private.sync_workspace_access(p_workspace_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_wm public.workspace_membership;
  r    record;
BEGIN
  SELECT * INTO v_wm FROM public.workspace_membership
  WHERE workspace_id = p_workspace_id AND user_id = p_user_id;

  IF v_wm.id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.workspace w WHERE w.id = p_workspace_id)
     OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    DELETE FROM public.membership
    WHERE level = 'workspace' AND workspace_id = p_workspace_id AND user_id = p_user_id;
  ELSE
    INSERT INTO public.membership (
      workspace_id, level, user_id, workspace_role, accepted_at, invited_by, created_at
    ) VALUES (
      p_workspace_id, 'workspace', p_user_id, v_wm.role, v_wm.accepted_at, v_wm.invited_by, v_wm.created_at
    )
    ON CONFLICT (workspace_id, user_id) WHERE level = 'workspace' DO UPDATE SET
      workspace_role = EXCLUDED.workspace_role,
      accepted_at    = EXCLUDED.accepted_at,
      invited_by     = EXCLUDED.invited_by;
  END IF;

  FOR r IN
    SELECT pm.project_id
    FROM public.project_membership pm
    JOIN public.project p ON p.id = pm.project_id
    WHERE p.workspace_id = p_workspace_id AND pm.user_id = p_user_id
  LOOP
    PERFORM private.sync_project_access(r.project_id, p_user_id);
  END LOOP;
END;
$$;

CREATE FUNCTION private.mirror_workspace_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM private.sync_workspace_access(OLD.workspace_id, OLD.user_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM private.sync_workspace_access(NEW.workspace_id, NEW.user_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION private.mirror_project_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM private.sync_project_access(OLD.project_id, OLD.user_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM private.sync_project_access(NEW.project_id, NEW.user_id);
  END IF;
  RETURN NULL;
END;
$$;

-- Cambiar los permisos, el código o el archivo de un rol cambia el acceso de
-- quien lo lleva en cualquier proyecto del espacio.
CREATE FUNCTION private.mirror_workspace_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_ws    uuid := coalesce(NEW.workspace_id, OLD.workspace_id);
  v_codes text[] := array_remove(ARRAY[OLD.code, NEW.code], NULL);
  r       record;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.code IS NOT DISTINCT FROM OLD.code
     AND NEW.permissions IS NOT DISTINCT FROM OLD.permissions
     AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at THEN
    RETURN NULL;
  END IF;
  FOR r IN
    SELECT pm.project_id, pm.user_id
    FROM public.project_membership pm
    JOIN public.project p ON p.id = pm.project_id
    WHERE p.workspace_id = v_ws AND pm.roles && v_codes
  LOOP
    PERFORM private.sync_project_access(r.project_id, r.user_id);
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_project_access(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.sync_workspace_access(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.mirror_workspace_membership() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.mirror_project_membership() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.mirror_workspace_role() FROM PUBLIC;

CREATE TRIGGER workspace_membership_mirror_access
  AFTER INSERT OR UPDATE OR DELETE ON public.workspace_membership
  FOR EACH ROW EXECUTE FUNCTION private.mirror_workspace_membership();
CREATE TRIGGER project_membership_mirror_access
  AFTER INSERT OR UPDATE OR DELETE ON public.project_membership
  FOR EACH ROW EXECUTE FUNCTION private.mirror_project_membership();
CREATE TRIGGER workspace_role_mirror_access
  AFTER INSERT OR UPDATE OR DELETE ON public.workspace_role
  FOR EACH ROW EXECUTE FUNCTION private.mirror_workspace_role();

-- ── 8 · relleno ───────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT workspace_id, user_id FROM public.workspace_membership LOOP
    PERFORM private.sync_workspace_access(r.workspace_id, r.user_id);
  END LOOP;
  -- project_membership sin workspace_membership: inerte hoy, inerte después.
  FOR r IN SELECT project_id, user_id FROM public.project_membership LOOP
    PERFORM private.sync_project_access(r.project_id, r.user_id);
  END LOOP;
END;
$$;

-- ── 9 · paridad ───────────────────────────────────────────────────────────
-- Para cada persona y cada espacio o proyecto donde aparece, pregunta lo mismo
-- a los lectores de hoy y a los del modelo nuevo, y devuelve las diferencias.
-- Los lectores de hoy que leen auth.uid() se llaman suplantando al usuario
-- con request.jwt.claim.sub, que se restaura al salir.
CREATE FUNCTION private.access_parity_mismatches()
RETURNS TABLE (user_id uuid, workspace_id uuid, project_id uuid, probe text, legacy boolean, model boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
#variable_conflict use_column
DECLARE
  c_perms   CONSTANT text[] := ARRAY[
    'read:performance', 'edit:performance', 'read:money', 'edit:money',
    'read:conversation', 'edit:conversation', 'edit:project_meta', 'edit:membership'
  ];
  v_prev    text := current_setting('request.jwt.claim.sub', true);
  v_perm    text;
  v_legacy  boolean;
  v_model   boolean;
  r         record;
BEGIN
  FOR r IN
    SELECT DISTINCT x.u, x.ws
    FROM (
      SELECT wm.user_id AS u, wm.workspace_id AS ws FROM public.workspace_membership wm
      UNION
      SELECT m.user_id, m.workspace_id FROM public.membership m
    ) x
  LOOP
    PERFORM set_config('request.jwt.claim.sub', r.u::text, true);

    v_legacy := public.is_workspace_member(r.ws);
    v_model  := private.model_workspace_role(r.ws, r.u) IS NOT NULL;
    IF v_legacy IS DISTINCT FROM v_model THEN
      user_id := r.u; workspace_id := r.ws; project_id := NULL;
      probe := 'is_workspace_member'; legacy := v_legacy; model := v_model; RETURN NEXT;
    END IF;

    v_legacy := public.is_workspace_internal_member(r.ws);
    v_model  := coalesce(private.model_workspace_role(r.ws, r.u) IN ('owner', 'admin', 'member', 'viewer'), false);
    IF v_legacy IS DISTINCT FROM v_model THEN
      user_id := r.u; workspace_id := r.ws; project_id := NULL;
      probe := 'is_workspace_internal_member'; legacy := v_legacy; model := v_model; RETURN NEXT;
    END IF;

    v_legacy := public.is_workspace_admin(r.ws);
    v_model  := coalesce(private.model_workspace_role(r.ws, r.u) IN ('owner', 'admin'), false);
    IF v_legacy IS DISTINCT FROM v_model THEN
      user_id := r.u; workspace_id := r.ws; project_id := NULL;
      probe := 'is_workspace_admin'; legacy := v_legacy; model := v_model; RETURN NEXT;
    END IF;

    v_legacy := (SELECT wm.role::text FROM public.workspace_membership wm
                 WHERE wm.workspace_id = r.ws AND wm.user_id = r.u AND wm.accepted_at IS NOT NULL)
                IS NOT DISTINCT FROM private.model_workspace_role(r.ws, r.u)::text;
    IF NOT v_legacy THEN
      user_id := r.u; workspace_id := r.ws; project_id := NULL;
      probe := 'workspace_role'; legacy := false; model := true; RETURN NEXT;
    END IF;

    v_legacy := public.can_read_workspace_money(r.ws);
    v_model  := private.model_can_read_workspace_money(r.ws, r.u);
    IF v_legacy IS DISTINCT FROM v_model THEN
      user_id := r.u; workspace_id := r.ws; project_id := NULL;
      probe := 'can_read_workspace_money'; legacy := v_legacy; model := v_model; RETURN NEXT;
    END IF;
  END LOOP;

  FOR r IN
    SELECT DISTINCT x.u, p.id AS pid, p.workspace_id AS ws
    FROM public.project p
    JOIN (
      SELECT wm.user_id AS u, wm.workspace_id AS ws FROM public.workspace_membership wm
      UNION
      SELECT m.user_id, m.workspace_id FROM public.membership m
    ) x ON x.ws = p.workspace_id
    UNION
    SELECT pm.user_id, pm.project_id, p.workspace_id
    FROM public.project_membership pm
    JOIN public.project p ON p.id = pm.project_id
  LOOP
    PERFORM set_config('request.jwt.claim.sub', r.u::text, true);

    v_legacy := public.can_access_project(r.pid);
    v_model  := private.model_can_access_project(r.pid, r.u);
    IF v_legacy IS DISTINCT FROM v_model THEN
      user_id := r.u; workspace_id := r.ws; project_id := r.pid;
      probe := 'can_access_project'; legacy := v_legacy; model := v_model; RETURN NEXT;
    END IF;

    FOREACH v_perm IN ARRAY c_perms LOOP
      v_legacy := public.has_permission_for_user(r.pid, v_perm, r.u);
      v_model  := private.model_has_permission(r.pid, v_perm, r.u);
      IF v_legacy IS DISTINCT FROM v_model THEN
        user_id := r.u; workspace_id := r.ws; project_id := r.pid;
        probe := v_perm; legacy := v_legacy; model := v_model; RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub', coalesce(v_prev, ''), true);
END;
$$;
REVOKE ALL ON FUNCTION private.access_parity_mismatches() FROM PUBLIC;

-- ── 10 · RPC de comprobación (mueren en el contract) ──────────────────────
-- La respuesta del modelo nuevo a has_permission, para quien llama. Misma
-- superficie que has_permission: solo dice lo tuyo.
CREATE FUNCTION public.has_permission_by_facets(p_project_id uuid, p_perm text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT private.model_has_permission(p_project_id, p_perm, (SELECT auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.has_permission_by_facets(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission_by_facets(uuid, text) TO authenticated;

-- Todas las diferencias de todo el sistema: solo service_role.
CREATE FUNCTION public.access_parity_report()
RETURNS TABLE (user_id uuid, workspace_id uuid, project_id uuid, probe text, legacy boolean, model boolean)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT * FROM private.access_parity_mismatches();
$$;
REVOKE ALL ON FUNCTION public.access_parity_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.access_parity_report() TO service_role;

-- ── 11 · RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public.facet            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facet            FORCE ROW LEVEL SECURITY;
ALTER TABLE public.facet_level      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facet_level      FORCE ROW LEVEL SECURITY;
ALTER TABLE public.access_preset    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_preset    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.membership       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.membership_facet ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_facet FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.facet, public.facet_level, public.access_preset,
              public.membership, public.membership_facet FROM anon, authenticated;
GRANT SELECT ON public.facet, public.facet_level, public.access_preset,
                public.membership, public.membership_facet TO authenticated;

-- El vocabulario no filtra nada: saber que existe `diners` no dice quién la tiene.
CREATE POLICY facet_select         ON public.facet         FOR SELECT TO authenticated USING (true);
CREATE POLICY facet_level_select   ON public.facet_level   FOR SELECT TO authenticated USING (true);
CREATE POLICY access_preset_select ON public.access_preset FOR SELECT TO authenticated USING (true);

-- Lo tuyo, o todo el espacio si lo administras: el patrón que main ya fijó en
-- workspace_membership_select (y no el de la rama de julio, que publicaba la
-- matriz entera a cualquier miembro).
CREATE POLICY membership_select ON public.membership
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_workspace_admin(workspace_id));

CREATE POLICY membership_facet_select ON public.membership_facet
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.membership m
    WHERE m.id = membership_facet.membership_id
      AND (m.user_id = (SELECT auth.uid()) OR public.is_workspace_admin(m.workspace_id))
  ));

-- ── 12 · la migración no se aplica si el espejo no es exacto ──────────────
DO $$
DECLARE
  v_count  integer;
  v_detail text;
BEGIN
  CREATE TEMP TABLE permissions_facets_parity ON COMMIT DROP AS
    SELECT * FROM private.access_parity_mismatches();

  SELECT count(*) INTO v_count FROM permissions_facets_parity;
  SELECT string_agg(format('%s %s %s %s legacy=%s model=%s',
                           m.user_id, m.workspace_id, coalesce(m.project_id::text, '-'),
                           m.probe, m.legacy, m.model), E'\n')
  INTO v_detail
  FROM (SELECT * FROM permissions_facets_parity LIMIT 50) m;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'permissions_facets_expand: % parity mismatch(es); nothing applied', v_count
      USING DETAIL = v_detail,
            HINT = 'Each row is a state the facet model cannot represent. See build/permissions-facets-plan.md § Riesgos.';
  END IF;
END;
$$;
