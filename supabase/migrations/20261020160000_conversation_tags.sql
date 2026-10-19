-- Etiquetas de conversación, fase 1: solo esquema (ADR-138 § 1).
--
-- Plan: `build/plans/2026-10-19-conversations-tags.md` § 2 «Esquema» y
-- «Permisos», § 4, § 5 y § 6 fase 1, con § 8 encima: `deal_default` no
-- existe y esta migración NO toca `conversation.status`.
--
--   1. `conversation_tag`: el vocabulario, con la forma de `facet` (ADR-099,
--      añadido). workspace_id NULL = estándar de Hour, nombrada por la clave
--      i18n; con workspace_id = propia del espacio, con su nombre. Estándar:
--      sales, press, coproduction, distribution.
--   2. `workspace_conversation_tag_setting`: renombrar, desactivar u ordenar
--      una etiqueta en un espacio, como `workspace_facet_setting`.
--   3. `UNIQUE (id, workspace_id)` en `conversation`, para la FK compuesta.
--   4. `conversation_tagging`: qué etiquetas lleva cada conversación. FK
--      compuesta a `conversation (id, workspace_id)`: una etiqueta no cruza
--      espacios. Un trigger exige que la etiqueta sea estándar o del espacio
--      de la conversación, y que esté activa allí.
--   5. Relleno: TODAS las conversaciones (vivas y borradas, para que revivir
--      una la deje como estaba) reciben `sales`.
--   6. `conversation_read`: hasta cuándo ha leído cada persona cada
--      conversación. Sin relleno: «sin fila» lo resuelve la regla de lectura
--      de la fase 3 (leído hasta la creación de la conversación).
--   7. RPC `set_conversation_tags` y `mark_conversation_read`.
--
-- LA ETIQUETA NUNCA DECIDE PERMISOS (ADR-138 § 1). Ninguna política de otra
-- tabla ni ninguna función `private.*` nombra las tablas de etiquetas; el
-- paso 9 lo comprueba y aborta si no. Por eso los triggers de guarda viven en
-- `public` y no en `private`.
--
-- Lectura:
--   · vocabulario y ajustes: cualquier miembro del espacio (son nombres);
--   · `conversation_tagging`: EXISTS sobre `conversation`, con la RLS del que
--     llama (patrón de `conversation_event_select`): quien no ve la
--     conversación no ve sus etiquetas;
--   · `conversation_read`: la fila propia.
-- Escritura:
--   · etiquetas propias y ajustes: el admin del espacio, por grant de
--     columnas, como las facetas propias. Sin DELETE: desactivar es un ajuste;
--   · asignaciones: solo `set_conversation_tags`, para quien edita la
--     conversación (`edit:conversation` y su privacidad). Sin grant directo;
--   · lecturas: solo `mark_conversation_read`.
--
-- Funciones existentes que se llaman (firmas copiadas de producción con
-- `pg_get_functiondef`, 2026-10-19): `private.can_read_conversation(uuid,
-- uuid)`, `public.has_permission_for_user(uuid, text, uuid)`,
-- `public.is_workspace_member(uuid)`, `public.is_workspace_admin(uuid)`,
-- `public.guard_immutable_workspace_id()`, `public.set_updated_at()`. No se
-- redefine ninguna.
--
-- ADITIVA según § 34: tablas, funciones, una restricción única nueva y filas
-- nuevas; ninguna política existente cambia. El paso 0 y el 9 hacen la foto de
-- cuántas conversaciones lee cada membresía de `muk-cia` antes y después, y
-- abortan si cambia. El Worker desplegado no lee nada de esto.
-- Rollback: build/runbooks/rollback-20261020160000-conversation-tags.sql.

-- ── 0 · foto de antes ────────────────────────────────────────────────────
-- La migración entera va en una transacción (db push): la tabla temporal
-- vive hasta el paso 9.
CREATE TEMP TABLE conversation_tags_access_before ON COMMIT DROP AS
SELECT m.id AS membership_id,
       m.user_id,
       (SELECT count(*)
        FROM public.conversation c
        WHERE c.workspace_id = w.id
          AND private.can_read_conversation(c.id, m.user_id)) AS readable
FROM public.membership m
JOIN public.workspace w ON w.id = m.workspace_id
WHERE w.slug = 'muk-cia';

-- ── 1 · vocabulario ──────────────────────────────────────────────────────
CREATE TABLE public.conversation_tag (
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
  CONSTRAINT conversation_tag_label_by_kind CHECK (
    (workspace_id IS NULL AND label IS NULL AND labels = '{}'::jsonb)
    OR (workspace_id IS NOT NULL AND label IS NOT NULL)
  )
);
COMMENT ON TABLE public.conversation_tag IS
  'Etiquetas de conversación (ADR-138 § 1), con la forma de facet. workspace_id NULL = estándar de Hour, nombre por clave i18n; con workspace_id = propia del espacio, nombre en label y traducciones opcionales en labels {ca,es,en,fr}. NUNCA decide permisos. Equipo no está: lo tienen todos los hilos.';
CREATE UNIQUE INDEX conversation_tag_standard_key ON public.conversation_tag (key) WHERE workspace_id IS NULL;
CREATE UNIQUE INDEX conversation_tag_workspace_key ON public.conversation_tag (workspace_id, key) WHERE workspace_id IS NOT NULL;
CREATE INDEX conversation_tag_created_by_idx ON public.conversation_tag (created_by);

CREATE TRIGGER conversation_tag_guard_ws BEFORE UPDATE ON public.conversation_tag
  FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_workspace_id();
CREATE TRIGGER conversation_tag_set_updated_at BEFORE UPDATE ON public.conversation_tag
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- La clave no cambia: las traducciones y el panel de Difusión (`sales`) la usan.
CREATE FUNCTION public.guard_conversation_tag_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'conversation tag key is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_conversation_tag_key() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER conversation_tag_guard_key BEFORE UPDATE ON public.conversation_tag
  FOR EACH ROW EXECUTE FUNCTION public.guard_conversation_tag_key();

INSERT INTO public.conversation_tag (key, sort) VALUES
  ('sales',        10),
  ('press',        20),
  ('coproduction', 30),
  ('distribution', 40);

-- ── 2 · ajustes por espacio ──────────────────────────────────────────────
CREATE TABLE public.workspace_conversation_tag_setting (
  workspace_id uuid NOT NULL REFERENCES public.workspace (id) ON DELETE CASCADE,
  tag_id       uuid NOT NULL REFERENCES public.conversation_tag (id) ON DELETE CASCADE,
  label        text CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 60),
  labels       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(labels) = 'object'),
  active       boolean NOT NULL DEFAULT true,
  sort         smallint,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, tag_id)
);
COMMENT ON TABLE public.workspace_conversation_tag_setting IS
  'Ajustes de un espacio sobre una etiqueta de conversación: renombrar (label, labels), desactivar (active) y ordenar. Desactivar la oculta y no deja ponerla; NO borra las asignaciones, que vuelven al reactivarla.';
CREATE INDEX workspace_conversation_tag_setting_tag_idx ON public.workspace_conversation_tag_setting (tag_id);
CREATE TRIGGER workspace_conversation_tag_setting_guard_ws BEFORE UPDATE ON public.workspace_conversation_tag_setting
  FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_workspace_id();
CREATE TRIGGER workspace_conversation_tag_setting_set_updated_at BEFORE UPDATE ON public.workspace_conversation_tag_setting
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Un ajuste solo puede tocar una etiqueta estándar o una propia del mismo espacio.
CREATE FUNCTION public.guard_workspace_conversation_tag_setting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_tag t
    WHERE t.id = NEW.tag_id
      AND (t.workspace_id IS NULL OR t.workspace_id = NEW.workspace_id)
  ) THEN
    RAISE EXCEPTION 'conversation tag % does not belong to workspace %', NEW.tag_id, NEW.workspace_id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_workspace_conversation_tag_setting() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER workspace_conversation_tag_setting_guard_tag
  BEFORE INSERT OR UPDATE ON public.workspace_conversation_tag_setting
  FOR EACH ROW EXECUTE FUNCTION public.guard_workspace_conversation_tag_setting();

-- ── 3 · conversation (id, workspace_id) ──────────────────────────────────
-- Aditiva: `id` ya es único; esto solo da la clave a la FK compuesta.
ALTER TABLE public.conversation
  ADD CONSTRAINT conversation_id_workspace_key UNIQUE (id, workspace_id);

-- ── 4 · asignaciones ─────────────────────────────────────────────────────
CREATE TABLE public.conversation_tagging (
  conversation_id uuid NOT NULL,
  tag_id          uuid NOT NULL REFERENCES public.conversation_tag (id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL,
  created_by      uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, tag_id),
  CONSTRAINT conversation_tagging_conversation_fk FOREIGN KEY (conversation_id, workspace_id)
    REFERENCES public.conversation (id, workspace_id) ON DELETE CASCADE
);
COMMENT ON TABLE public.conversation_tagging IS
  'Qué etiquetas lleva cada conversación (ADR-138 § 1: varias). Se lee como la conversación; se escribe solo por set_conversation_tags. NUNCA decide permisos: ninguna política de otra tabla ni función private.* la nombra.';
CREATE INDEX conversation_tagging_tag_idx ON public.conversation_tagging (tag_id);
CREATE INDEX conversation_tagging_workspace_tag_idx ON public.conversation_tagging (workspace_id, tag_id);
CREATE INDEX conversation_tagging_created_by_idx ON public.conversation_tagging (created_by);

-- La etiqueta es estándar o del espacio de la conversación, y está activa allí.
CREATE FUNCTION public.guard_conversation_tagging()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_tag t
    WHERE t.id = NEW.tag_id
      AND (t.workspace_id IS NULL OR t.workspace_id = NEW.workspace_id)
  ) THEN
    RAISE EXCEPTION 'conversation tag % does not belong to workspace %', NEW.tag_id, NEW.workspace_id
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.workspace_conversation_tag_setting s
    WHERE s.workspace_id = NEW.workspace_id AND s.tag_id = NEW.tag_id AND NOT s.active
  ) THEN
    RAISE EXCEPTION 'conversation tag % is not active in workspace %', NEW.tag_id, NEW.workspace_id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_conversation_tagging() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER conversation_tagging_guard BEFORE INSERT OR UPDATE ON public.conversation_tagging
  FOR EACH ROW EXECUTE FUNCTION public.guard_conversation_tagging();

-- ── 5 · relleno: todas las conversaciones existentes, `sales` ────────────
INSERT INTO public.conversation_tagging (conversation_id, tag_id, workspace_id, created_by)
SELECT c.id, t.id, c.workspace_id, NULL
FROM public.conversation c
CROSS JOIN public.conversation_tag t
WHERE t.workspace_id IS NULL AND t.key = 'sales';

-- ── 6 · lecturas ─────────────────────────────────────────────────────────
CREATE TABLE public.conversation_read (
  conversation_id uuid NOT NULL REFERENCES public.conversation (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  last_read_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
COMMENT ON TABLE public.conversation_read IS
  'ADR-138 / plan § 2: hasta cuándo ha leído cada persona cada conversación, como thread_read. Sin fila = leída hasta su creación (regla de la fase 3). Solo la fila propia; la escribe mark_conversation_read.';
CREATE INDEX conversation_read_user_idx ON public.conversation_read (user_id);

-- ── 7 · RLS y grants ─────────────────────────────────────────────────────
ALTER TABLE public.conversation_tag                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_tag                    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_conversation_tag_setting  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_conversation_tag_setting  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_tagging                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_tagging                FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_read                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_read                   FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_tag                    OWNER TO postgres;
ALTER TABLE public.workspace_conversation_tag_setting  OWNER TO postgres;
ALTER TABLE public.conversation_tagging                OWNER TO postgres;
ALTER TABLE public.conversation_read                   OWNER TO postgres;

-- authenticated incluido: el checkpoint le da ALL por defecto (patrón de
-- thread_read, 20261014100000_comms_threads).
REVOKE ALL ON TABLE public.conversation_tag, public.workspace_conversation_tag_setting,
                    public.conversation_tagging, public.conversation_read
  FROM PUBLIC, anon, authenticated;
-- Lectura a tabla entera: sin grant por columnas no hay columna que se quede
-- fuera de un `select`.
GRANT SELECT ON TABLE public.conversation_tag, public.workspace_conversation_tag_setting,
                      public.conversation_tagging, public.conversation_read
  TO authenticated;
GRANT ALL ON TABLE public.conversation_tag, public.workspace_conversation_tag_setting,
                   public.conversation_tagging, public.conversation_read
  TO service_role;
-- El admin configura las etiquetas de su espacio (la pantalla llega en la
-- fase 4). Sin DELETE: desactivar es un ajuste.
GRANT INSERT (workspace_id, key, label, labels, sort, created_by),
      UPDATE (label, labels, sort) ON public.conversation_tag TO authenticated;
GRANT INSERT (workspace_id, tag_id, label, labels, active, sort),
      UPDATE (label, labels, active, sort) ON public.workspace_conversation_tag_setting TO authenticated;

CREATE POLICY conversation_tag_select ON public.conversation_tag
  FOR SELECT TO authenticated
  USING (workspace_id IS NULL OR public.is_workspace_member(workspace_id));
CREATE POLICY conversation_tag_insert ON public.conversation_tag
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id IS NOT NULL AND public.is_workspace_admin(workspace_id)
              AND created_by = (SELECT auth.uid()));
CREATE POLICY conversation_tag_update ON public.conversation_tag
  FOR UPDATE TO authenticated
  USING (workspace_id IS NOT NULL AND public.is_workspace_admin(workspace_id))
  WITH CHECK (workspace_id IS NOT NULL AND public.is_workspace_admin(workspace_id));

CREATE POLICY workspace_conversation_tag_setting_select ON public.workspace_conversation_tag_setting
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));
CREATE POLICY workspace_conversation_tag_setting_insert ON public.workspace_conversation_tag_setting
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_admin(workspace_id));
CREATE POLICY workspace_conversation_tag_setting_update ON public.workspace_conversation_tag_setting
  FOR UPDATE TO authenticated
  USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

-- Hereda la frontera de la conversación con la RLS del que llama (patrón de
-- conversation_event_select): viva, Converses y su privacidad.
CREATE POLICY conversation_tagging_select ON public.conversation_tagging
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversation c WHERE c.id = conversation_tagging.conversation_id));

CREATE POLICY conversation_read_select ON public.conversation_read
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ── 8 · RPC ──────────────────────────────────────────────────────────────
-- set_conversation_tags: deja en la conversación exactamente las etiquetas
-- activas de `p_tag_ids`. Las asignaciones de una etiqueta desactivada se
-- conservan (la pantalla no las ve ni las manda) y vuelven al reactivarla.
-- Quien no edita la conversación, una privada ajena, una borrada, una etiqueta
-- de otro espacio o una desactivada que no estaba puesta: 42501. Devuelve las
-- etiquetas que lleva la conversación al acabar, desactivadas incluidas.
CREATE FUNCTION public.set_conversation_tags(p_conversation_id uuid, p_tag_ids uuid[])
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_ws     uuid;
  v_tags   uuid[];
  v_result uuid[];
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_tag_ids IS NULL OR array_position(p_tag_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'tag ids must be a list without nulls' USING ERRCODE = '22023';
  END IF;

  -- La misma frontera que conversation_update (USING), leída de producción.
  SELECT c.workspace_id INTO v_ws
  FROM public.conversation c
  WHERE c.id = p_conversation_id
    AND c.deleted_at IS NULL
    AND (c.private_to IS NULL OR c.private_to = v_caller)
    AND public.has_permission_for_user(c.project_id, 'edit:conversation', v_caller)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation % not found', p_conversation_id USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_tags FROM unnest(p_tag_ids) AS x;

  -- Cada etiqueta pedida es estándar o de este espacio.
  IF EXISTS (
    SELECT 1 FROM unnest(v_tags) AS x
    WHERE NOT EXISTS (
      SELECT 1 FROM public.conversation_tag t
      WHERE t.id = x AND (t.workspace_id IS NULL OR t.workspace_id = v_ws)
    )
  ) THEN
    RAISE EXCEPTION 'conversation tag not found' USING ERRCODE = '42501';
  END IF;

  -- Se quitan las activas que ya no se piden; las desactivadas se quedan.
  DELETE FROM public.conversation_tagging g
  WHERE g.conversation_id = p_conversation_id
    AND g.tag_id <> ALL (v_tags)
    AND NOT EXISTS (
      SELECT 1 FROM public.workspace_conversation_tag_setting s
      WHERE s.workspace_id = v_ws AND s.tag_id = g.tag_id AND NOT s.active
    );

  -- Las nuevas; una desactivada que no estaba la para el trigger (42501).
  INSERT INTO public.conversation_tagging (conversation_id, tag_id, workspace_id, created_by)
  SELECT p_conversation_id, x, v_ws, v_caller
  FROM unnest(v_tags) AS x
  ON CONFLICT (conversation_id, tag_id) DO NOTHING;

  SELECT coalesce(array_agg(g.tag_id ORDER BY g.tag_id), '{}') INTO v_result
  FROM public.conversation_tagging g
  WHERE g.conversation_id = p_conversation_id;

  RETURN v_result;
END;
$$;
COMMENT ON FUNCTION public.set_conversation_tags(uuid, uuid[]) IS
  'ADR-138 § 1: replace the active tags of a conversation. Only who edits the conversation (edit:conversation and its privacy); a tag of another workspace or an inactive one not already set is 42501. Inactive assignments are kept. SECURITY DEFINER.';
REVOKE ALL ON FUNCTION public.set_conversation_tags(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_conversation_tags(uuid, uuid[]) TO authenticated;

-- mark_conversation_read: leída hasta ahora, para quien la lee. Solo sube.
CREATE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_at     timestamptz;
BEGIN
  IF v_caller IS NULL OR NOT private.can_read_conversation(p_conversation_id, v_caller) THEN
    RAISE EXCEPTION 'conversation % not found', p_conversation_id USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.conversation_read (conversation_id, user_id, last_read_at)
  VALUES (p_conversation_id, v_caller, now())
  ON CONFLICT (conversation_id, user_id)
  DO UPDATE SET last_read_at = greatest(public.conversation_read.last_read_at, excluded.last_read_at)
  RETURNING last_read_at INTO v_at;

  RETURN v_at;
END;
$$;
COMMENT ON FUNCTION public.mark_conversation_read(uuid) IS
  'ADR-138: the caller has read this conversation up to now. Only who reads it; own row; never goes back. SECURITY DEFINER.';
REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;

-- ── 9 · comprobaciones: la etiqueta no da permisos, nadie ve distinto ────
DO $$
DECLARE
  v_policies text;
  v_functions text;
  v_changed bigint;
  v_tagged bigint;
  v_total bigint;
BEGIN
  SELECT string_agg(format('%I.%I', p.tablename, p.policyname), ', ')
  INTO v_policies
  FROM pg_policies p
  WHERE p.tablename NOT IN ('conversation_tag', 'workspace_conversation_tag_setting',
                            'conversation_tagging', 'conversation_read')
    AND (coalesce(p.qual, '') ~ 'conversation_tag' OR coalesce(p.with_check, '') ~ 'conversation_tag');

  SELECT string_agg(p.proname, ', ')
  INTO v_functions
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private'
    AND p.prosrc ~ 'conversation_tag';

  IF v_policies IS NOT NULL OR v_functions IS NOT NULL THEN
    RAISE EXCEPTION 'conversation tags: a tag must never decide access (policies: %; private functions: %)',
      coalesce(v_policies, '-'), coalesce(v_functions, '-');
  END IF;

  SELECT count(*) INTO v_changed
  FROM conversation_tags_access_before b
  JOIN public.membership m ON m.id = b.membership_id
  WHERE b.readable <> (
    SELECT count(*)
    FROM public.conversation c
    WHERE c.workspace_id = m.workspace_id
      AND private.can_read_conversation(c.id, m.user_id)
  );
  IF v_changed > 0 THEN
    RAISE EXCEPTION 'conversation tags: % muk-cia membership(s) read a different number of conversations', v_changed;
  END IF;

  SELECT count(*) INTO v_total FROM public.conversation;
  SELECT count(*) INTO v_tagged FROM public.conversation_tagging;
  IF v_tagged <> v_total THEN
    RAISE EXCEPTION 'conversation tags: backfill tagged % of % conversations', v_tagged, v_total;
  END IF;

  RAISE NOTICE 'conversation tags: % conversations tagged sales; % muk-cia membership(s) unchanged',
    v_tagged, (SELECT count(*) FROM conversation_tags_access_before);
END;
$$;

DROP TABLE conversation_tags_access_before;
