-- Comms, carril 2: hilos internos con facetas (ADR-106; ADR-082, ADR-083,
-- ADR-085, ADR-099 §6 y §7). Plan: build/plans/2026-10-14-comms-threads.md,
-- fase 1, con las seis respuestas de Marco (todas la recomendada).
--
-- WHAT THIS DOES:
--   1. `facet_level`: Logística, Full de ruta y Comidas existen también en el
--      proyecto (pregunta 2), y los paquetes de las membresías de proyecto se
--      re-expanden: solo se AÑADEN filas `preset` de esas tres facetas; las
--      `override` y todo lo demás no se tocan. Foto antes y después: si cambia
--      algo fuera de eso, la migración aborta.
--   2. `thread`: un ancla (proyecto, línea, bolo o conversación, exactamente
--      una) y una faceta opcional (NULL = General). Un General y un hilo por
--      faceta en cada contenedor. Nace perezoso: lo crea el primer mensaje.
--   3. `message`: el autor es siempre `auth.uid()` (sin invitados, ADR-099 §7);
--      de qué función habla en un hilo de bolo; borrado blando. FK compuesta
--      (thread_id, workspace_id) -> thread: el espacio del mensaje es el del
--      hilo por esquema (hallazgo 29 del review de julio).
--   4. `thread_read`: hasta dónde ha leído cada persona cada hilo (pregunta 6).
--   5. Lectura: `private.can_read_thread`, en dos ramas excluyentes. Hilo de
--      conversación: quien lee la conversación (viva, Converses y su
--      privacidad). Hilo de contenedor: General, el acceso al contenedor por
--      la cadena; faceta, ver esa faceta por la cadena, con la faceta
--      existente en el nivel y activa en el espacio. Los mensajes heredan la
--      frontera del hilo con la RLS del que llama (patrón ADR-098).
--   6. Escritura solo por RPC: post_message, edit_message, delete_message,
--      mark_thread_read. Ver una faceta es leer y escribir en su hilo
--      (pregunta 3). Lecturas por RPC: thread_audience (la línea de audiencia,
--      solo a quien ya lee el hilo) y bolo_board (el tablón desde una función,
--      sin dinero; pregunta 1).
--
-- «No existe» y «no es tuyo» dan el mismo 42501 en todas las RPC.
-- Sin write_audit: el mensaje ya es el registro, y su cuerpo no se copia a
-- audit_log (ADR-100, añadido). Sin realtime (ADR-083 §2). `note` no se toca
-- (pregunta 4).
--
-- ADITIVA según § 34: tablas, funciones y filas nuevas. El paso 1 AÑADE
-- acceso efectivo (gana, no pierde) a las membresías de proyecto con paquete
-- Equip, Coordinació o Direcció. El Worker desplegado no lee nada de esto.
-- Rollback: build/runbooks/rollback-20261014-comms-threads.sql.

-- ── 1 · Logística, Full de ruta y Comidas en el proyecto (pregunta 2) ─────
CREATE TEMP TABLE comms_access_before AS
SELECT mf.membership_id, mf.facet_id, mf.verb, mf.source
FROM public.membership_facet mf;

INSERT INTO public.facet_level (facet_id, level)
SELECT f.id, 'project'::public.container_level
FROM public.facet f
WHERE f.workspace_id IS NULL
  AND f.key IN ('logistica', 'full_de_ruta', 'comidas')
ON CONFLICT DO NOTHING;

-- Re-expansión: lo mismo que private.expand_preset haría hoy con cada paquete
-- de proyecto, limitado a las tres facetas que acaban de existir ahí.
INSERT INTO public.membership_facet (membership_id, facet_id, verb, source, granted_by)
SELECT m.id, f.id, pf.verb, 'preset', NULL
FROM public.membership m
JOIN public.access_preset_facet pf ON pf.preset_key = m.preset
JOIN public.facet f ON f.key = pf.facet_key AND f.workspace_id IS NULL
WHERE m.level = 'project'
  AND m.preset IS NOT NULL
  AND f.key IN ('logistica', 'full_de_ruta', 'comidas')
  AND NOT EXISTS (
    SELECT 1 FROM public.membership_facet o
    WHERE o.membership_id = m.id AND o.facet_id = f.id
  );

DO $$
DECLARE
  v_lost    bigint;
  v_foreign bigint;
  v_added   bigint;
BEGIN
  SELECT count(*) INTO v_lost
  FROM (
    SELECT * FROM comms_access_before
    EXCEPT
    SELECT mf.membership_id, mf.facet_id, mf.verb, mf.source FROM public.membership_facet mf
  ) x;

  WITH added AS (
    SELECT mf.membership_id, mf.facet_id, mf.verb, mf.source FROM public.membership_facet mf
    EXCEPT
    SELECT * FROM comms_access_before
  )
  SELECT count(*),
         count(*) FILTER (
           WHERE NOT (
             m.level = 'project'
             AND a.source = 'preset'
             AND f.workspace_id IS NULL
             AND f.key IN ('logistica', 'full_de_ruta', 'comidas')
             AND EXISTS (
               SELECT 1 FROM public.access_preset_facet pf
               WHERE pf.preset_key = m.preset AND pf.facet_key = f.key AND pf.verb = a.verb
             )
           )
         )
  INTO v_added, v_foreign
  FROM added a
  JOIN public.membership m ON m.id = a.membership_id
  JOIN public.facet f ON f.id = a.facet_id;

  IF v_lost > 0 OR v_foreign > 0 THEN
    RAISE EXCEPTION 'comms threads: access changed outside the re-expansion (lost %, foreign %)', v_lost, v_foreign;
  END IF;
  RAISE NOTICE 'comms threads: re-expansion added % facet rows to project memberships', v_added;
END;
$$;

DROP TABLE comms_access_before;

-- ── 2 · ayudantes de lectura ──────────────────────────────────────────────
-- El espacio de un contenedor de hilo vivo (proyecto, línea o bolo, con su
-- proyecto vivo). NULL si no existe o está borrado.
CREATE FUNCTION private.thread_container_workspace(p_level public.container_level, p_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE p_level
    WHEN 'project' THEN (
      SELECT pr.workspace_id FROM public.project pr
      WHERE pr.id = p_id AND pr.deleted_at IS NULL)
    WHEN 'line' THEN (
      SELECT l.workspace_id FROM public.line l
      JOIN public.project pr ON pr.id = l.project_id
      WHERE l.id = p_id AND l.deleted_at IS NULL AND pr.deleted_at IS NULL)
    WHEN 'bolo' THEN (
      SELECT b.workspace_id FROM public.bolo b
      JOIN public.project pr ON pr.id = b.project_id
      WHERE b.id = p_id AND b.deleted_at IS NULL AND pr.deleted_at IS NULL)
  END;
$$;

-- Una faceta tiene hilo en un nivel de un espacio: es estándar o del espacio,
-- existe en ese nivel (facet_level) y el espacio no la ha desactivado.
CREATE FUNCTION private.facet_active_at(
  p_level public.container_level, p_workspace_id uuid, p_facet_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.facet f
    JOIN public.facet_level fl ON fl.facet_id = f.id AND fl.level = p_level
    WHERE f.id = p_facet_id
      AND (f.workspace_id IS NULL OR f.workspace_id = p_workspace_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.workspace_facet_setting s
        WHERE s.workspace_id = p_workspace_id AND s.facet_id = f.id AND NOT s.active
      )
  );
$$;

-- Leer una conversación: la misma regla que conversation_select, para un
-- usuario dado. La usan la lectura de hilos y sus RPC.
CREATE FUNCTION private.can_read_conversation(p_conversation_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.conversation c
    WHERE c.id = p_conversation_id
      AND c.deleted_at IS NULL
      AND (c.private_to IS NULL OR c.private_to = p_user_id)
      AND public.has_permission_for_user(c.project_id, 'read:conversation', p_user_id)
  );
$$;

-- Leer el hilo de un contenedor (exista ya o no): miembro aceptado del
-- espacio y, sin faceta, acceso al contenedor por la cadena; con faceta, ver
-- esa faceta por la cadena y la faceta activa en ese nivel. owner/admin lo
-- leen todo lo que existe (model_has_facet_at), por eso facet_active_at va
-- siempre delante.
CREATE FUNCTION private.can_read_container_thread(
  p_level public.container_level, p_id uuid, p_facet_id uuid, p_user_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_ws uuid;
BEGIN
  IF p_user_id IS NULL OR p_level NOT IN ('project', 'line', 'bolo') THEN
    RETURN false;
  END IF;
  v_ws := private.thread_container_workspace(p_level, p_id);
  IF v_ws IS NULL OR NOT private.model_has_workspace_role(v_ws, p_user_id) THEN
    RETURN false;
  END IF;
  IF p_facet_id IS NULL THEN
    RETURN private.model_container_verb_at(p_level, p_id, p_user_id) IS NOT NULL;
  END IF;
  RETURN private.facet_active_at(p_level, v_ws, p_facet_id)
     AND private.model_has_facet_at(p_level, p_id, p_facet_id, 'view', p_user_id);
END;
$$;

-- La regla sobre las columnas de un hilo; la usa la política sin releer la fila.
CREATE FUNCTION private.thread_readable(
  p_conversation_id uuid, p_project_id uuid, p_line_id uuid, p_bolo_id uuid,
  p_facet_id uuid, p_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN p_conversation_id IS NOT NULL THEN
      p_facet_id IS NULL AND private.can_read_conversation(p_conversation_id, p_user_id)
    WHEN p_bolo_id IS NOT NULL THEN private.can_read_container_thread('bolo', p_bolo_id, p_facet_id, p_user_id)
    WHEN p_line_id IS NOT NULL THEN private.can_read_container_thread('line', p_line_id, p_facet_id, p_user_id)
    WHEN p_project_id IS NOT NULL THEN private.can_read_container_thread('project', p_project_id, p_facet_id, p_user_id)
    ELSE false
  END;
$$;


REVOKE ALL ON FUNCTION private.thread_container_workspace(public.container_level, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.facet_active_at(public.container_level, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_read_conversation(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_read_container_thread(public.container_level, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.thread_readable(uuid, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
-- Las políticas corren con los privilegios del que llama: la que nombra
-- la política de thread necesita EXECUTE (mismo patrón que private.has_workspace_role).
-- `private` no está expuesto por PostgREST.
GRANT EXECUTE ON FUNCTION private.thread_readable(uuid, uuid, uuid, uuid, uuid, uuid) TO authenticated;

-- ── 3 · thread ────────────────────────────────────────────────────────────
CREATE TABLE public.thread (
  id              uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  -- Igual al del ancla (guard); nunca lo manda el cliente.
  workspace_id    uuid NOT NULL REFERENCES public.workspace (id) ON DELETE CASCADE,
  project_id      uuid REFERENCES public.project (id) ON DELETE CASCADE,
  line_id         uuid REFERENCES public.line (id) ON DELETE CASCADE,
  bolo_id         uuid REFERENCES public.bolo (id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversation (id) ON DELETE CASCADE,
  -- NULL = General. NO ACTION y no RESTRICT: al borrar un espacio, sus
  -- facetas propias y sus hilos caen en la misma sentencia.
  facet_id        uuid REFERENCES public.facet (id),
  created_by      uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  CONSTRAINT thread_one_anchor
    CHECK (num_nonnulls(project_id, line_id, bolo_id, conversation_id) = 1),
  CONSTRAINT thread_conversation_no_facet
    CHECK (conversation_id IS NULL OR facet_id IS NULL),
  CONSTRAINT thread_anchor_key
    UNIQUE NULLS NOT DISTINCT (workspace_id, project_id, line_id, bolo_id, conversation_id, facet_id),
  CONSTRAINT thread_id_workspace_key UNIQUE (id, workspace_id)
);

COMMENT ON TABLE public.thread IS
  'ADR-106: hilo interno del equipo. Un ancla (proyecto, línea, bolo o conversación) y una faceta opcional (NULL = General, estar en el contenedor). Nace con el primer mensaje (post_message). Lo lee private.can_read_thread; nadie escribe por la API.';
COMMENT ON COLUMN public.thread.facet_id IS
  'NULL = General. Un hilo de conversación nunca lleva faceta: hereda la lectura de la conversación.';
COMMENT ON COLUMN public.thread.last_message_at IS
  'Lo mueve post_message. Ordena «de qué se habla».';

CREATE INDEX thread_workspace_activity_idx
  ON public.thread (workspace_id, last_message_at DESC) WHERE last_message_at IS NOT NULL;
CREATE INDEX thread_project_idx      ON public.thread (project_id)      WHERE project_id IS NOT NULL;
CREATE INDEX thread_line_idx         ON public.thread (line_id)         WHERE line_id IS NOT NULL;
CREATE INDEX thread_bolo_idx         ON public.thread (bolo_id)         WHERE bolo_id IS NOT NULL;
CREATE INDEX thread_conversation_idx ON public.thread (conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX thread_facet_idx        ON public.thread (facet_id)        WHERE facet_id IS NOT NULL;
CREATE INDEX thread_created_by_idx   ON public.thread (created_by)      WHERE created_by IS NOT NULL;

-- El ancla existe, está viva y es del mismo espacio; la faceta tiene hilo en
-- ese nivel. Un solo 42501 para «no existe» y «no es tuyo».
CREATE FUNCTION private.guard_thread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_ws    uuid;
  v_level public.container_level;
BEGIN
  IF NEW.conversation_id IS NOT NULL THEN
    IF NEW.facet_id IS NOT NULL THEN
      RAISE EXCEPTION 'a conversation thread has no facet' USING ERRCODE = '42501';
    END IF;
    SELECT c.workspace_id INTO v_ws
    FROM public.conversation c
    WHERE c.id = NEW.conversation_id AND c.deleted_at IS NULL;
  ELSE
    v_level := CASE
      WHEN NEW.bolo_id IS NOT NULL THEN 'bolo'
      WHEN NEW.line_id IS NOT NULL THEN 'line'
      ELSE 'project'
    END;
    v_ws := private.thread_container_workspace(v_level, coalesce(NEW.bolo_id, NEW.line_id, NEW.project_id));
  END IF;

  IF v_ws IS NULL OR v_ws IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'thread anchor not found' USING ERRCODE = '42501';
  END IF;
  IF NEW.facet_id IS NOT NULL AND NOT private.facet_active_at(v_level, v_ws, NEW.facet_id) THEN
    RAISE EXCEPTION 'facet has no thread here' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- Anclas y faceta inmutables; created_by solo puede quedarse sin login
-- (ON DELETE SET NULL de auth.users).
CREATE FUNCTION private.guard_thread_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.project_id      IS DISTINCT FROM OLD.project_id
  OR NEW.line_id         IS DISTINCT FROM OLD.line_id
  OR NEW.bolo_id         IS DISTINCT FROM OLD.bolo_id
  OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
  OR NEW.facet_id        IS DISTINCT FROM OLD.facet_id
  OR NEW.created_at      IS DISTINCT FROM OLD.created_at
  OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL) THEN
    RAISE EXCEPTION 'thread anchors are immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_thread() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.guard_thread_immutable() FROM PUBLIC;

CREATE TRIGGER thread_guard BEFORE INSERT ON public.thread
  FOR EACH ROW EXECUTE FUNCTION private.guard_thread();
CREATE TRIGGER thread_guard_immutable BEFORE UPDATE ON public.thread
  FOR EACH ROW EXECUTE FUNCTION private.guard_thread_immutable();
CREATE TRIGGER thread_guard_ws BEFORE UPDATE ON public.thread
  FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_workspace_id();
CREATE TRIGGER thread_set_updated_at BEFORE UPDATE ON public.thread
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Un hilo por id, para las RPC.
CREATE FUNCTION private.can_read_thread(p_thread_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce((
    SELECT private.thread_readable(t.conversation_id, t.project_id, t.line_id, t.bolo_id, t.facet_id, p_user_id)
    FROM public.thread t
    WHERE t.id = p_thread_id
  ), false);
$$;
REVOKE ALL ON FUNCTION private.can_read_thread(uuid, uuid) FROM PUBLIC;

-- ── 4 · message ───────────────────────────────────────────────────────────
CREATE TABLE public.message (
  id             uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  thread_id      uuid NOT NULL,
  -- El del hilo, por la FK compuesta; el hilo ya cuelga del espacio.
  workspace_id   uuid NOT NULL,
  -- Revocar no es borrar (ADR-085 §7): si el login se borra, el mensaje queda.
  author_id      uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  -- De qué función habla, solo en un hilo de bolo y de una función de ese bolo.
  performance_id uuid REFERENCES public.performance (id) ON DELETE SET NULL,
  body           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  edited_at      timestamptz,
  deleted_at     timestamptz,
  CONSTRAINT message_thread_fk FOREIGN KEY (thread_id, workspace_id)
    REFERENCES public.thread (id, workspace_id) ON DELETE CASCADE,
  -- Límite propuesto en el plan, sin base medida.
  CONSTRAINT message_body_length CHECK (length(btrim(body)) BETWEEN 1 AND 10000)
);

COMMENT ON TABLE public.message IS
  'ADR-106: mensaje de un hilo interno. Lo lee quien lee su hilo; se escribe solo por post_message, edit_message y delete_message (borrado blando). Sin copia a audit_log.';
COMMENT ON COLUMN public.message.performance_id IS
  'Variante «a» de la maqueta (ADR-099 §6): en el tablón del bolo, de qué función habla. NULL = del bolo.';

CREATE INDEX message_thread_workspace_idx ON public.message (thread_id, workspace_id);
CREATE INDEX message_thread_live_idx
  ON public.message (thread_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX message_author_idx      ON public.message (author_id)      WHERE author_id IS NOT NULL;
CREATE INDEX message_performance_idx ON public.message (performance_id) WHERE performance_id IS NOT NULL;

-- La función nombrada cuelga del bolo del hilo; hilo, autor y fecha no se
-- mueven (autor y función solo pueden quedarse en NULL por su ON DELETE).
CREATE FUNCTION private.guard_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.thread_id  IS DISTINCT FROM OLD.thread_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (NEW.author_id      IS DISTINCT FROM OLD.author_id      AND NEW.author_id      IS NOT NULL)
    OR (NEW.performance_id IS DISTINCT FROM OLD.performance_id AND NEW.performance_id IS NOT NULL) THEN
      RAISE EXCEPTION 'message anchors are immutable' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.performance_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.thread t
    JOIN public.performance pf ON pf.bolo_id = t.bolo_id
    WHERE t.id = NEW.thread_id
      AND pf.id = NEW.performance_id
      AND pf.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'the performance does not hang from this thread''s bolo' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_message() FROM PUBLIC;

CREATE TRIGGER message_guard BEFORE INSERT OR UPDATE ON public.message
  FOR EACH ROW EXECUTE FUNCTION private.guard_message();
CREATE TRIGGER message_guard_ws BEFORE UPDATE ON public.message
  FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_workspace_id();
CREATE TRIGGER message_set_updated_at BEFORE UPDATE ON public.message
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 5 · thread_read ───────────────────────────────────────────────────────
CREATE TABLE public.thread_read (
  thread_id    uuid NOT NULL REFERENCES public.thread (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);
COMMENT ON TABLE public.thread_read IS
  'ADR-106, pregunta 6: hasta dónde ha leído cada persona cada hilo. Solo la fila propia; la escriben mark_thread_read y post_message.';
CREATE INDEX thread_read_user_idx ON public.thread_read (user_id);

-- ── 6 · RLS y grants ──────────────────────────────────────────────────────
ALTER TABLE public.thread      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thread      FORCE ROW LEVEL SECURITY;
ALTER TABLE public.message     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.thread_read ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thread_read FORCE ROW LEVEL SECURITY;
ALTER TABLE public.thread      OWNER TO postgres;
ALTER TABLE public.message     OWNER TO postgres;
ALTER TABLE public.thread_read OWNER TO postgres;

REVOKE ALL ON TABLE public.thread, public.message, public.thread_read FROM PUBLIC, anon;
-- Solo lectura, a TABLA entera: sin grant por columnas no hay columna que se
-- quede fuera de un `select` (la rotura de `performance` del 2026-08-29).
GRANT SELECT ON TABLE public.thread, public.message, public.thread_read TO authenticated;
GRANT ALL ON TABLE public.thread, public.message, public.thread_read TO service_role;

CREATE POLICY thread_select ON public.thread
  FOR SELECT TO authenticated
  USING (private.thread_readable(conversation_id, project_id, line_id, bolo_id, facet_id, (SELECT auth.uid())));

-- Hereda la frontera del hilo con la RLS del que llama (patrón de
-- conversation_event_select, ADR-098): un mensaje no se ve si su hilo no se ve.
CREATE POLICY message_select ON public.message
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.thread t WHERE t.id = message.thread_id)
  );

CREATE POLICY thread_read_select ON public.thread_read
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ── 7 · RPC de escritura ──────────────────────────────────────────────────
-- post_message: crea el hilo si falta y escribe con el que llama como autor.
-- En este corte abre hilos de bolo y de conversación (pregunta 5); proyecto y
-- línea caben en el esquema sin migrar.
CREATE FUNCTION public.post_message(
  p_anchor_kind    text,
  p_anchor_id      uuid,
  p_body           text,
  p_facet_id       uuid DEFAULT NULL,
  p_performance_id uuid DEFAULT NULL
) RETURNS public.message
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_body   text := btrim(coalesce(p_body, ''));
  v_bolo   uuid;
  v_conv   uuid;
  v_ws     uuid;
  v_thread uuid;
  v_row    public.message;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_anchor_kind IS NULL OR p_anchor_kind NOT IN ('bolo', 'conversation') THEN
    RAISE EXCEPTION 'anchor kind must be bolo or conversation' USING ERRCODE = '22023';
  END IF;

  IF p_anchor_kind = 'conversation' THEN
    IF p_facet_id IS NOT NULL OR NOT private.can_read_conversation(p_anchor_id, v_caller) THEN
      RAISE EXCEPTION 'thread not found' USING ERRCODE = '42501';
    END IF;
    v_conv := p_anchor_id;
    SELECT c.workspace_id INTO v_ws FROM public.conversation c WHERE c.id = v_conv;
  ELSE
    IF NOT private.can_read_container_thread('bolo', p_anchor_id, p_facet_id, v_caller) THEN
      RAISE EXCEPTION 'thread not found' USING ERRCODE = '42501';
    END IF;
    v_bolo := p_anchor_id;
    v_ws := private.thread_container_workspace('bolo', v_bolo);
  END IF;

  IF length(v_body) NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'body must be 1 to 10000 characters' USING ERRCODE = '22023';
  END IF;
  IF p_performance_id IS NOT NULL AND (v_bolo IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.performance pf
    WHERE pf.id = p_performance_id AND pf.bolo_id = v_bolo AND pf.deleted_at IS NULL
  )) THEN
    RAISE EXCEPTION 'the performance does not hang from this bolo' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.thread (workspace_id, bolo_id, conversation_id, facet_id, created_by)
  VALUES (v_ws, v_bolo, v_conv, p_facet_id, v_caller)
  ON CONFLICT ON CONSTRAINT thread_anchor_key DO NOTHING;

  SELECT t.id INTO v_thread
  FROM public.thread t
  WHERE t.workspace_id = v_ws
    AND t.project_id IS NULL
    AND t.line_id IS NULL
    AND t.bolo_id IS NOT DISTINCT FROM v_bolo
    AND t.conversation_id IS NOT DISTINCT FROM v_conv
    AND t.facet_id IS NOT DISTINCT FROM p_facet_id;

  INSERT INTO public.message (thread_id, workspace_id, author_id, performance_id, body)
  VALUES (v_thread, v_ws, v_caller, p_performance_id, v_body)
  RETURNING * INTO v_row;

  UPDATE public.thread
  SET last_message_at = greatest(coalesce(last_message_at, v_row.created_at), v_row.created_at)
  WHERE id = v_thread;

  -- Lo propio no es «no leído».
  INSERT INTO public.thread_read (thread_id, user_id, last_read_at)
  VALUES (v_thread, v_caller, v_row.created_at)
  ON CONFLICT (thread_id, user_id)
  DO UPDATE SET last_read_at = greatest(public.thread_read.last_read_at, excluded.last_read_at);

  RETURN v_row;
END;
$$;

-- edit_message: el autor, mientras siga leyendo el hilo.
CREATE FUNCTION public.edit_message(p_message_id uuid, p_body text)
RETURNS public.message
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_body   text := btrim(coalesce(p_body, ''));
  v_row    public.message;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row
  FROM public.message
  WHERE id = p_message_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_row.id IS NULL
     OR v_row.author_id IS DISTINCT FROM v_caller
     OR NOT private.can_read_thread(v_row.thread_id, v_caller) THEN
    RAISE EXCEPTION 'message % not found', p_message_id USING ERRCODE = '42501';
  END IF;
  IF length(v_body) NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'body must be 1 to 10000 characters' USING ERRCODE = '22023';
  END IF;

  UPDATE public.message
  SET body = v_body, edited_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- delete_message: borrado blando, solo el autor.
CREATE FUNCTION public.delete_message(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.message
  SET deleted_at = now()
  WHERE id = p_message_id
    AND deleted_at IS NULL
    AND author_id = v_caller;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'message % not found', p_message_id USING ERRCODE = '42501';
  END IF;
END;
$$;

-- mark_thread_read: leído hasta el último mensaje del hilo.
CREATE FUNCTION public.mark_thread_read(p_thread_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_at     timestamptz;
BEGIN
  IF v_caller IS NULL OR NOT private.can_read_thread(p_thread_id, v_caller) THEN
    RAISE EXCEPTION 'thread % not found', p_thread_id USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(max(m.created_at), now()) INTO v_at
  FROM public.message m
  WHERE m.thread_id = p_thread_id;

  INSERT INTO public.thread_read (thread_id, user_id, last_read_at)
  VALUES (p_thread_id, v_caller, v_at)
  ON CONFLICT (thread_id, user_id)
  DO UPDATE SET last_read_at = greatest(public.thread_read.last_read_at, excluded.last_read_at)
  RETURNING last_read_at INTO v_at;

  RETURN v_at;
END;
$$;

-- ── 8 · RPC de lectura ────────────────────────────────────────────────────
-- thread_audience: la línea de audiencia («Lo ven N, por permiso de X»), que
-- no se pliega nunca (ADR-083 enmienda §6). Solo a quien ya lee el hilo, y
-- solo de ese hilo: no publica la matriz de permisos (hallazgo 12).
CREATE FUNCTION public.thread_audience(
  p_anchor_kind text,
  p_anchor_id   uuid,
  p_facet_id    uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_ws     uuid;
  v_people jsonb;
  v_reason jsonb;
BEGIN
  IF v_caller IS NULL OR p_anchor_kind IS NULL OR p_anchor_kind NOT IN ('bolo', 'conversation') THEN
    RAISE EXCEPTION 'thread not found' USING ERRCODE = '42501';
  END IF;

  IF p_anchor_kind = 'conversation' THEN
    IF p_facet_id IS NOT NULL OR NOT private.can_read_conversation(p_anchor_id, v_caller) THEN
      RAISE EXCEPTION 'thread not found' USING ERRCODE = '42501';
    END IF;
    SELECT c.workspace_id INTO v_ws FROM public.conversation c WHERE c.id = p_anchor_id;
    v_reason := jsonb_build_object('kind', 'conversation');
  ELSE
    IF NOT private.can_read_container_thread('bolo', p_anchor_id, p_facet_id, v_caller) THEN
      RAISE EXCEPTION 'thread not found' USING ERRCODE = '42501';
    END IF;
    v_ws := private.thread_container_workspace('bolo', p_anchor_id);
    v_reason := CASE
      WHEN p_facet_id IS NULL THEN jsonb_build_object('kind', 'container', 'level', 'bolo')
      ELSE (
        SELECT jsonb_build_object(
          'kind', 'facet', 'facet_id', f.id, 'facet_key', f.key,
          'label', coalesce(s.label, f.label),
          'labels', f.labels || coalesce(s.labels, '{}'::jsonb))
        FROM public.facet f
        LEFT JOIN public.workspace_facet_setting s ON s.workspace_id = v_ws AND s.facet_id = f.id
        WHERE f.id = p_facet_id)
    END;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'name', x.name)
                            ORDER BY x.name NULLS LAST, x.user_id), '[]'::jsonb)
  INTO v_people
  FROM (
    SELECT m.user_id, up.full_name AS name
    FROM public.membership m
    LEFT JOIN public.user_profile up ON up.user_id = m.user_id
    WHERE m.level = 'workspace'
      AND m.workspace_id = v_ws
      AND m.accepted_at IS NOT NULL
      AND CASE p_anchor_kind
            WHEN 'conversation' THEN private.can_read_conversation(p_anchor_id, m.user_id)
            ELSE private.can_read_container_thread('bolo', p_anchor_id, p_facet_id, m.user_id)
          END
  ) x;

  RETURN jsonb_build_object(
    'count', jsonb_array_length(v_people),
    'reason', v_reason,
    'people', v_people
  );
END;
$$;

-- bolo_board: el tablón del bolo de una función (pregunta 1). Desde una
-- función a la que tienes acceso: el bolo SIN dinero (sin caché, estado del
-- trato, pagador ni conversación), sus funciones hermanas (día, hora, sala) y
-- los hilos que puedes leer, existan ya o no, con recuento y no leídos.
-- Una función sin bolo no tiene tablón: `bolo` sale NULL.
CREATE FUNCTION public.bolo_board(p_performance_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_perf    public.performance;
  v_bolo    public.bolo;
  v_perfs   jsonb;
  v_threads jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT pf.* INTO v_perf
  FROM public.performance pf
  JOIN public.project pr ON pr.id = pf.project_id AND pr.deleted_at IS NULL
  WHERE pf.id = p_performance_id AND pf.deleted_at IS NULL;

  IF v_perf.id IS NULL
     OR NOT private.model_has_workspace_role(v_perf.workspace_id, v_caller)
     OR private.model_container_verb_at('performance', v_perf.id, v_caller) IS NULL THEN
    RAISE EXCEPTION 'performance % not found', p_performance_id USING ERRCODE = '42501';
  END IF;

  SELECT b.* INTO v_bolo
  FROM public.bolo b
  WHERE b.id = v_perf.bolo_id AND b.deleted_at IS NULL;

  IF v_bolo.id IS NULL THEN
    RETURN jsonb_build_object('bolo', NULL, 'performances', '[]'::jsonb, 'threads', '[]'::jsonb);
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'slug', x.slug, 'performed_at', x.performed_at,
           'start_at', x.start_at, 'venue_name', x.venue_name, 'city', x.city)
         ORDER BY x.performed_at, x.start_at NULLS LAST, x.id), '[]'::jsonb)
  INTO v_perfs
  FROM (
    SELECT pf.id, pf.slug, pf.performed_at, pf.venue_name, pf.city,
           (SELECT s.at FROM public.schedule_slot s
            WHERE s.performance_id = pf.id AND s.kind = 'start'
            ORDER BY s.sort LIMIT 1) AS start_at
    FROM public.performance pf
    WHERE pf.bolo_id = v_bolo.id AND pf.deleted_at IS NULL
  ) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'thread_id', t.id,
           'facet_id', x.facet_id,
           'facet_key', x.facet_key,
           'label', x.label,
           'labels', x.labels,
           'message_count', coalesce(c.total, 0),
           'unread_count', coalesce(c.unread, 0),
           'last_message_at', t.last_message_at)
         ORDER BY x.sort, x.facet_key NULLS FIRST), '[]'::jsonb)
  INTO v_threads
  FROM (
    SELECT NULL::uuid AS facet_id, NULL::text AS facet_key, NULL::text AS label,
           '{}'::jsonb AS labels, (-32768)::int AS sort
    UNION ALL
    SELECT f.id, f.key, coalesce(s.label, f.label), f.labels || coalesce(s.labels, '{}'::jsonb),
           coalesce(s.sort, f.sort)::int
    FROM public.facet f
    JOIN public.facet_level fl ON fl.facet_id = f.id AND fl.level = 'bolo'
    LEFT JOIN public.workspace_facet_setting s ON s.workspace_id = v_bolo.workspace_id AND s.facet_id = f.id
    WHERE f.workspace_id IS NULL OR f.workspace_id = v_bolo.workspace_id
  ) x
  LEFT JOIN public.thread t
    ON t.bolo_id = v_bolo.id AND t.facet_id IS NOT DISTINCT FROM x.facet_id
  LEFT JOIN public.thread_read r
    ON r.thread_id = t.id AND r.user_id = v_caller
  LEFT JOIN LATERAL (
    SELECT count(*) AS total,
           count(*) FILTER (
             WHERE m.author_id IS DISTINCT FROM v_caller
               AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
           ) AS unread
    FROM public.message m
    WHERE m.thread_id = t.id AND m.deleted_at IS NULL
  ) c ON true
  WHERE private.can_read_container_thread('bolo', v_bolo.id, x.facet_id, v_caller);

  RETURN jsonb_build_object(
    'bolo', jsonb_build_object(
      'id', v_bolo.id,
      'project_id', v_bolo.project_id,
      'line_id', v_bolo.line_id,
      'venue_name', v_bolo.venue_name,
      'city', v_bolo.city,
      'country', v_bolo.country),
    'performances', v_perfs,
    'threads', v_threads
  );
END;
$$;

COMMENT ON FUNCTION public.post_message(text, uuid, text, uuid, uuid) IS
  'ADR-106: escribe en el hilo de un bolo (General o faceta) o de una conversación; lo crea si falta. Puerta: leer el hilo (ver una faceta es escribir en su hilo). Autor = auth.uid().';
COMMENT ON FUNCTION public.edit_message(uuid, text) IS
  'ADR-106: el autor cambia el cuerpo de su mensaje, mientras siga leyendo el hilo.';
COMMENT ON FUNCTION public.delete_message(uuid) IS
  'ADR-106: borrado blando de un mensaje propio.';
COMMENT ON FUNCTION public.mark_thread_read(uuid) IS
  'ADR-106, pregunta 6: marca el hilo leído hasta su último mensaje.';
COMMENT ON FUNCTION public.thread_audience(text, uuid, uuid) IS
  'ADR-106: quién lee un hilo y por qué ({count, reason, people}), solo a quien ya lo lee.';
COMMENT ON FUNCTION public.bolo_board(uuid) IS
  'ADR-106, pregunta 1: el tablón del bolo de una función, sin dinero, a quien tiene acceso a la función: bolo (sala, ciudad), funciones hermanas (día, hora, sala) e hilos legibles con recuento y no leídos.';

REVOKE ALL ON FUNCTION public.post_message(text, uuid, text, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_message(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_message(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_thread_read(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.thread_audience(text, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bolo_board(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_message(text, uuid, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_message(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_thread_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.thread_audience(text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bolo_board(uuid) TO authenticated;
