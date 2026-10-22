-- Fusión de dos dossiers del mismo espacio, fase 1: esquema y RPC.
--
-- Plan: `build/plans/2026-10-22-person-merge.md` (Marco aprobó las seis
-- recomendadas el 2026-10-22): se fusiona el dossier dentro de un espacio,
-- confirma solo el admin del espacio, lo que el admin no ve se mueve y no se
-- cuenta, el admin elige el email y la pantalla avisa del otro, «Deshacer»
-- dura 30 días, y el aviso de invitación sin unir no va a Desk.
--
--   1. `workspace_person.previous_slugs`: el slug del dossier que desaparece
--      sigue abriendo la ficha del que se queda (como la conversación,
--      ADR-102 § 7). El Worker aún no lo lee.
--   2. `person_merge`: una fila por fusión, con los dos dossiers de antes. La
--      lee el admin del espacio.
--   3. `person_merge_row`: qué se movió, para deshacer. SIN GRANT A NADIE: una
--      fusión mueve notas privadas ajenas, «lo conozco» sin compartir y
--      contactos de conversaciones privadas ajenas; la lista delataría quién
--      conoce a quién. `row_before` solo lleva la fila entera en las tablas
--      sin borrado blando (`commitment_person`, `conversation_contact`,
--      `person_acquaintance`) y las columnas que la fusión reescribe en la
--      fila que se queda (`merged`); nunca el cuerpo de una nota.
--   4. `guard_immutable_note_anchor`: misma firma y cuerpo que la base viva
--      (`pg_get_functiondef`, 2026-10-22), más una sola excepción: cambiar
--      `person_id` entre los dos de una fusión en curso, con
--      `hour.person_merge` puesto y fuera de los roles de PostgREST (o sea,
--      dentro de una RPC SECURITY DEFINER). Nadie lo activa desde fuera:
--      PostgREST no expone `set_config`.
--   5. `preview_person_merge`, `merge_workspace_person`, `undo_person_merge`.
--
-- Cambio sobre el plan, § 3: `person_merge_row.action` suma `merged` (la fila
-- de `keep` que absorbe a la de `drop` en un choque cambia fechas, notas o
-- «compartido»; deshacer necesita su antes). Y `preview_person_merge` es
-- SECURITY INVOKER, no DEFINER: así los recuentos son exactamente lo que la
-- RLS deja leer a quien llama (ADR-099 § 4), sin reimplementar la
-- visibilidad. Sus puertas van por `private.person_merge_pair`, DEFINER, la
-- misma que usa la fusión.
--
-- Funciones existentes que se llaman (firmas de producción, `pg_get_functiondef`,
-- 2026-10-22): `public.is_workspace_admin(uuid)`,
-- `private.workspace_person_readable_by_caller(uuid, uuid)`,
-- `public.uuid_generate_v7()`. Se redefine solo
-- `public.guard_immutable_note_anchor()`, con su firma viva.
--
-- ADITIVA según § 34: dos tablas, una columna con DEFAULT, cuatro funciones
-- nuevas y el guard redefinido. No mueve datos. El Worker desplegado no lee
-- nada de esto.
-- Rollback: build/runbooks/rollback-20261022130000-person-merge.sql.

-- ── 1 · previous_slugs ───────────────────────────────────────────────────
ALTER TABLE public.workspace_person
  ADD COLUMN previous_slugs text[] NOT NULL DEFAULT '{}'::text[];
COMMENT ON COLUMN public.workspace_person.previous_slugs IS
  'Slugs de dossiers fusionados en este (merge_workspace_person): siguen abriendo esta ficha. Un slug vivo de otro dossier gana siempre.';

-- ── 2 · person_merge ─────────────────────────────────────────────────────
CREATE TABLE public.person_merge (
  id                  uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id        uuid NOT NULL REFERENCES public.workspace (id) ON DELETE CASCADE,
  keep_person_id      uuid NOT NULL REFERENCES public.person (id) ON DELETE CASCADE,
  drop_person_id      uuid NOT NULL REFERENCES public.person (id) ON DELETE CASCADE,
  reason              text NOT NULL CHECK (reason IN ('invitation', 'manual')),
  invitation_id       uuid REFERENCES public.workspace_invitation (id) ON DELETE SET NULL,
  keep_dossier_before jsonb CHECK (keep_dossier_before IS NULL OR jsonb_typeof(keep_dossier_before) = 'object'),
  drop_dossier_before jsonb NOT NULL CHECK (jsonb_typeof(drop_dossier_before) = 'object'),
  linked_user_id      uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  merged_by           uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  merged_at           timestamptz NOT NULL DEFAULT now(),
  undone_at           timestamptz,
  undone_by           uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  CONSTRAINT person_merge_two_people CHECK (keep_person_id <> drop_person_id)
);
COMMENT ON TABLE public.person_merge IS
  'Una fusión de dos dossiers del mismo espacio (merge_workspace_person): quién, cuándo, por qué y los dos dossiers de antes. keep_dossier_before NULL = la fusión creó el dossier de keep. linked_user_id = cuenta enlazada por la fusión. La lee el admin del espacio; se escribe solo por RPC.';
CREATE INDEX person_merge_workspace_idx ON public.person_merge (workspace_id, merged_at DESC);
CREATE INDEX person_merge_keep_idx ON public.person_merge (keep_person_id);
CREATE INDEX person_merge_drop_idx ON public.person_merge (drop_person_id);
CREATE INDEX person_merge_invitation_idx ON public.person_merge (invitation_id);
CREATE INDEX person_merge_linked_user_idx ON public.person_merge (linked_user_id);
CREATE INDEX person_merge_merged_by_idx ON public.person_merge (merged_by);
CREATE INDEX person_merge_undone_by_idx ON public.person_merge (undone_by);

-- ── 3 · person_merge_row ─────────────────────────────────────────────────
CREATE TABLE public.person_merge_row (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  merge_id    uuid NOT NULL REFERENCES public.person_merge (id) ON DELETE CASCADE,
  table_name  text NOT NULL CHECK (table_name IN (
                'cast_member', 'cast_override', 'crew_assignment', 'availability_block',
                'commitment_person', 'conversation_contact', 'person_acquaintance', 'note',
                'workspace_invitation', 'mailout_recipient')),
  row_id      uuid,
  column_name text NOT NULL DEFAULT 'person_id' CHECK (column_name IN ('person_id', 'replaces_person_id')),
  action      text NOT NULL CHECK (action IN ('repointed', 'retired', 'removed', 'merged')),
  row_before  jsonb,
  -- `person_acquaintance` no tiene id: se nombra por su clave en row_before.
  CONSTRAINT person_merge_row_names_its_row CHECK (
    row_id IS NOT NULL OR (table_name = 'person_acquaintance' AND row_before ? 'user_id')
  ),
  CONSTRAINT person_merge_row_before_when_needed CHECK (
    action NOT IN ('removed', 'merged') OR row_before IS NOT NULL
  )
);
COMMENT ON TABLE public.person_merge_row IS
  'Qué movió una fusión, en orden (id), para que undo_person_merge lo devuelva. Sin grant a nadie: delataría notas privadas, «lo conozco» sin compartir y contactos de conversaciones privadas ajenas. Solo la leen las RPC de fusión.';
CREATE INDEX person_merge_row_merge_idx ON public.person_merge_row (merge_id, id);

-- ── 4 · permisos de las tablas ───────────────────────────────────────────
ALTER TABLE public.person_merge     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_merge_row ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.person_merge, public.person_merge_row
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.person_merge TO authenticated;

CREATE POLICY person_merge_select ON public.person_merge
  FOR SELECT TO authenticated
  USING (public.is_workspace_admin(workspace_id));
-- person_merge_row: RLS sin políticas y sin grant.

-- ── 5 · guard de la nota ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_immutable_note_anchor()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_merge text;
BEGIN
  IF NEW.project_id     IS DISTINCT FROM OLD.project_id
  OR NEW.line_id        IS DISTINCT FROM OLD.line_id
  OR NEW.performance_id IS DISTINCT FROM OLD.performance_id
  OR NEW.date_id        IS DISTINCT FROM OLD.date_id THEN
    RAISE EXCEPTION 'note anchor is immutable — delete and rewrite'
      USING ERRCODE = '42501';
  END IF;
  -- La persona solo cambia dentro de una fusión (merge_workspace_person,
  -- undo_person_merge): entre sus dos personas, en su espacio, y nunca con
  -- un rol de PostgREST, que no puede poner `hour.person_merge`.
  IF NEW.person_id IS DISTINCT FROM OLD.person_id THEN
    v_merge := nullif(current_setting('hour.person_merge', true), '');
    IF v_merge IS NULL
       OR current_user IN ('authenticated', 'anon', 'service_role')
       OR NOT EXISTS (
         SELECT 1 FROM public.person_merge m
         WHERE m.id = v_merge::uuid
           AND m.workspace_id = NEW.workspace_id
           AND ARRAY[OLD.person_id, NEW.person_id] <@ ARRAY[m.keep_person_id, m.drop_person_id]
       ) THEN
      RAISE EXCEPTION 'note anchor is immutable — delete and rewrite'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 6 · puertas comunes ──────────────────────────────────────────────────
-- Resuelve qué persona se queda y comprueba que quien llama puede fusionar.
--   · 42501, igual para «no existe» y «no puedes»: no es admin del espacio;
--     el dossier que desaparece no está vivo o no lo puede leer; el que se
--     queda existe y no lo puede leer, o no existe y no es la persona de una
--     cuenta con membresía en el espacio.
--   · 22023: los dos son la misma persona, o los dos son cuentas.
-- La persona de una cuenta siempre se queda: si `drop` es cuenta y `keep` no,
-- se intercambian (swapped). Su person_id es global; moverlo tocaría otros
-- espacios.
CREATE FUNCTION private.person_merge_pair(
  p_workspace_id   uuid,
  p_keep_person_id uuid,
  p_drop_person_id uuid
)
RETURNS TABLE (
  keep_person_id   uuid,
  drop_person_id   uuid,
  swapped          boolean,
  keep_has_dossier boolean,
  keep_is_account  boolean,
  drop_is_account  boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_keep      uuid := p_keep_person_id;
  v_drop      uuid := p_drop_person_id;
  v_keep_user uuid;
  v_drop_user uuid;
  v_tmp       uuid;
  v_swapped   boolean := false;
  v_keep_live boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL OR v_keep IS NULL OR v_drop IS NULL
     OR NOT public.is_workspace_admin(p_workspace_id) THEN
    RAISE EXCEPTION 'person not found' USING ERRCODE = '42501';
  END IF;
  IF v_keep = v_drop THEN
    RAISE EXCEPTION 'a person cannot be merged with itself' USING ERRCODE = '22023';
  END IF;

  SELECT up.user_id INTO v_keep_user FROM public.user_profile up WHERE up.person_id = v_keep;
  SELECT up.user_id INTO v_drop_user FROM public.user_profile up WHERE up.person_id = v_drop;
  IF v_keep_user IS NOT NULL AND v_drop_user IS NOT NULL THEN
    RAISE EXCEPTION 'both people are accounts' USING ERRCODE = '22023';
  END IF;
  IF v_drop_user IS NOT NULL THEN
    v_tmp := v_keep; v_keep := v_drop; v_drop := v_tmp;
    v_keep_user := v_drop_user; v_drop_user := NULL;
    v_swapped := true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_person wp
    WHERE wp.workspace_id = p_workspace_id AND wp.person_id = v_drop AND wp.deleted_at IS NULL
  ) OR NOT private.workspace_person_readable_by_caller(p_workspace_id, v_drop) THEN
    RAISE EXCEPTION 'person not found' USING ERRCODE = '42501';
  END IF;

  v_keep_live := EXISTS (
    SELECT 1 FROM public.workspace_person wp
    WHERE wp.workspace_id = p_workspace_id AND wp.person_id = v_keep AND wp.deleted_at IS NULL
  );
  IF v_keep_live THEN
    IF NOT private.workspace_person_readable_by_caller(p_workspace_id, v_keep) THEN
      RAISE EXCEPTION 'person not found' USING ERRCODE = '42501';
    END IF;
  ELSIF v_keep_user IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.membership m
    WHERE m.workspace_id = p_workspace_id AND m.user_id = v_keep_user AND m.accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'person not found' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT v_keep, v_drop, v_swapped, v_keep_live, v_keep_user IS NOT NULL, false;
END;
$$;
COMMENT ON FUNCTION private.person_merge_pair(uuid, uuid, uuid) IS
  'Puertas de la fusión de dossiers: admin del espacio, los dos legibles (o keep = la persona de una cuenta del espacio sin dossier), no los dos cuentas. Devuelve keep y drop ya intercambiados si drop era la cuenta. SECURITY DEFINER.';
REVOKE ALL ON FUNCTION private.person_merge_pair(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.person_merge_pair(uuid, uuid, uuid) TO authenticated;

-- Devuelve un dossier a como estaba (deshacer). Interna: sin grant.
CREATE FUNCTION private.person_merge_restore_dossier(p_before jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  UPDATE public.workspace_person t SET
    slug                  = x.slug,
    full_name             = x.full_name,
    first_name            = x.first_name,
    last_name             = x.last_name,
    email                 = x.email,
    phone                 = x.phone,
    website               = x.website,
    city                  = x.city,
    country               = x.country,
    languages             = x.languages,
    organization_id       = x.organization_id,
    title                 = x.title,
    notes                 = x.notes,
    custom_fields         = x.custom_fields,
    profile_sync_enabled  = x.profile_sync_enabled,
    profile_shared_fields = x.profile_shared_fields,
    profile_shared_at     = x.profile_shared_at,
    previous_slugs        = x.previous_slugs,
    deleted_at            = x.deleted_at
  FROM jsonb_populate_record(NULL::public.workspace_person, p_before) x
  WHERE t.workspace_id = x.workspace_id AND t.person_id = x.person_id;
$$;
REVOKE ALL ON FUNCTION private.person_merge_restore_dossier(jsonb) FROM PUBLIC, anon, authenticated;

-- ── 7 · preview_person_merge ─────────────────────────────────────────────
-- Solo lectura, SECURITY INVOKER: los dossiers y los recuentos salen con la
-- RLS de quien llama, así que lo que no ve (notas ajenas, conversaciones
-- privadas ajenas, «lo conozco») no se cuenta. Rechaza lo mismo que la fusión.
CREATE FUNCTION public.preview_person_merge(
  p_workspace_id   uuid,
  p_keep_person_id uuid,
  p_drop_person_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  p      record;
  v_ws   uuid := p_workspace_id;
  v_keep jsonb;
  v_drop jsonb;
BEGIN
  SELECT * INTO p FROM private.person_merge_pair(p_workspace_id, p_keep_person_id, p_drop_person_id);

  SELECT jsonb_build_object('full_name', wp.full_name, 'email', wp.email, 'phone', wp.phone,
                            'title', wp.title, 'slug', wp.slug, 'created_at', wp.created_at,
                            'is_account', p.keep_is_account)
  INTO v_keep
  FROM public.workspace_person wp
  WHERE wp.workspace_id = v_ws AND wp.person_id = p.keep_person_id AND wp.deleted_at IS NULL;

  SELECT jsonb_build_object('full_name', wp.full_name, 'email', wp.email, 'phone', wp.phone,
                            'title', wp.title, 'slug', wp.slug, 'created_at', wp.created_at,
                            'is_account', p.drop_is_account)
  INTO v_drop
  FROM public.workspace_person wp
  WHERE wp.workspace_id = v_ws AND wp.person_id = p.drop_person_id AND wp.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'keep_person_id', p.keep_person_id,
    'drop_person_id', p.drop_person_id,
    'swapped', p.swapped,
    'keep_is_account', p.keep_is_account,
    'keep', v_keep,
    'drop', v_drop,
    'counts', jsonb_build_object(
      'cast', (SELECT count(*) FROM public.cast_member x
               WHERE x.workspace_id = v_ws AND x.person_id = p.drop_person_id AND x.deleted_at IS NULL),
      'overrides', (SELECT count(*) FROM public.cast_override x
                    WHERE x.workspace_id = v_ws AND x.deleted_at IS NULL
                      AND (x.person_id = p.drop_person_id OR x.replaces_person_id = p.drop_person_id)),
      'crew', (SELECT count(*) FROM public.crew_assignment x
               WHERE x.workspace_id = v_ws AND x.person_id = p.drop_person_id AND x.deleted_at IS NULL),
      'availability', (SELECT count(*) FROM public.availability_block x
                       WHERE x.workspace_id = v_ws AND x.person_id = p.drop_person_id AND x.deleted_at IS NULL),
      'commitments', (SELECT count(*) FROM public.commitment_person x
                      WHERE x.workspace_id = v_ws AND x.person_id = p.drop_person_id),
      'conversations', (SELECT count(*) FROM public.conversation_contact x
                        WHERE x.workspace_id = v_ws AND x.person_id = p.drop_person_id),
      'mailouts', (SELECT count(*) FROM public.mailout_recipient x
                   WHERE x.workspace_id = v_ws AND x.person_id = p.drop_person_id),
      'my_notes', (SELECT count(*) FROM public.note x
                   WHERE x.workspace_id = v_ws AND x.person_id = p.drop_person_id
                     AND x.deleted_at IS NULL AND x.author_id = auth.uid())
    ),
    -- Filas de las dos en lo mismo: se queda una (merge_workspace_person, paso 4).
    'conflicts', jsonb_build_object(
      'cast', (SELECT count(*) FROM public.cast_member d JOIN public.cast_member k
                 ON k.project_id = d.project_id AND k.role = d.role
                AND k.person_id = p.keep_person_id AND k.deleted_at IS NULL
               WHERE d.workspace_id = v_ws AND d.person_id = p.drop_person_id AND d.deleted_at IS NULL),
      'overrides', (SELECT count(*) FROM public.cast_override d JOIN public.cast_override k
                      ON k.performance_id = d.performance_id
                     AND k.person_id = p.keep_person_id AND k.deleted_at IS NULL
                    WHERE d.workspace_id = v_ws AND d.person_id = p.drop_person_id AND d.deleted_at IS NULL),
      'crew', (SELECT count(*) FROM public.crew_assignment d JOIN public.crew_assignment k
                 ON k.performance_id = d.performance_id AND k.role = d.role
                AND k.person_id = p.keep_person_id AND k.deleted_at IS NULL
               WHERE d.workspace_id = v_ws AND d.person_id = p.drop_person_id AND d.deleted_at IS NULL),
      'commitments', (SELECT count(*) FROM public.commitment_person d JOIN public.commitment_person k
                        ON k.person_id = p.keep_person_id
                       AND (k.performance_id = d.performance_id OR k.date_id = d.date_id)
                      WHERE d.workspace_id = v_ws AND d.person_id = p.drop_person_id),
      'conversations', (SELECT count(*) FROM public.conversation_contact d JOIN public.conversation_contact k
                          ON k.conversation_id = d.conversation_id AND k.person_id = p.keep_person_id
                        WHERE d.workspace_id = v_ws AND d.person_id = p.drop_person_id)
    )
  );
END;
$$;
COMMENT ON FUNCTION public.preview_person_merge(uuid, uuid, uuid) IS
  'Vista previa de merge_workspace_person: los dos dossiers y los recuentos de lo que quien llama puede leer (RLS: SECURITY INVOKER). Rechaza lo mismo que la fusión.';
REVOKE ALL ON FUNCTION public.preview_person_merge(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_person_merge(uuid, uuid, uuid) TO authenticated;

-- ── 8 · merge_workspace_person ───────────────────────────────────────────
-- p_fields elige a mano nombre, email y teléfono cuando los dos tienen valor:
-- {"full_name"|"email"|"phone": "<person_id de keep o de drop>"}. Por id, no
-- por «keep»/«drop», porque las dos se pueden intercambiar. Sin elegir, gana
-- el valor de keep y, si está vacío, el de drop.
CREATE FUNCTION public.merge_workspace_person(
  p_workspace_id   uuid,
  p_keep_person_id uuid,
  p_drop_person_id uuid,
  p_fields         jsonb DEFAULT '{}'::jsonb,
  p_invitation_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_ws       uuid := p_workspace_id;
  p          record;
  v_keep     uuid;
  v_drop     uuid;
  v_k        public.workspace_person;
  v_d        public.workspace_person;
  v_merge    uuid;
  v_inv      public.workspace_invitation;
  v_name_d   boolean;
  v_email_d  boolean;
  v_phone_d  boolean;
  v_user     uuid;
  r          record;
  k          record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- Los dos dossiers, bloqueados en orden fijo, antes de mirar nada.
  PERFORM 1 FROM public.workspace_person wp
  WHERE wp.workspace_id = v_ws AND wp.person_id IN (p_keep_person_id, p_drop_person_id)
  ORDER BY wp.person_id
  FOR UPDATE;

  SELECT * INTO p FROM private.person_merge_pair(v_ws, p_keep_person_id, p_drop_person_id);
  v_keep := p.keep_person_id;
  v_drop := p.drop_person_id;

  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' OR EXISTS (
    SELECT 1 FROM jsonb_each(p_fields) e
    WHERE e.key NOT IN ('full_name', 'email', 'phone')
       OR jsonb_typeof(e.value) <> 'string'
       OR e.value #>> '{}' NOT IN (v_keep::text, v_drop::text)
  ) THEN
    RAISE EXCEPTION 'fields must choose full_name, email or phone by person id' USING ERRCODE = '22023';
  END IF;
  v_name_d  := p_fields ->> 'full_name' = v_drop::text;
  v_email_d := p_fields ->> 'email' = v_drop::text;
  v_phone_d := p_fields ->> 'phone' = v_drop::text;

  IF p_invitation_id IS NOT NULL THEN
    SELECT * INTO v_inv FROM public.workspace_invitation i
    WHERE i.id = p_invitation_id AND i.workspace_id = v_ws
      AND i.accepted_at IS NOT NULL AND i.person_id IN (v_keep, v_drop);
    IF v_inv.id IS NULL THEN
      RAISE EXCEPTION 'invitation does not match this merge' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO v_d FROM public.workspace_person wp
  WHERE wp.workspace_id = v_ws AND wp.person_id = v_drop;
  SELECT * INTO v_k FROM public.workspace_person wp
  WHERE wp.workspace_id = v_ws AND wp.person_id = v_keep;

  INSERT INTO public.person_merge (
    workspace_id, keep_person_id, drop_person_id, reason, invitation_id,
    keep_dossier_before, drop_dossier_before, merged_by
  ) VALUES (
    v_ws, v_keep, v_drop,
    CASE WHEN p_invitation_id IS NULL THEN 'manual' ELSE 'invitation' END,
    p_invitation_id,
    CASE WHEN v_k.person_id IS NULL THEN NULL ELSE to_jsonb(v_k) END,
    to_jsonb(v_d),
    auth.uid()
  )
  RETURNING id INTO v_merge;
  PERFORM set_config('hour.person_merge', v_merge::text, true);

  -- 1 · El dossier que desaparece, primero: libera su slug.
  UPDATE public.workspace_person SET
    deleted_at    = now(),
    custom_fields = custom_fields || jsonb_build_object('merged_into', v_keep)
  WHERE workspace_id = v_ws AND person_id = v_drop;

  -- 2 · El dossier que se queda.
  IF v_k.person_id IS NULL THEN
    -- No existía en el espacio (la cuenta es una persona de otro espacio):
    -- nace con los datos y el slug de drop.
    INSERT INTO public.workspace_person (
      workspace_id, person_id, slug, full_name, first_name, last_name, email, phone,
      website, city, country, languages, organization_id, title, notes, custom_fields,
      previous_slugs, created_by
    ) VALUES (
      v_ws, v_keep, v_d.slug, v_d.full_name, v_d.first_name, v_d.last_name, v_d.email, v_d.phone,
      v_d.website, v_d.city, v_d.country, v_d.languages, v_d.organization_id, v_d.title,
      v_d.notes, v_d.custom_fields - 'merged_into', v_d.previous_slugs, auth.uid()
    );
  ELSE
    -- Existía (vivo o borrado): cada campo vacío toma el de drop; las notas
    -- se suman; nombre, email y teléfono los elige p_fields. Un dossier de
    -- keep que estaba borrado revive con el slug de drop.
    UPDATE public.workspace_person t SET
      full_name       = CASE WHEN v_name_d THEN v_d.full_name ELSE v_k.full_name END,
      first_name      = CASE WHEN v_name_d THEN v_d.first_name ELSE coalesce(v_k.first_name, v_d.first_name) END,
      last_name       = CASE WHEN v_name_d THEN v_d.last_name ELSE coalesce(v_k.last_name, v_d.last_name) END,
      email           = CASE WHEN v_email_d THEN coalesce(v_d.email, v_k.email) ELSE coalesce(v_k.email, v_d.email) END,
      phone           = CASE WHEN v_phone_d THEN coalesce(v_d.phone, v_k.phone) ELSE coalesce(v_k.phone, v_d.phone) END,
      website         = coalesce(v_k.website, v_d.website),
      city            = coalesce(v_k.city, v_d.city),
      country         = coalesce(v_k.country, v_d.country),
      languages       = CASE WHEN cardinality(v_k.languages) = 0 THEN v_d.languages ELSE v_k.languages END,
      organization_id = coalesce(v_k.organization_id, v_d.organization_id),
      title           = coalesce(v_k.title, v_d.title),
      notes           = CASE
                          WHEN nullif(btrim(v_d.notes), '') IS NULL OR v_d.notes = v_k.notes THEN v_k.notes
                          WHEN nullif(btrim(v_k.notes), '') IS NULL THEN v_d.notes
                          ELSE v_k.notes || E'\n\n' || v_d.notes
                        END,
      custom_fields   = (v_d.custom_fields - 'merged_into') || v_k.custom_fields,
      slug            = CASE WHEN v_k.deleted_at IS NULL THEN v_k.slug ELSE v_d.slug END,
      previous_slugs  = ARRAY(
                          SELECT DISTINCT s FROM unnest(
                            v_k.previous_slugs || v_d.previous_slugs
                            || CASE WHEN v_k.deleted_at IS NULL THEN ARRAY[v_d.slug] ELSE ARRAY[v_k.slug] END
                          ) s
                          WHERE s IS NOT NULL
                            AND s <> CASE WHEN v_k.deleted_at IS NULL THEN v_k.slug ELSE v_d.slug END
                          ORDER BY s
                        ),
      deleted_at      = NULL
    WHERE t.workspace_id = v_ws AND t.person_id = v_keep;
  END IF;

  -- 3 · Reapuntar, solo en este espacio. Lo borrado en blando se queda con
  -- drop: es historia de un dossier que también queda borrado.

  -- Reparto: mismo proyecto y papel vivos = una fila.
  FOR r IN
    SELECT * FROM public.cast_member x
    WHERE x.workspace_id = v_ws AND x.person_id = v_drop AND x.deleted_at IS NULL
    ORDER BY x.id FOR UPDATE
  LOOP
    SELECT * INTO k FROM public.cast_member x
    WHERE x.workspace_id = v_ws AND x.project_id = r.project_id AND x.role = r.role
      AND x.person_id = v_keep AND x.deleted_at IS NULL
    FOR UPDATE;
    IF FOUND THEN
      INSERT INTO public.person_merge_row (merge_id, table_name, row_id, action, row_before)
      VALUES (v_merge, 'cast_member', k.id, 'merged',
              jsonb_build_object('joined_at', k.joined_at, 'left_at', k.left_at));
      UPDATE public.cast_member SET
        joined_at = least(k.joined_at, r.joined_at),
        left_at   = CASE WHEN k.left_at IS NULL OR r.left_at IS NULL THEN NULL
                         ELSE greatest(k.left_at, r.left_at) END
      WHERE id = k.id;
      UPDATE public.cast_member SET deleted_at = now() WHERE id = r.id;
      INSERT INTO public.person_merge_row (merge_id, table_name, row_id, action)
      VALUES (v_merge, 'cast_member', r.id, 'retired');
    ELSE
      UPDATE public.cast_member SET person_id = v_keep WHERE id = r.id;
      INSERT INTO public.person_merge_row (merge_id, table_name, row_id, action)
      VALUES (v_merge, 'cast_member', r.id, 'repointed');
    END IF;
  END LOOP;

  -- Cambios de reparto: misma función = se queda la de keep.
  FOR r IN
    SELECT * FROM public.cast_override x
    WHERE x.workspace_id = v_ws AND x.person_id = v_drop AND x.deleted_at IS NULL
    ORDER BY x.id FOR UPDATE
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.cast_override x
      WHERE x.workspace_id = v_ws AND x.performance_id = r.performance_id
        AND x.person_id = v_keep AND x.deleted_at IS NULL
    ) THEN
      UPDATE public.cast_override SET deleted_at = now() WHERE id = r.id;
      INSERT INTO public.person_merge_row (merge_id, table_name, row_id, action)
      VALUES (v_merge, 'cast_override', r.id, 'retired');
    ELSE
      UPDATE public.cast_override SET person_id = v_keep WHERE id = r.id;
      INSERT INTO public.person_merge_row (merge_id, table_name, row_id, action)
      VALUES (v_merge, 'cast_override', r.id, 'repointed');
    END IF;
  END LOOP;
  WITH moved AS (
    UPDATE public.cast_override SET replaces_person_id = v_keep
    WHERE workspace_id = v_ws AND replaces_person_id = v_drop AND deleted_at IS NULL
    RETURNING id
  )
  INSERT INTO public.person_merge_row (merge_id, table_name, row_id, column_name, action)
  SELECT v_merge, 'cast_override', id, 'replaces_person_id', 'repointed' FROM moved ORDER BY id;
  -- Una que acaba sustituyéndose a sí misma no significa nada.
  WITH gone AS (
    UPDATE public.cast_override SET deleted_at = now()
    WHERE workspace_id = v_ws AND person_id = v_keep AND replaces_person_id = v_keep
      AND deleted_at IS NULL
    RETURNING id
  )
  INSERT INTO public.person_merge_row (merge_id, table_name, row_id, action)
  SELECT v_merge, 'cast_override', id, 'retired' FROM gone ORDER BY id;

  -- Equipo técnico: misma función y papel = la de keep, con las notas sumadas.
  FOR r IN
    SELECT * FROM public.crew_assignment x
    WHERE x.workspace_id = v_ws AND x.person_id = v_drop AND x.deleted_at IS NULL
    ORDER BY x.id FOR UPDATE
  LOOP
    SELECT * INTO k FROM public.crew_assignment x
    WHERE x.workspace_id = v_ws AND x.performance_id = r.performance_id AND x.role = r.role
      AND x.person_id = v_keep AND x.deleted_at IS NULL
    FOR UPDATE;
    IF FOUND THEN
      IF nullif(btrim(r.notes), '') IS NOT NULL AND r.notes IS DISTINCT FROM k.notes THEN
        INSERT INTO public.person_merge_row (merge_id, table_name, row_id, action, row_before)
        VALUES (v_merge, 'crew_assignment', k.id, 'merged', jsonb_build_object('notes', k.notes));
        UPDATE public.crew_assignment SET
          notes = CASE WHEN nullif(btrim(k.notes), '') IS NULL THEN r.notes
                       ELSE k.notes || E'\n\n' || r.notes END
        WHERE id = k.id;
      END IF;
      UPDATE public.crew_assignment SET deleted_at = now() WHERE id = r.id;
      INSERT INTO public.person_merge_row (merge_id, table_name, row_id, action)
      VALUES (v_merge, 'crew_assignment', r.id, 'retired');
    ELSE
      UPDATE public.crew_assignment SET person_id = v_keep WHERE id = r.id;
      INSERT INTO public.person_merge_row (merge_id, table_name, row_id, action)
      VALUES (v_merge, 'crew_assignment', r.id, 'repointed');
    END IF;
  END LOOP;

  -- Disponibilidad: sin choque.
  WITH moved AS (
    UPDATE public.availability_block SET person_id = v_keep
    WHERE workspace_id = v_ws AND person_id = v_drop AND deleted_at IS NULL
    RETURNING id
  )
  INSERT INTO public.person_merge_row (merge_id, table_name, row_id, action)
  SELECT v_merge, 'availability_block', id, 'repointed' FROM moved ORDER BY id;

  -- «Voy»: misma función o fecha = gana la actualizada más tarde. Sin
  -- borrado blando: la que pierde se borra y se guarda entera.
  FOR r IN
    SELECT * FROM public.commitment_person x
    WHERE x.workspace_id = v_ws AND x.person_id = v_drop
    ORDER BY x.id FOR UPDATE
  LOOP
    SELECT * INTO k FROM public.commitment_person x
    WHERE x.workspace_id = v_ws AND x.person_id = v_keep
      AND ((r.performance_id IS NOT NULL AND x.performance_id = r.performance_id)
        OR (r.date_id IS NOT NULL AND x.date_id = r.date_id))
    FOR UPDATE;
    IF FOUND THEN
      IF r.updated_at > k.updated_at THEN
        INSERT INTO public.person_merge_row (merge_id, table_name, row_id, action, row_before)
        VALUES (v_merge, 'commitment_person', k.id, 'removed', to_jsonb(k));
        DELETE FROM public.commitment_person WHERE id = k.id;
        UPDATE public.commitment_person SET person_id = v_keep WHERE id = r.id;
        INSERT INTO public.person_merge_row (merge_id, table_name, row_id, action)
        VALUES (v_merge, 'commitment_person', r.id, 'repointed');
      ELSE
        INSERT INTO public.person_merge_row (merge_id, table_name, row_id, action, row_before)
        VALUES (v_merge, 'commitment_person', r.id, 'removed', to_jsonb(r));
        DELETE FROM public.commitment_person WHERE id = r.id;
      END IF;
    ELSE
      UPDATE public.commitment_person SET person_id = v_keep WHERE id = r.id;
      INSERT INTO public.person_merge_row (merge_id, table_name, row_id, action)
      VALUES (v_merge, 'commitment_person', r.id, 'repointed');
    END IF;
  END LOOP;

  -- Contactos de conversación: misma conversación = una fila. Se borra la de
  -- drop antes de tocar la de keep (un solo principal por conversación); al
  -- deshacer, el orden inverso devuelve primero la de keep.
  FOR r IN
    SELECT * FROM public.conversation_contact x
    WHERE x.workspace_id = v_ws AND x.person_id = v_drop
    ORDER BY x.id FOR UPDATE
  LOOP
    SELECT * INTO k FROM public.conversation_contact x
    WHERE x.conversation_id = r.conversation_id AND x.person_id = v_keep
    FOR UPDATE;
    IF FOUND THEN
      INSERT INTO public.person_merge_row (merge_id, table_name, row_id, action, row_before)
      VALUES (v_merge, 'conversation_contact', r.id, 'removed', to_jsonb(r));
      DELETE FROM public.conversation_contact WHERE id = r.id;
      INSERT INTO public.person_merge_row (merge_id, table_name, row_id, action, row_before)
      VALUES (v_merge, 'conversation_contact', k.id, 'merged',
              jsonb_build_object('role', k.role, 'since', k.since, 'until', k.until,
                                 'is_primary', k.is_primary));
      UPDATE public.conversation_contact SET
        since      = least(k.since, r.since),
        until      = CASE WHEN k.until IS NULL OR r.until IS NULL THEN NULL
                          ELSE greatest(k.until, r.until) END,
        is_primary = k.is_primary OR r.is_primary,
        role       = coalesce(k.role, r.role)
      WHERE id = k.id;
    ELSE
      UPDATE public.conversation_contact SET person_id = v_keep WHERE id = r.id;
      INSERT INTO public.person_merge_row (merge_id, table_name, row_id, action)
      VALUES (v_merge, 'conversation_contact', r.id, 'repointed');
    END IF;
  END LOOP;

  -- «Lo conozco»: mismo usuario = una fila, compartida solo si las dos lo
  -- estaban (gana lo más privado).
  FOR r IN
    SELECT * FROM public.person_acquaintance x
    WHERE x.workspace_id = v_ws AND x.person_id = v_drop
    ORDER BY x.user_id FOR UPDATE
  LOOP
    SELECT * INTO k FROM public.person_acquaintance x
    WHERE x.workspace_id = v_ws AND x.person_id = v_keep AND x.user_id = r.user_id
    FOR UPDATE;
    IF FOUND THEN
      INSERT INTO public.person_merge_row (merge_id, table_name, action, row_before)
      VALUES (v_merge, 'person_acquaintance', 'removed', to_jsonb(r));
      DELETE FROM public.person_acquaintance
      WHERE workspace_id = v_ws AND person_id = v_drop AND user_id = r.user_id;
      INSERT INTO public.person_merge_row (merge_id, table_name, action, row_before)
      VALUES (v_merge, 'person_acquaintance', 'merged',
              jsonb_build_object('user_id', k.user_id, 'shared', k.shared));
      UPDATE public.person_acquaintance SET shared = k.shared AND r.shared
      WHERE workspace_id = v_ws AND person_id = v_keep AND user_id = r.user_id;
    ELSE
      UPDATE public.person_acquaintance SET person_id = v_keep
      WHERE workspace_id = v_ws AND person_id = v_drop AND user_id = r.user_id;
      INSERT INTO public.person_merge_row (merge_id, table_name, action, row_before)
      VALUES (v_merge, 'person_acquaintance', 'repointed', jsonb_build_object('user_id', r.user_id));
    END IF;
  END LOOP;

  -- Notas: autor y cuerpo no cambian; el guard deja pasar solo esto.
  WITH moved AS (
    UPDATE public.note SET person_id = v_keep
    WHERE workspace_id = v_ws AND person_id = v_drop AND deleted_at IS NULL
    RETURNING id
  )
  INSERT INTO public.person_merge_row (merge_id, table_name, row_id, action)
  SELECT v_merge, 'note', id, 'repointed' FROM moved ORDER BY id;

  -- Invitaciones y envíos: el historial pasa a nombrar a keep.
  WITH moved AS (
    UPDATE public.workspace_invitation SET person_id = v_keep
    WHERE workspace_id = v_ws AND person_id = v_drop
    RETURNING id
  )
  INSERT INTO public.person_merge_row (merge_id, table_name, row_id, action)
  SELECT v_merge, 'workspace_invitation', id, 'repointed' FROM moved ORDER BY id;

  WITH moved AS (
    UPDATE public.mailout_recipient SET person_id = v_keep
    WHERE workspace_id = v_ws AND person_id = v_drop
    RETURNING id
  )
  INSERT INTO public.person_merge_row (merge_id, table_name, row_id, action)
  SELECT v_merge, 'mailout_recipient', id, 'repointed' FROM moved ORDER BY id;

  -- 4 · Enlace: la cuenta que aceptó la invitación y aún no es nadie pasa a
  -- ser keep (no debería pasar: accept_workspace_invitation ya la habría
  -- enlazado), si keep no es ya la persona de otra cuenta.
  IF v_inv.id IS NOT NULL AND v_inv.accepted_by IS NOT NULL
     AND NOT p.keep_is_account THEN
    UPDATE public.user_profile SET person_id = v_keep
    WHERE user_id = v_inv.accepted_by AND person_id IS NULL
    RETURNING user_id INTO v_user;
    IF v_user IS NOT NULL THEN
      UPDATE public.person_merge SET linked_user_id = v_user WHERE id = v_merge;
    END IF;
  END IF;

  PERFORM set_config('hour.person_merge', '', true);

  -- Sin recuentos: incluirían lo que quien llama no ve (preview_person_merge
  -- da los suyos).
  RETURN jsonb_build_object(
    'merge_id', v_merge,
    'keep_person_id', v_keep,
    'drop_person_id', v_drop,
    'swapped', p.swapped
  );
END;
$$;
COMMENT ON FUNCTION public.merge_workspace_person(uuid, uuid, uuid, jsonb, uuid) IS
  'Fusiona el dossier drop en keep dentro de un espacio (solo el admin): reapunta reparto, cambios, equipo, disponibilidad, «voy», contactos, «lo conozco», notas, invitaciones y envíos del espacio; un choque deja una fila; drop queda borrado con merged_into; la persona global drop no se toca. Registro en person_merge(_row) para undo_person_merge. SECURITY DEFINER.';
REVOKE ALL ON FUNCTION public.merge_workspace_person(uuid, uuid, uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_workspace_person(uuid, uuid, uuid, jsonb, uuid) TO authenticated;

-- ── 9 · undo_person_merge ────────────────────────────────────────────────
-- Admin del espacio, menos de 30 días, no deshecha, y sin una fusión
-- posterior viva que se llevara a keep (esa se deshace antes). Lo movido
-- vuelve a drop en orden inverso; lo creado sobre keep después se queda en
-- keep; una fila que ya no está como la dejó la fusión se salta y se cuenta.
CREATE FUNCTION public.undo_person_merge(p_merge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  m         public.person_merge;
  r         public.person_merge_row;
  v_skipped integer := 0;
  v_n       integer;
  v_soft    boolean;
  v_used    boolean;
  v_keep_kept boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO m FROM public.person_merge WHERE id = p_merge_id FOR UPDATE;
  IF m.id IS NULL OR NOT public.is_workspace_admin(m.workspace_id) THEN
    RAISE EXCEPTION 'merge not found' USING ERRCODE = '42501';
  END IF;
  IF m.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'merge already undone' USING ERRCODE = '22023';
  END IF;
  IF m.merged_at < now() - interval '30 days' THEN
    RAISE EXCEPTION 'merge is older than 30 days' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.person_merge l
    WHERE l.workspace_id = m.workspace_id AND l.drop_person_id = m.keep_person_id
      AND l.undone_at IS NULL AND l.merged_at >= m.merged_at AND l.id <> m.id
  ) THEN
    RAISE EXCEPTION 'undo the later merge first' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.workspace_person wp
  WHERE wp.workspace_id = m.workspace_id AND wp.person_id IN (m.keep_person_id, m.drop_person_id)
  ORDER BY wp.person_id
  FOR UPDATE;

  PERFORM set_config('hour.person_merge', m.id::text, true);

  FOR r IN
    SELECT * FROM public.person_merge_row x WHERE x.merge_id = m.id ORDER BY x.id DESC
  LOOP
    v_n := 0;
    v_soft := r.table_name IN ('cast_member', 'cast_override', 'crew_assignment',
                               'availability_block', 'note');
    BEGIN
      IF r.action = 'repointed' AND r.table_name = 'person_acquaintance' THEN
        UPDATE public.person_acquaintance SET person_id = m.drop_person_id
        WHERE workspace_id = m.workspace_id AND person_id = m.keep_person_id
          AND user_id = (r.row_before ->> 'user_id')::uuid;
        GET DIAGNOSTICS v_n = ROW_COUNT;
      ELSIF r.action = 'repointed' THEN
        EXECUTE format(
          'UPDATE public.%I SET %I = $1 WHERE id = $2 AND %I = $3%s',
          r.table_name, r.column_name, r.column_name,
          CASE WHEN v_soft THEN ' AND deleted_at IS NULL' ELSE '' END
        ) USING m.drop_person_id, r.row_id, m.keep_person_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
      ELSIF r.action = 'retired' THEN
        EXECUTE format(
          'UPDATE public.%I SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL',
          r.table_name
        ) USING r.row_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
      ELSIF r.action = 'removed' THEN
        EXECUTE format(
          'INSERT INTO public.%I SELECT (jsonb_populate_record(NULL::public.%I, $1)).* ON CONFLICT DO NOTHING',
          r.table_name, r.table_name
        ) USING r.row_before;
        GET DIAGNOSTICS v_n = ROW_COUNT;
      ELSIF r.action = 'merged' AND r.table_name = 'cast_member' THEN
        UPDATE public.cast_member SET
          joined_at = (r.row_before ->> 'joined_at')::date,
          left_at   = (r.row_before ->> 'left_at')::date
        WHERE id = r.row_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
      ELSIF r.action = 'merged' AND r.table_name = 'crew_assignment' THEN
        UPDATE public.crew_assignment SET notes = r.row_before ->> 'notes' WHERE id = r.row_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
      ELSIF r.action = 'merged' AND r.table_name = 'conversation_contact' THEN
        UPDATE public.conversation_contact SET
          role       = r.row_before ->> 'role',
          since      = (r.row_before ->> 'since')::date,
          until      = (r.row_before ->> 'until')::date,
          is_primary = (r.row_before ->> 'is_primary')::boolean
        WHERE id = r.row_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
      ELSIF r.action = 'merged' AND r.table_name = 'person_acquaintance' THEN
        UPDATE public.person_acquaintance SET shared = (r.row_before ->> 'shared')::boolean
        WHERE workspace_id = m.workspace_id AND person_id = m.keep_person_id
          AND user_id = (r.row_before ->> 'user_id')::uuid;
        GET DIAGNOSTICS v_n = ROW_COUNT;
      END IF;
    EXCEPTION WHEN unique_violation OR foreign_key_violation OR check_violation THEN
      v_n := 0;
    END;
    IF v_n = 0 THEN
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  -- El dossier de keep: como estaba. Si la fusión lo creó, se borra en
  -- blando salvo que ya cuelgue algo de él (lo creado después de fusionar);
  -- entonces se queda vivo con un slug nuevo y drop recupera el suyo.
  IF m.keep_dossier_before IS NOT NULL THEN
    PERFORM private.person_merge_restore_dossier(m.keep_dossier_before);
  ELSE
    v_used := EXISTS (SELECT 1 FROM public.cast_member x WHERE x.workspace_id = m.workspace_id AND x.person_id = m.keep_person_id AND x.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.cast_override x WHERE x.workspace_id = m.workspace_id AND (x.person_id = m.keep_person_id OR x.replaces_person_id = m.keep_person_id) AND x.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.crew_assignment x WHERE x.workspace_id = m.workspace_id AND x.person_id = m.keep_person_id AND x.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.availability_block x WHERE x.workspace_id = m.workspace_id AND x.person_id = m.keep_person_id AND x.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.commitment_person x WHERE x.workspace_id = m.workspace_id AND x.person_id = m.keep_person_id)
      OR EXISTS (SELECT 1 FROM public.conversation_contact x WHERE x.workspace_id = m.workspace_id AND x.person_id = m.keep_person_id)
      OR EXISTS (SELECT 1 FROM public.person_acquaintance x WHERE x.workspace_id = m.workspace_id AND x.person_id = m.keep_person_id)
      OR EXISTS (SELECT 1 FROM public.note x WHERE x.workspace_id = m.workspace_id AND x.person_id = m.keep_person_id AND x.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.workspace_invitation x WHERE x.workspace_id = m.workspace_id AND x.person_id = m.keep_person_id)
      OR EXISTS (SELECT 1 FROM public.mailout_recipient x WHERE x.workspace_id = m.workspace_id AND x.person_id = m.keep_person_id);
    IF v_used THEN
      v_keep_kept := true;
      UPDATE public.workspace_person SET
        slug = rtrim(left(slug, 56), '-') || '-' || right(replace(person_id::text, '-', ''), 6),
        previous_slugs = '{}'::text[]
      WHERE workspace_id = m.workspace_id AND person_id = m.keep_person_id;
    ELSE
      UPDATE public.workspace_person SET deleted_at = now(), previous_slugs = '{}'::text[]
      WHERE workspace_id = m.workspace_id AND person_id = m.keep_person_id;
    END IF;
  END IF;

  PERFORM private.person_merge_restore_dossier(m.drop_dossier_before);

  IF m.linked_user_id IS NOT NULL THEN
    UPDATE public.user_profile SET person_id = NULL
    WHERE user_id = m.linked_user_id AND person_id = m.keep_person_id;
  END IF;

  UPDATE public.person_merge SET undone_at = now(), undone_by = auth.uid() WHERE id = m.id;
  PERFORM set_config('hour.person_merge', '', true);

  RETURN jsonb_build_object('merge_id', m.id, 'skipped', v_skipped, 'keep_kept', v_keep_kept);
END;
$$;
COMMENT ON FUNCTION public.undo_person_merge(uuid) IS
  'Deshace una fusión de dossiers (admin del espacio, 30 días, una vez): lo movido vuelve a drop, los dos dossiers como estaban; lo creado después sobre keep se queda en keep. Devuelve cuántas filas se saltó. SECURITY DEFINER.';
REVOKE ALL ON FUNCTION public.undo_person_merge(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_person_merge(uuid) TO authenticated;
