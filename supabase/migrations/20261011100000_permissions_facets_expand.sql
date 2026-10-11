-- Permisos al modelo de facetas, fase EXPAND (ADR-099 §8, ADR-100; ADR-082,
-- ADR-083, ADR-085; plan en build/permissions-facets-plan.md).
--
-- Esta migración es SOLO el expand: crea el modelo nuevo, lo rellena desde el
-- actual y lo mantiene en espejo. NINGUNA lectura existente cambia:
-- has_permission, las políticas, las RPC y el Worker siguen leyendo
-- workspace_membership, project_membership y workspace_role como antes. La
-- fase 2 (20261011300000_permissions_facets_reads) es la que cambia lecturas.
--
-- WHAT THIS DOES:
--   1. Vocabulario: `container_level` (workspace, project, line, bolo,
--      performance; ADR-100 §5: el cuarto nivel es el bolo, y la función existe
--      para Full de ruta) y `access_verb` (view, edit; edit implica view).
--   2. Facetas configurables por espacio (ADR-099, añadido): `facet` guarda las
--      estándar de Hour (workspace_id NULL, nombre traducido por clave
--      `facet.<key>` en los cuatro idiomas) y las propias de cada espacio
--      (workspace_id, nombre y traducciones opcionales). `facet_level` dice en
--      qué nivel existe cada una, COMO FILAS. `workspace_facet_setting` deja a
--      un espacio renombrar o desactivar una faceta. Estándar: converses,
--      materials, tecnica, logistica, full_de_ruta, comidas, diners.
--   3. Paquetes (ADR-100 §6): `access_preset` con lo que da al contenedor y
--      `access_preset_facet` con lo que da en cada faceta estándar.
--   4. `membership`: una fila por persona con login y contenedor, con el rol
--      del espacio, el acceso al contenedor (`container_verb`) y dos
--      capacidades (`can_edit_meta`, `can_manage_members`; la segunda muere en
--      la fase 3, ADR-100 §3). `roles` guarda los códigos de rol como etiqueta.
--   5. `membership_facet`: las filas de faceta, con `source` (legacy, preset,
--      override). Un trigger impide escribir una faceta donde no existe o de
--      otro espacio.
--   6. Lectores del modelo nuevo en `private`: los gemelos de los lectores de
--      hoy (`model_*`, parametrizados por usuario) y los de nivel fino
--      (`model_has_facet_at`, `model_container_verb_at`) por la cadena de
--      contenedores.
--   7. La RPC de paquetes `grant_container_preset`: expande un paquete en una
--      membresía de línea, bolo o función, con el techo del delegante (faceta,
--      verbo y nivel, ADR-085 §10). Proyecto y espacio esperan a la fase 3:
--      mientras el espejo viva, sus filas las escribe el espejo.
--   8. Espejo: triggers en workspace_membership, project_membership y
--      workspace_role que recalculan las filas de la pareja tocada.
--   9. Relleno desde el estado actual.
--  10. Paridad: `private.access_parity_mismatches()` compara, para cada persona
--      y cada proyecto o espacio, los lectores de hoy y los nuevos. La
--      migración ABORTA si hay una sola diferencia.
--  11. Dos RPC de solo comprobación: `has_permission_by_facets` (la del que
--      llama) y `access_parity_report` (solo service_role). Mueren en el
--      contract.
--
-- RLS: todo se lee con RLS forzado. El vocabulario estándar, cualquier
-- autenticado; el propio de un espacio y sus ajustes, sus miembros; las
-- membresías y sus facetas, las propias o todas si administras el espacio.
-- Escriben: el admin del espacio sus facetas propias, sus niveles y sus
-- ajustes; las membresías y sus facetas, solo el espejo y la RPC de paquetes.
--
-- ADITIVA según § 34: tipos, tablas y funciones nuevas, y triggers AFTER en
-- tres tablas que solo escriben en las tablas nuevas. El Worker desplegado no
-- lee nada de esto.
-- Rollback: build/runbooks/rollback-20261011-permissions-facets-expand.sql.

-- ── 1 · vocabulario ───────────────────────────────────────────────────────
CREATE TYPE public.container_level AS ENUM ('workspace', 'project', 'line', 'bolo', 'performance');
COMMENT ON TYPE public.container_level IS
  'Niveles de contenedor (ADR-082 enmienda, ADR-100 §5): espacio, proyecto, línea, bolo y función.';

CREATE TYPE public.access_verb AS ENUM ('view', 'edit');
COMMENT ON TYPE public.access_verb IS
  'veure | veure+editar (ADR-082 §4). edit implica view. No hay `none`: la ausencia de fila es «res».';

-- ── 2 · facetas, configurables por espacio ────────────────────────────────
CREATE TABLE public.facet (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id uuid REFERENCES public.workspace (id) ON DELETE CASCADE,
  key          text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,31}$'),
  label        text CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 60),
  labels       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(labels) = 'object'),
  sort         smallint NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- Las estándar se nombran por clave i18n; las propias llevan su nombre.
  CONSTRAINT facet_label_by_kind CHECK (
    (workspace_id IS NULL AND label IS NULL AND labels = '{}'::jsonb)
    OR (workspace_id IS NOT NULL AND label IS NOT NULL)
  )
);
COMMENT ON TABLE public.facet IS
  'Facetas (ADR-083 §4, ADR-099 añadido). workspace_id NULL = estándar de Hour, nombre por la clave i18n facet.<key>. Con workspace_id = propia del espacio, nombre en label y traducciones opcionales en labels {ca,es,en,fr}. General NO está: es la membresía.';
CREATE UNIQUE INDEX facet_standard_key ON public.facet (key) WHERE workspace_id IS NULL;
CREATE UNIQUE INDEX facet_workspace_key ON public.facet (workspace_id, key) WHERE workspace_id IS NOT NULL;
CREATE INDEX facet_created_by_idx ON public.facet (created_by);

CREATE TRIGGER facet_guard_ws BEFORE UPDATE ON public.facet
  FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_workspace_id();
CREATE TRIGGER facet_set_updated_at BEFORE UPDATE ON public.facet
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- La clave de una faceta no cambia: las traducciones y los paquetes la usan.
CREATE FUNCTION private.guard_facet_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'facet key is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_facet_key() FROM PUBLIC;
CREATE TRIGGER facet_guard_key BEFORE UPDATE ON public.facet
  FOR EACH ROW EXECUTE FUNCTION private.guard_facet_key();

CREATE TABLE public.facet_level (
  facet_id uuid NOT NULL REFERENCES public.facet (id) ON DELETE CASCADE,
  level    public.container_level NOT NULL,
  PRIMARY KEY (facet_id, level)
);
COMMENT ON TABLE public.facet_level IS
  'En qué nivel existe cada faceta. Mover una faceta de nivel es una fila (ADR-082 enmienda §6). Ausente no es denegado: sin fila, la faceta no está en ese nivel.';

CREATE TABLE public.workspace_facet_setting (
  workspace_id uuid NOT NULL REFERENCES public.workspace (id) ON DELETE CASCADE,
  facet_id     uuid NOT NULL REFERENCES public.facet (id) ON DELETE CASCADE,
  label        text CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 60),
  labels       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(labels) = 'object'),
  active       boolean NOT NULL DEFAULT true,
  sort         smallint,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, facet_id)
);
COMMENT ON TABLE public.workspace_facet_setting IS
  'Ajustes de un espacio sobre una faceta: renombrar (label, labels), desactivar (active) y ordenar. Desactivar quita la faceta de los hilos y de la interfaz; NO cambia quién lee los datos que la faceta gatea (ver plan § Riesgos).';
CREATE INDEX workspace_facet_setting_facet_idx ON public.workspace_facet_setting (facet_id);
CREATE TRIGGER workspace_facet_setting_guard_ws BEFORE UPDATE ON public.workspace_facet_setting
  FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_workspace_id();
CREATE TRIGGER workspace_facet_setting_set_updated_at BEFORE UPDATE ON public.workspace_facet_setting
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Un ajuste solo puede tocar una faceta estándar o una propia del mismo espacio.
CREATE FUNCTION private.guard_workspace_facet_setting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.facet f
    WHERE f.id = NEW.facet_id
      AND (f.workspace_id IS NULL OR f.workspace_id = NEW.workspace_id)
  ) THEN
    RAISE EXCEPTION 'facet % does not belong to workspace %', NEW.facet_id, NEW.workspace_id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_workspace_facet_setting() FROM PUBLIC;
CREATE TRIGGER workspace_facet_setting_guard_facet BEFORE INSERT OR UPDATE ON public.workspace_facet_setting
  FOR EACH ROW EXECUTE FUNCTION private.guard_workspace_facet_setting();

INSERT INTO public.facet (key, sort) VALUES
  ('converses',    10),
  ('materials',    20),
  ('tecnica',      30),
  ('logistica',    40),
  ('full_de_ruta', 50),
  ('comidas',      55),
  ('diners',       60);

-- La tabla de la enmienda de ADR-082, con la función (ADR-100 §5: Full de ruta
-- también ahí) y Comidas en el bolo (ADR-099: «comidas en el bolo»; si debe
-- existir en más niveles, son filas).
INSERT INTO public.facet_level (facet_id, level)
SELECT f.id, l.level::public.container_level
FROM (VALUES
  ('converses',    'workspace'), ('converses', 'project'), ('converses', 'line'),
  ('materials',    'project'),   ('materials', 'line'),    ('materials', 'bolo'),
  ('tecnica',      'project'),   ('tecnica',   'line'),    ('tecnica',   'bolo'),
  ('logistica',    'line'),      ('logistica', 'bolo'),
  ('full_de_ruta', 'bolo'),      ('full_de_ruta', 'performance'),
  ('comidas',      'bolo'),
  ('diners',       'workspace'), ('diners',    'project'), ('diners',    'line'), ('diners', 'bolo')
) AS l (key, level)
JOIN public.facet f ON f.key = l.key AND f.workspace_id IS NULL;

-- ── 3 · paquetes (ADR-100 §6) ─────────────────────────────────────────────
CREATE TABLE public.access_preset (
  key                text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,31}$'),
  sort               smallint NOT NULL DEFAULT 0,
  container_verb     public.access_verb NOT NULL,
  can_edit_meta      boolean NOT NULL DEFAULT false,
  can_manage_members boolean NOT NULL DEFAULT false
);
COMMENT ON TABLE public.access_preset IS
  'Escalera de paquetes (ADR-082 enmienda §2, contenido ADR-100 §6). Un paquete se EXPANDE en filas al conceder (source = preset); no se resuelve al leer.';

CREATE TABLE public.access_preset_facet (
  preset_key text NOT NULL REFERENCES public.access_preset (key) ON DELETE CASCADE ON UPDATE CASCADE,
  facet_key  text NOT NULL,
  verb       public.access_verb NOT NULL,
  PRIMARY KEY (preset_key, facet_key)
);
COMMENT ON TABLE public.access_preset_facet IS
  'Lo que da cada paquete en cada faceta ESTÁNDAR (por clave). Las facetas propias de un espacio no entran en ningún paquete: se dan a mano (override).';

INSERT INTO public.access_preset (key, sort, container_verb, can_edit_meta, can_manage_members) VALUES
  ('minim',       10, 'view', false, false),
  ('equip',       20, 'view', false, false),
  ('coordinacio', 30, 'edit', true,  false),
  ('direccio',    40, 'edit', true,  true);

-- Mínim: el contenedor. Equip: lo ve con Materials, Tècnica, Logística y Full
-- de ruta. Coordinació: edita todo y ve Diners. Direcció: edita todo, Diners
-- incluido. Comidas no aparece en ADR-100 §6 para Equip: va con «todo» en
-- Coordinació y Direcció (plan § Dudas).
INSERT INTO public.access_preset_facet (preset_key, facet_key, verb) VALUES
  ('equip',       'materials',    'view'),
  ('equip',       'tecnica',      'view'),
  ('equip',       'logistica',    'view'),
  ('equip',       'full_de_ruta', 'view'),
  ('coordinacio', 'converses',    'edit'),
  ('coordinacio', 'materials',    'edit'),
  ('coordinacio', 'tecnica',      'edit'),
  ('coordinacio', 'logistica',    'edit'),
  ('coordinacio', 'full_de_ruta', 'edit'),
  ('coordinacio', 'comidas',      'edit'),
  ('coordinacio', 'diners',       'view'),
  ('direccio',    'converses',    'edit'),
  ('direccio',    'materials',    'edit'),
  ('direccio',    'tecnica',      'edit'),
  ('direccio',    'logistica',    'edit'),
  ('direccio',    'full_de_ruta', 'edit'),
  ('direccio',    'comidas',      'edit'),
  ('direccio',    'diners',       'edit');

-- ── 4 · membresía ─────────────────────────────────────────────────────────
CREATE TABLE public.membership (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id       uuid NOT NULL REFERENCES public.workspace (id) ON DELETE CASCADE,
  level              public.container_level NOT NULL,
  project_id         uuid REFERENCES public.project (id) ON DELETE CASCADE,
  line_id            uuid REFERENCES public.line (id) ON DELETE CASCADE,
  bolo_id            uuid REFERENCES public.bolo (id) ON DELETE CASCADE,
  performance_id     uuid REFERENCES public.performance (id) ON DELETE CASCADE,
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
       (level = 'workspace'   AND num_nonnulls(project_id, line_id, bolo_id, performance_id) = 0
          AND workspace_role IS NOT NULL)
    OR (level = 'project'     AND project_id IS NOT NULL     AND num_nonnulls(line_id, bolo_id, performance_id) = 0
          AND workspace_role IS NULL)
    OR (level = 'line'        AND line_id IS NOT NULL        AND num_nonnulls(project_id, bolo_id, performance_id) = 0
          AND workspace_role IS NULL)
    OR (level = 'bolo'        AND bolo_id IS NOT NULL        AND num_nonnulls(project_id, line_id, performance_id) = 0
          AND workspace_role IS NULL)
    OR (level = 'performance' AND performance_id IS NOT NULL AND num_nonnulls(project_id, line_id, bolo_id) = 0
          AND workspace_role IS NULL)
  )
);

COMMENT ON TABLE public.membership IS
  'Membresía por nivel de contenedor (ADR-082). Estar es ver el contenedor y su hilo General. Espacio y proyecto: espejo de workspace_membership y project_membership hasta la fase 3. Línea, bolo y función: los escribe grant_container_preset.';
COMMENT ON COLUMN public.membership.workspace_role IS
  'Solo en el nivel workspace: owner | admin | member | viewer | guest. Se queda como dimensión propia del espacio (ADR-100 §4).';
COMMENT ON COLUMN public.membership.container_verb IS
  'Acceso al propio contenedor (ADR-100 §1): view = read:performance, edit = edit:performance. NULL solo en filas heredadas sin ese permiso; en el contract es obligatorio (ADR-100 §2).';
COMMENT ON COLUMN public.membership.can_manage_members IS
  'edit:membership. Muere en la fase 3: invitar no es una capacidad, manda el techo del delegante (ADR-100 §3).';
COMMENT ON COLUMN public.membership.roles IS
  'Códigos de rol como etiqueta (ADR-082: el rol es lo que haces, no lo que puedes).';
COMMENT ON COLUMN public.membership.preset IS
  'Paquete del que se expandieron las filas. NULL en las filas del espejo.';

CREATE UNIQUE INDEX membership_workspace_user_key   ON public.membership (workspace_id, user_id)   WHERE level = 'workspace';
CREATE UNIQUE INDEX membership_project_user_key     ON public.membership (project_id, user_id)     WHERE level = 'project';
CREATE UNIQUE INDEX membership_line_user_key        ON public.membership (line_id, user_id)        WHERE level = 'line';
CREATE UNIQUE INDEX membership_bolo_user_key        ON public.membership (bolo_id, user_id)        WHERE level = 'bolo';
CREATE UNIQUE INDEX membership_performance_user_key ON public.membership (performance_id, user_id) WHERE level = 'performance';
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
  facet_id      uuid NOT NULL REFERENCES public.facet (id) ON DELETE RESTRICT,
  verb          public.access_verb NOT NULL,
  source        text NOT NULL CHECK (source IN ('legacy', 'preset', 'override')),
  granted_by    uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, facet_id)
);
COMMENT ON TABLE public.membership_facet IS
  'Quién tiene qué faceta en qué contenedor. Sin fila = res. source: legacy (espejo de los roles de hoy), preset (vino con el paquete), override (alguien la tocó a mano); la vista «de dónde sale cada permiso» de ADR-082 §4 lee esta columna.';
CREATE INDEX membership_facet_facet_idx      ON public.membership_facet (facet_id);
CREATE INDEX membership_facet_granted_by_idx ON public.membership_facet (granted_by);

-- La tabla de niveles se cumple al escribir: no se concede una faceta donde no
-- existe, ni una faceta de otro espacio.
CREATE FUNCTION private.guard_membership_facet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.membership m
    JOIN public.facet f ON f.id = NEW.facet_id
                       AND (f.workspace_id IS NULL OR f.workspace_id = m.workspace_id)
    JOIN public.facet_level fl ON fl.facet_id = f.id AND fl.level = m.level
    WHERE m.id = NEW.membership_id
  ) THEN
    RAISE EXCEPTION 'facet % does not exist at the level of membership %', NEW.facet_id, NEW.membership_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_membership_facet() FROM PUBLIC;

CREATE TRIGGER membership_facet_guard BEFORE INSERT OR UPDATE ON public.membership_facet
  FOR EACH ROW EXECUTE FUNCTION private.guard_membership_facet();

-- ── 6 · lectores del modelo nuevo ─────────────────────────────────────────
CREATE FUNCTION private.standard_facet_id(p_key text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT f.id FROM public.facet f WHERE f.key = p_key AND f.workspace_id IS NULL;
$$;

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

-- ¿Tiene esta persona uno de estos roles en el espacio? NULL = cualquiera.
CREATE FUNCTION private.model_has_workspace_role(
  p_workspace_id uuid, p_user_id uuid, p_roles public.membership_role[] DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_user_id IS NOT NULL AND p_workspace_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.membership m
    WHERE m.level = 'workspace'
      AND m.workspace_id = p_workspace_id
      AND m.user_id = p_user_id
      AND m.accepted_at IS NOT NULL
      AND (p_roles IS NULL OR m.workspace_role = ANY (p_roles))
  );
$$;

-- Una faceta en un proyecto: fila en el proyecto o en el espacio (la unión
-- hacia abajo de ADR-082 §3), solo donde la faceta existe; owner/admin lo ven
-- todo. Es la lectura que sustituye a read/edit:money y read/edit:conversation.
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
          FROM public.facet f
          JOIN public.membership m
            ON m.user_id = p_user_id
           AND m.accepted_at IS NOT NULL
           AND ((m.level = 'project' AND m.project_id = p.id)
             OR (m.level = 'workspace' AND m.workspace_id = p.workspace_id))
          JOIN public.membership_facet mf ON mf.membership_id = m.id AND mf.facet_id = f.id
          JOIN public.facet_level fl ON fl.facet_id = f.id AND fl.level = m.level
          WHERE f.key = p_facet
            AND (f.workspace_id IS NULL OR f.workspace_id = p.workspace_id)
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
    private.model_has_workspace_role(p_workspace_id, p_user_id, ARRAY['owner', 'admin']::public.membership_role[])
    OR EXISTS (
      SELECT 1 FROM public.project p
      WHERE p.workspace_id = p_workspace_id
        AND p.deleted_at IS NULL
        AND private.model_has_facet(p.id, 'diners', 'view', p_user_id)
    )
  );
$$;

-- La cadena de un contenedor hacia arriba (él mismo incluido), leyendo las
-- claves desnormalizadas: una función sin línea no pierde su proyecto.
CREATE FUNCTION private.container_chain(p_level public.container_level, p_id uuid)
RETURNS TABLE (level public.container_level, id uuid, workspace_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH r AS (
    SELECT
      CASE WHEN p_level = 'performance'
           THEN (SELECT pf.id FROM public.performance pf WHERE pf.id = p_id) END AS performance_id,
      CASE p_level
        WHEN 'bolo' THEN (SELECT b.id FROM public.bolo b WHERE b.id = p_id)
        WHEN 'performance' THEN (SELECT pf.bolo_id FROM public.performance pf WHERE pf.id = p_id)
      END AS bolo_id,
      CASE p_level
        WHEN 'line' THEN (SELECT l.id FROM public.line l WHERE l.id = p_id)
        WHEN 'bolo' THEN (SELECT b.line_id FROM public.bolo b WHERE b.id = p_id)
        WHEN 'performance' THEN (SELECT coalesce(pf.line_id, b.line_id)
                                 FROM public.performance pf
                                 LEFT JOIN public.bolo b ON b.id = pf.bolo_id
                                 WHERE pf.id = p_id)
      END AS line_id,
      CASE p_level
        WHEN 'project' THEN (SELECT pr.id FROM public.project pr WHERE pr.id = p_id)
        WHEN 'line' THEN (SELECT l.project_id FROM public.line l WHERE l.id = p_id)
        WHEN 'bolo' THEN (SELECT b.project_id FROM public.bolo b WHERE b.id = p_id)
        WHEN 'performance' THEN (SELECT pf.project_id FROM public.performance pf WHERE pf.id = p_id)
      END AS project_id,
      CASE p_level
        WHEN 'workspace' THEN (SELECT w.id FROM public.workspace w WHERE w.id = p_id)
        WHEN 'project' THEN (SELECT pr.workspace_id FROM public.project pr WHERE pr.id = p_id)
        WHEN 'line' THEN (SELECT l.workspace_id FROM public.line l WHERE l.id = p_id)
        WHEN 'bolo' THEN (SELECT b.workspace_id FROM public.bolo b WHERE b.id = p_id)
        WHEN 'performance' THEN (SELECT pf.workspace_id FROM public.performance pf WHERE pf.id = p_id)
      END AS workspace_id
  )
  SELECT 'performance'::public.container_level, r.performance_id, r.workspace_id FROM r WHERE r.performance_id IS NOT NULL
  UNION ALL SELECT 'bolo'::public.container_level, r.bolo_id, r.workspace_id FROM r WHERE r.bolo_id IS NOT NULL
  UNION ALL SELECT 'line'::public.container_level, r.line_id, r.workspace_id FROM r WHERE r.line_id IS NOT NULL
  UNION ALL SELECT 'project'::public.container_level, r.project_id, r.workspace_id FROM r WHERE r.project_id IS NOT NULL
  UNION ALL SELECT 'workspace'::public.container_level, r.workspace_id, r.workspace_id FROM r WHERE r.workspace_id IS NOT NULL;
$$;

-- Las membresías vivas de una persona en la cadena de un contenedor.
CREATE FUNCTION private.chain_memberships(p_level public.container_level, p_id uuid, p_user_id uuid)
RETURNS SETOF public.membership
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
$$;

-- ¿Tiene la persona la faceta en ese contenedor, por él o por uno de encima?
-- owner/admin del espacio lo tienen todo.
CREATE FUNCTION private.model_has_facet_at(
  p_level public.container_level, p_id uuid, p_facet_id uuid, p_verb public.access_verb, p_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_user_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM private.chain_memberships(p_level, p_id, p_user_id) m
      WHERE m.level = 'workspace' AND m.workspace_role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1
      FROM private.chain_memberships(p_level, p_id, p_user_id) m
      JOIN public.membership_facet mf ON mf.membership_id = m.id AND mf.facet_id = p_facet_id
      JOIN public.facet_level fl ON fl.facet_id = p_facet_id AND fl.level = m.level
      WHERE mf.verb = 'edit' OR mf.verb = p_verb
    )
  );
$$;

-- El mejor acceso al contenedor por la cadena: edit, view o NULL.
CREATE FUNCTION private.model_container_verb_at(
  p_level public.container_level, p_id uuid, p_user_id uuid
) RETURNS public.access_verb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT max(v)
  FROM (
    SELECT CASE WHEN m.workspace_role IN ('owner', 'admin') THEN 'edit'::public.access_verb
                ELSE m.container_verb END AS v
    FROM private.chain_memberships(p_level, p_id, p_user_id) m
  ) x;
$$;

REVOKE ALL ON FUNCTION private.standard_facet_id(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.model_workspace_role(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.model_has_workspace_role(uuid, uuid, public.membership_role[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.model_has_facet(uuid, text, public.access_verb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.model_has_permission(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.model_can_access_project(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.model_can_read_workspace_money(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.container_chain(public.container_level, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.chain_memberships(public.container_level, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.model_has_facet_at(public.container_level, uuid, uuid, public.access_verb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.model_container_verb_at(public.container_level, uuid, uuid) FROM PUBLIC;

-- ── 7 · paquetes: expansión y RPC ─────────────────────────────────────────
-- Expande un paquete sobre una membresía: fija el contenedor y las dos
-- capacidades, y reescribe las filas `preset` con las facetas estándar que
-- existen en su nivel. Las filas `override` se quedan.
CREATE FUNCTION private.expand_preset(p_membership_id uuid, p_preset text, p_granted_by uuid)
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
      can_edit_meta = v_p.can_edit_meta,
      can_manage_members = v_p.can_manage_members
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
REVOKE ALL ON FUNCTION private.expand_preset(uuid, text, uuid) FROM PUBLIC;

-- El techo del delegante (ADR-085 §10): solo das lo que tienes, en faceta,
-- verbo y nivel. «Lo tienes» = en ese contenedor o en uno de encima.
CREATE FUNCTION private.can_grant_preset(
  p_level public.container_level, p_id uuid, p_preset text, p_user_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_p      public.access_preset;
  v_verb   public.access_verb := private.model_container_verb_at(p_level, p_id, p_user_id);
  v_admin  boolean;
  v_meta   boolean;
  v_members boolean;
BEGIN
  SELECT * INTO v_p FROM public.access_preset WHERE key = p_preset;
  IF v_p.key IS NULL OR v_verb IS NULL THEN
    RETURN false;
  END IF;
  IF v_p.container_verb = 'edit' AND v_verb <> 'edit' THEN
    RETURN false;
  END IF;

  SELECT coalesce(bool_or(m.level = 'workspace' AND m.workspace_role IN ('owner', 'admin')), false),
         coalesce(bool_or(m.can_edit_meta), false),
         coalesce(bool_or(m.can_manage_members), false)
  INTO v_admin, v_meta, v_members
  FROM private.chain_memberships(p_level, p_id, p_user_id) m;

  IF NOT v_admin AND ((v_p.can_edit_meta AND NOT v_meta)
                   OR (v_p.can_manage_members AND NOT v_members)) THEN
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
REVOKE ALL ON FUNCTION private.can_grant_preset(public.container_level, uuid, text, uuid) FROM PUBLIC;

-- Da (o cambia) el paquete de una persona en una línea, un bolo o una función.
-- La persona tiene que ser miembro aceptado del espacio. Proyecto y espacio
-- esperan a la fase 3, cuando las escrituras de membresía dejen las tablas
-- viejas: hoy sus filas las escribe el espejo y una fila `preset` ahí
-- rompería la paridad.
CREATE FUNCTION public.grant_container_preset(
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
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_level NOT IN ('line', 'bolo', 'performance') THEN
    RAISE EXCEPTION 'presets at % level arrive in phase 3', p_level USING ERRCODE = '0A000';
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

  SELECT m.id INTO v_id FROM public.membership m
  WHERE m.level = p_level AND m.user_id = p_user_id
    AND CASE p_level
          WHEN 'line'        THEN m.line_id = p_container_id
          WHEN 'bolo'        THEN m.bolo_id = p_container_id
          WHEN 'performance' THEN m.performance_id = p_container_id
        END;

  IF v_id IS NULL THEN
    INSERT INTO public.membership (workspace_id, level, line_id, bolo_id, performance_id,
                                   user_id, accepted_at, invited_by)
    VALUES (v_ws, p_level,
            CASE WHEN p_level = 'line' THEN p_container_id END,
            CASE WHEN p_level = 'bolo' THEN p_container_id END,
            CASE WHEN p_level = 'performance' THEN p_container_id END,
            p_user_id, now(), v_caller)
    RETURNING id INTO v_id;
  END IF;

  PERFORM private.expand_preset(v_id, p_preset, v_caller);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.grant_container_preset(public.container_level, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_container_preset(public.container_level, uuid, uuid, text) TO authenticated;

-- ── 8 · espejo ────────────────────────────────────────────────────────────
-- Recalcula la fila de proyecto de una pareja (proyecto, persona) con la misma
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

  INSERT INTO public.membership_facet (membership_id, facet_id, verb, source)
  SELECT v_id, private.standard_facet_id(f.facet_key), f.verb, 'legacy'
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
-- proyecto: llevan la aceptación del espacio, como hoy has_permission exige
-- workspace_membership.accepted_at.
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
  v_ws    uuid;
  v_codes text[];
  r       record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_ws := NEW.workspace_id; v_codes := ARRAY[NEW.code];
  ELSIF TG_OP = 'DELETE' THEN
    v_ws := OLD.workspace_id; v_codes := ARRAY[OLD.code];
  ELSE
    IF NEW.code IS NOT DISTINCT FROM OLD.code
       AND NEW.permissions IS NOT DISTINCT FROM OLD.permissions
       AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at THEN
      RETURN NULL;
    END IF;
    v_ws := NEW.workspace_id; v_codes := ARRAY[OLD.code, NEW.code];
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

-- ── 9 · relleno ───────────────────────────────────────────────────────────
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

-- ── 10 · paridad ──────────────────────────────────────────────────────────
-- Para cada persona y cada espacio o proyecto donde aparece, pregunta lo mismo
-- a los lectores de hoy y a los del modelo nuevo, y devuelve las diferencias.
-- Los lectores de hoy que leen auth.uid() se llaman suplantando al usuario
-- con request.jwt.claim.sub, que se restaura al salir. La fase 2 redefine esta
-- función contra copias congeladas de los lectores de hoy.
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
      SELECT m.user_id, m.workspace_id FROM public.membership m WHERE m.level IN ('workspace', 'project')
    ) x
  LOOP
    PERFORM set_config('request.jwt.claim.sub', r.u::text, true);

    v_legacy := public.is_workspace_member(r.ws);
    v_model  := private.model_has_workspace_role(r.ws, r.u);
    IF v_legacy IS DISTINCT FROM v_model THEN
      user_id := r.u; workspace_id := r.ws; project_id := NULL;
      probe := 'is_workspace_member'; legacy := v_legacy; model := v_model; RETURN NEXT;
    END IF;

    v_legacy := public.is_workspace_internal_member(r.ws);
    v_model  := private.model_has_workspace_role(r.ws, r.u, ARRAY['owner', 'admin', 'member', 'viewer']::public.membership_role[]);
    IF v_legacy IS DISTINCT FROM v_model THEN
      user_id := r.u; workspace_id := r.ws; project_id := NULL;
      probe := 'is_workspace_internal_member'; legacy := v_legacy; model := v_model; RETURN NEXT;
    END IF;

    v_legacy := public.is_workspace_admin(r.ws);
    v_model  := private.model_has_workspace_role(r.ws, r.u, ARRAY['owner', 'admin']::public.membership_role[]);
    IF v_legacy IS DISTINCT FROM v_model THEN
      user_id := r.u; workspace_id := r.ws; project_id := NULL;
      probe := 'is_workspace_admin'; legacy := v_legacy; model := v_model; RETURN NEXT;
    END IF;

    IF (SELECT wm.role::text FROM public.workspace_membership wm
        WHERE wm.workspace_id = r.ws AND wm.user_id = r.u AND wm.accepted_at IS NOT NULL)
       IS DISTINCT FROM private.model_workspace_role(r.ws, r.u)::text THEN
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
      SELECT m.user_id, m.workspace_id FROM public.membership m WHERE m.level IN ('workspace', 'project')
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

-- ── 11 · RPC de comprobación (mueren en el contract) ──────────────────────
CREATE FUNCTION public.has_permission_by_facets(p_project_id uuid, p_perm text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT private.model_has_permission(p_project_id, p_perm, (SELECT auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.has_permission_by_facets(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission_by_facets(uuid, text) TO authenticated;

CREATE FUNCTION public.access_parity_report()
RETURNS TABLE (user_id uuid, workspace_id uuid, project_id uuid, probe text, legacy boolean, model boolean)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT * FROM private.access_parity_mismatches();
$$;
REVOKE ALL ON FUNCTION public.access_parity_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.access_parity_report() TO service_role;

-- ── 12 · RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public.facet                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facet                   FORCE ROW LEVEL SECURITY;
ALTER TABLE public.facet_level             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facet_level             FORCE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_facet_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_facet_setting FORCE ROW LEVEL SECURITY;
ALTER TABLE public.access_preset           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_preset           FORCE ROW LEVEL SECURITY;
ALTER TABLE public.access_preset_facet     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_preset_facet     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.membership              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership              FORCE ROW LEVEL SECURITY;
ALTER TABLE public.membership_facet        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_facet        FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.facet, public.facet_level, public.workspace_facet_setting,
              public.access_preset, public.access_preset_facet,
              public.membership, public.membership_facet FROM anon, authenticated;
GRANT SELECT ON public.facet, public.facet_level, public.workspace_facet_setting,
                public.access_preset, public.access_preset_facet,
                public.membership, public.membership_facet TO authenticated;
-- El admin configura las facetas de su espacio. Sin DELETE de facetas:
-- desactivar es un ajuste; borrar una usada costaría su historial.
GRANT INSERT (workspace_id, key, label, labels, sort, created_by),
      UPDATE (label, labels, sort) ON public.facet TO authenticated;
GRANT INSERT, DELETE ON public.facet_level TO authenticated;
GRANT INSERT (workspace_id, facet_id, label, labels, active, sort),
      UPDATE (label, labels, active, sort) ON public.workspace_facet_setting TO authenticated;

CREATE POLICY facet_select ON public.facet
  FOR SELECT TO authenticated
  USING (workspace_id IS NULL OR public.is_workspace_member(workspace_id));
CREATE POLICY facet_insert ON public.facet
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id IS NOT NULL AND public.is_workspace_admin(workspace_id)
              AND created_by = (SELECT auth.uid()));
CREATE POLICY facet_update ON public.facet
  FOR UPDATE TO authenticated
  USING (workspace_id IS NOT NULL AND public.is_workspace_admin(workspace_id))
  WITH CHECK (workspace_id IS NOT NULL AND public.is_workspace_admin(workspace_id));

CREATE POLICY facet_level_select ON public.facet_level
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.facet f WHERE f.id = facet_level.facet_id));
CREATE POLICY facet_level_insert ON public.facet_level
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.facet f
    WHERE f.id = facet_level.facet_id AND f.workspace_id IS NOT NULL
      AND public.is_workspace_admin(f.workspace_id)
  ));
CREATE POLICY facet_level_delete ON public.facet_level
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.facet f
    WHERE f.id = facet_level.facet_id AND f.workspace_id IS NOT NULL
      AND public.is_workspace_admin(f.workspace_id)
  ));

CREATE POLICY workspace_facet_setting_select ON public.workspace_facet_setting
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));
CREATE POLICY workspace_facet_setting_insert ON public.workspace_facet_setting
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_admin(workspace_id));
CREATE POLICY workspace_facet_setting_update ON public.workspace_facet_setting
  FOR UPDATE TO authenticated
  USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

CREATE POLICY access_preset_select       ON public.access_preset       FOR SELECT TO authenticated USING (true);
CREATE POLICY access_preset_facet_select ON public.access_preset_facet FOR SELECT TO authenticated USING (true);

-- Lo tuyo, o todo el espacio si lo administras: el patrón que main fijó en
-- workspace_membership_select (no el de la rama de julio, que publicaba la
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

-- ── 13 · la migración no se aplica si el espejo no es exacto ──────────────
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
