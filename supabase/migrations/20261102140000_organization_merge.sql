-- 84 · Fusionar dos organizaciones del mismo espacio, con deshacer
-- (`_tasks.md` § AHORA). Sigue el patrón de la fusión de dossiers
-- (`20261022130000_person_merge`, `20261022180000_person_merge_notices`):
-- confirma el admin del espacio, lo que el admin no ve se mueve y no se
-- cuenta, «Deshacer» dura 30 días y una fusión posterior viva se deshace antes.
--
-- Qué referencia a `workspace_organization` (producción, 2026-11-01, más la
-- columna de `20261102130000`):
--   · `conversation.organization_id` (FK compuesta, NO ACTION). Con ella se
--     mueven los bolos (`bolo.conversation_id`) y todo lo que cuelga de la
--     conversación.
--   · `invoice.payer_organization_id` (FK compuesta). Una factura emitida
--     guarda su `payer_snapshot`: el pagador impreso no cambia.
--   · `workspace_person.organization_id`: los contactos de la organización.
--   · `venue.organization_id` (92).
-- Se mueven las filas vivas; lo borrado en blando se queda con la que
-- desaparece, como en la fusión de dossiers.
--
-- Choque: dos conversaciones vivas del mismo proyecto con las dos
-- organizaciones (los índices únicos `conversation_project_organization_*`,
-- compartida o privada de la misma persona). No se fusionan conversaciones:
-- la fusión se rechaza (22023) y la vista previa cuenta las que quien llama ve.
-- Fusionar dos conversaciones es otra operación, que no existe.
--
--   1. `workspace_organization.previous_slugs`: el slug de la que desaparece
--      sigue abriendo la ficha de la que se queda. El Worker aún no lo lee.
--   2. `organization_merge`: una fila por fusión con las dos organizaciones de
--      antes. La lee el admin del espacio.
--   3. `organization_merge_row`: qué se movió, para deshacer. Sin grant a
--      nadie (delataría conversaciones privadas ajenas). En `workspace_person`
--      la fila se nombra por `person_id` (su clave es espacio + persona).
--   4. `preview_organization_merge` (SECURITY INVOKER: los recuentos son lo
--      que la RLS deja leer), `merge_workspace_organization` y
--      `undo_organization_merge` (DEFINER).
--
-- Los datos de la que se queda: cada campo vacío toma el de la otra; las notas
-- se suman; `kind` toma el de la otra solo si el suyo es `other`; los datos
-- fiscales, los suyos y, si no tiene, los de la otra. El nombre y el slug no
-- cambian.
--
-- Funciones existentes que se llaman (producción, `pg_get_functiondef`,
-- 2026-11-01): `public.is_workspace_admin(uuid)`, `public.uuid_generate_v7()`.
-- No se redefine ninguna.
--
-- ADITIVA según § 34: dos tablas, una columna con DEFAULT, cuatro funciones
-- nuevas. No mueve datos. El Worker desplegado no lee nada de esto.
--
-- Rollback:
--   DROP FUNCTION public.undo_organization_merge(uuid);
--   DROP FUNCTION public.merge_workspace_organization(uuid, uuid, uuid);
--   DROP FUNCTION public.preview_organization_merge(uuid, uuid, uuid);
--   DROP FUNCTION private.organization_merge_restore(jsonb);
--   DROP FUNCTION private.organization_merge_pair(uuid, uuid, uuid);
--   DROP TABLE public.organization_merge_row, public.organization_merge;
--   ALTER TABLE public.workspace_organization DROP COLUMN previous_slugs;
-- (antes, deshacer las fusiones vivas: el rollback no devuelve las filas).

-- ── 1 · previous_slugs ───────────────────────────────────────────────────
ALTER TABLE public.workspace_organization
  ADD COLUMN previous_slugs text[] NOT NULL DEFAULT '{}'::text[];
COMMENT ON COLUMN public.workspace_organization.previous_slugs IS
  'Slugs de organizaciones fusionadas en esta (merge_workspace_organization): siguen abriendo esta ficha. Un slug vivo de otra organización gana siempre.';

-- ── 2 · organization_merge ───────────────────────────────────────────────
CREATE TABLE public.organization_merge (
  id                   uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id         uuid NOT NULL REFERENCES public.workspace (id) ON DELETE CASCADE,
  keep_organization_id uuid NOT NULL REFERENCES public.workspace_organization (id) ON DELETE CASCADE,
  drop_organization_id uuid NOT NULL REFERENCES public.workspace_organization (id) ON DELETE CASCADE,
  keep_before          jsonb NOT NULL CHECK (jsonb_typeof(keep_before) = 'object'),
  drop_before          jsonb NOT NULL CHECK (jsonb_typeof(drop_before) = 'object'),
  merged_by            uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  merged_at            timestamptz NOT NULL DEFAULT now(),
  undone_at            timestamptz,
  undone_by            uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  CONSTRAINT organization_merge_two CHECK (keep_organization_id <> drop_organization_id)
);
COMMENT ON TABLE public.organization_merge IS
  '84: una fusión de dos organizaciones del mismo espacio (merge_workspace_organization), con las dos filas de antes. La lee el admin del espacio; se escribe solo por RPC.';
CREATE INDEX organization_merge_workspace_idx ON public.organization_merge (workspace_id, merged_at DESC);
CREATE INDEX organization_merge_keep_idx ON public.organization_merge (keep_organization_id);
CREATE INDEX organization_merge_drop_idx ON public.organization_merge (drop_organization_id);
CREATE INDEX organization_merge_merged_by_idx ON public.organization_merge (merged_by);
CREATE INDEX organization_merge_undone_by_idx ON public.organization_merge (undone_by);

-- ── 3 · organization_merge_row ───────────────────────────────────────────
CREATE TABLE public.organization_merge_row (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  merge_id   uuid NOT NULL REFERENCES public.organization_merge (id) ON DELETE CASCADE,
  table_name text NOT NULL CHECK (table_name IN ('conversation', 'invoice', 'workspace_person', 'venue')),
  row_id     uuid NOT NULL,
  action     text NOT NULL DEFAULT 'repointed' CHECK (action = 'repointed')
);
COMMENT ON TABLE public.organization_merge_row IS
  '84: qué filas reapuntó una fusión de organizaciones, en orden (id), para undo_organization_merge. En workspace_person, row_id es person_id. Sin grant a nadie.';
CREATE INDEX organization_merge_row_merge_idx ON public.organization_merge_row (merge_id, id);

-- ── 4 · permisos de las tablas ───────────────────────────────────────────
ALTER TABLE public.organization_merge     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_merge_row ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.organization_merge, public.organization_merge_row
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.organization_merge TO authenticated;

CREATE POLICY organization_merge_select ON public.organization_merge
  FOR SELECT TO authenticated
  USING (public.is_workspace_admin(workspace_id));
-- organization_merge_row: RLS sin políticas y sin grant.

-- ── 5 · puertas comunes ──────────────────────────────────────────────────
-- 42501, igual para «no existe» y «no puedes»: no es admin del espacio, o una
-- de las dos no está viva en ese espacio. 22023: las dos son la misma.
CREATE FUNCTION private.organization_merge_pair(
  p_workspace_id         uuid,
  p_keep_organization_id uuid,
  p_drop_organization_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL OR p_keep_organization_id IS NULL OR p_drop_organization_id IS NULL
     OR NOT public.is_workspace_admin(p_workspace_id) THEN
    RAISE EXCEPTION 'organization not found' USING ERRCODE = '42501';
  END IF;
  IF p_keep_organization_id = p_drop_organization_id THEN
    RAISE EXCEPTION 'an organization cannot be merged with itself' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.workspace_organization o
      WHERE o.workspace_id = p_workspace_id AND o.deleted_at IS NULL
        AND o.id IN (p_keep_organization_id, p_drop_organization_id)) <> 2 THEN
    RAISE EXCEPTION 'organization not found' USING ERRCODE = '42501';
  END IF;
END;
$$;
COMMENT ON FUNCTION private.organization_merge_pair(uuid, uuid, uuid) IS
  '84: puertas de la fusión de organizaciones: admin del espacio, dos organizaciones distintas y vivas del espacio. SECURITY DEFINER.';
REVOKE ALL ON FUNCTION private.organization_merge_pair(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.organization_merge_pair(uuid, uuid, uuid) TO authenticated;

-- Devuelve una organización a como estaba (deshacer). Interna: sin grant.
CREATE FUNCTION private.organization_merge_restore(p_before jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  UPDATE public.workspace_organization t SET
    slug               = x.slug,
    name               = x.name,
    kind               = x.kind,
    email              = x.email,
    phone              = x.phone,
    website            = x.website,
    address            = x.address,
    city               = x.city,
    country            = x.country,
    notes              = x.notes,
    custom_fields      = x.custom_fields,
    fiscal_identity_id = x.fiscal_identity_id,
    previous_slugs     = x.previous_slugs,
    deleted_at         = x.deleted_at
  FROM jsonb_populate_record(NULL::public.workspace_organization, p_before) x
  WHERE t.id = x.id AND t.workspace_id = x.workspace_id;
$$;
REVOKE ALL ON FUNCTION private.organization_merge_restore(jsonb) FROM PUBLIC, anon, authenticated;

-- ── 6 · preview_organization_merge ───────────────────────────────────────
-- Solo lectura, SECURITY INVOKER: lo que quien llama no ve (conversaciones
-- privadas ajenas, facturas sin read:money) no se cuenta.
CREATE FUNCTION public.preview_organization_merge(
  p_workspace_id         uuid,
  p_keep_organization_id uuid,
  p_drop_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_ws   uuid := p_workspace_id;
  v_keep uuid := p_keep_organization_id;
  v_drop uuid := p_drop_organization_id;
BEGIN
  PERFORM private.organization_merge_pair(v_ws, v_keep, v_drop);
  RETURN jsonb_build_object(
    'keep_organization_id', v_keep,
    'drop_organization_id', v_drop,
    'keep', (SELECT jsonb_build_object('name', o.name, 'slug', o.slug, 'kind', o.kind,
                                       'email', o.email, 'city', o.city, 'created_at', o.created_at)
             FROM public.workspace_organization o WHERE o.id = v_keep),
    'drop', (SELECT jsonb_build_object('name', o.name, 'slug', o.slug, 'kind', o.kind,
                                       'email', o.email, 'city', o.city, 'created_at', o.created_at)
             FROM public.workspace_organization o WHERE o.id = v_drop),
    'counts', jsonb_build_object(
      'conversations', (SELECT count(*) FROM public.conversation c
                        WHERE c.workspace_id = v_ws AND c.organization_id = v_drop AND c.deleted_at IS NULL),
      'bolos', (SELECT count(*) FROM public.bolo b
                JOIN public.conversation c ON c.id = b.conversation_id
                WHERE c.workspace_id = v_ws AND c.organization_id = v_drop
                  AND c.deleted_at IS NULL AND b.deleted_at IS NULL),
      'contacts', (SELECT count(*) FROM public.workspace_person wp
                   WHERE wp.workspace_id = v_ws AND wp.organization_id = v_drop AND wp.deleted_at IS NULL),
      'invoices', (SELECT count(*) FROM public.invoice i
                   WHERE i.workspace_id = v_ws AND i.payer_organization_id = v_drop AND i.deleted_at IS NULL),
      'venues', (SELECT count(*) FROM public.venue vn
                 WHERE vn.workspace_id = v_ws AND vn.organization_id = v_drop AND vn.deleted_at IS NULL)
    ),
    -- Conversaciones del mismo proyecto con las dos: la fusión las rechaza.
    'conflicts', jsonb_build_object(
      'conversations', (SELECT count(*) FROM public.conversation d
                        JOIN public.conversation k
                          ON k.workspace_id = d.workspace_id AND k.project_id = d.project_id
                         AND k.organization_id = v_keep AND k.deleted_at IS NULL
                         AND k.private_to IS NOT DISTINCT FROM d.private_to
                        WHERE d.workspace_id = v_ws AND d.organization_id = v_drop AND d.deleted_at IS NULL)
    )
  );
END;
$$;
COMMENT ON FUNCTION public.preview_organization_merge(uuid, uuid, uuid) IS
  '84: vista previa de merge_workspace_organization: las dos organizaciones y los recuentos de lo que quien llama puede leer (SECURITY INVOKER). Rechaza lo mismo que la fusión.';
REVOKE ALL ON FUNCTION public.preview_organization_merge(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.preview_organization_merge(uuid, uuid, uuid) TO authenticated;

-- ── 7 · merge_workspace_organization ─────────────────────────────────────
CREATE FUNCTION public.merge_workspace_organization(
  p_workspace_id         uuid,
  p_keep_organization_id uuid,
  p_drop_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_ws    uuid := p_workspace_id;
  v_keep  uuid := p_keep_organization_id;
  v_drop  uuid := p_drop_organization_id;
  v_k     public.workspace_organization;
  v_d     public.workspace_organization;
  v_merge uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- Las dos, bloqueadas en orden fijo, antes de mirar nada.
  PERFORM 1 FROM public.workspace_organization o
  WHERE o.workspace_id = v_ws AND o.id IN (v_keep, v_drop)
  ORDER BY o.id
  FOR UPDATE;

  PERFORM private.organization_merge_pair(v_ws, v_keep, v_drop);

  -- Todas las conversaciones, también las que quien llama no ve: el índice
  -- único las vería igual. Sin recuento en el mensaje.
  IF EXISTS (
    SELECT 1 FROM public.conversation d
    JOIN public.conversation k
      ON k.workspace_id = d.workspace_id AND k.project_id = d.project_id
     AND k.organization_id = v_keep AND k.deleted_at IS NULL
     AND k.private_to IS NOT DISTINCT FROM d.private_to
    WHERE d.workspace_id = v_ws AND d.organization_id = v_drop AND d.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'both organizations have a conversation in the same project'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_k FROM public.workspace_organization WHERE id = v_keep;
  SELECT * INTO v_d FROM public.workspace_organization WHERE id = v_drop;

  INSERT INTO public.organization_merge (
    workspace_id, keep_organization_id, drop_organization_id, keep_before, drop_before, merged_by
  ) VALUES (v_ws, v_keep, v_drop, to_jsonb(v_k), to_jsonb(v_d), auth.uid())
  RETURNING id INTO v_merge;

  -- 1 · La que desaparece, primero: libera su nombre y su slug.
  UPDATE public.workspace_organization SET
    deleted_at    = now(),
    custom_fields = custom_fields || jsonb_build_object('merged_into', v_keep)
  WHERE id = v_drop;

  -- 2 · La que se queda.
  UPDATE public.workspace_organization SET
    kind               = CASE WHEN v_k.kind = 'other' THEN v_d.kind ELSE v_k.kind END,
    email              = coalesce(v_k.email, v_d.email),
    phone              = coalesce(v_k.phone, v_d.phone),
    website            = coalesce(v_k.website, v_d.website),
    address            = coalesce(v_k.address, v_d.address),
    city               = coalesce(v_k.city, v_d.city),
    country            = coalesce(v_k.country, v_d.country),
    notes              = CASE
                           WHEN nullif(btrim(v_d.notes), '') IS NULL OR v_d.notes = v_k.notes THEN v_k.notes
                           WHEN nullif(btrim(v_k.notes), '') IS NULL THEN v_d.notes
                           ELSE v_k.notes || E'\n\n' || v_d.notes
                         END,
    custom_fields      = (v_d.custom_fields - 'merged_into') || v_k.custom_fields,
    fiscal_identity_id = coalesce(v_k.fiscal_identity_id, v_d.fiscal_identity_id),
    previous_slugs     = ARRAY(
                           SELECT DISTINCT s FROM unnest(v_k.previous_slugs || v_d.previous_slugs || ARRAY[v_d.slug]) s
                           WHERE s IS NOT NULL AND s <> v_k.slug
                           ORDER BY s
                         )
  WHERE id = v_keep;

  -- 3 · Reapuntar lo vivo, solo en este espacio.
  WITH moved AS (
    UPDATE public.conversation SET organization_id = v_keep
    WHERE workspace_id = v_ws AND organization_id = v_drop AND deleted_at IS NULL
    RETURNING id
  )
  INSERT INTO public.organization_merge_row (merge_id, table_name, row_id)
  SELECT v_merge, 'conversation', id FROM moved ORDER BY id;

  WITH moved AS (
    UPDATE public.invoice SET payer_organization_id = v_keep
    WHERE workspace_id = v_ws AND payer_organization_id = v_drop AND deleted_at IS NULL
    RETURNING id
  )
  INSERT INTO public.organization_merge_row (merge_id, table_name, row_id)
  SELECT v_merge, 'invoice', id FROM moved ORDER BY id;

  WITH moved AS (
    UPDATE public.workspace_person SET organization_id = v_keep
    WHERE workspace_id = v_ws AND organization_id = v_drop AND deleted_at IS NULL
    RETURNING person_id
  )
  INSERT INTO public.organization_merge_row (merge_id, table_name, row_id)
  SELECT v_merge, 'workspace_person', person_id FROM moved ORDER BY person_id;

  WITH moved AS (
    UPDATE public.venue SET organization_id = v_keep
    WHERE workspace_id = v_ws AND organization_id = v_drop AND deleted_at IS NULL
    RETURNING id
  )
  INSERT INTO public.organization_merge_row (merge_id, table_name, row_id)
  SELECT v_merge, 'venue', id FROM moved ORDER BY id;

  -- Sin recuentos: incluirían lo que quien llama no ve.
  RETURN jsonb_build_object(
    'merge_id', v_merge,
    'keep_organization_id', v_keep,
    'drop_organization_id', v_drop
  );
END;
$$;
COMMENT ON FUNCTION public.merge_workspace_organization(uuid, uuid, uuid) IS
  '84: fusiona la organización drop en keep dentro de un espacio (solo el admin): reapunta conversaciones (y con ellas sus bolos), facturas, contactos y salas vivas; drop queda borrada con merged_into. Rechaza (22023) si las dos tienen conversación en el mismo proyecto. Registro en organization_merge(_row) para undo_organization_merge. SECURITY DEFINER.';
REVOKE ALL ON FUNCTION public.merge_workspace_organization(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.merge_workspace_organization(uuid, uuid, uuid) TO authenticated;

-- ── 8 · undo_organization_merge ──────────────────────────────────────────
-- Admin del espacio, menos de 30 días, no deshecha, y sin una fusión
-- posterior viva que se llevara a keep (esa se deshace antes). La que
-- desapareció vuelve primero (el guard de la sala pide una organización viva);
-- después las dos filas como estaban y lo movido vuelve, en orden inverso. Lo
-- que se apuntó a keep después de fusionar se queda en keep; una fila que ya
-- no apunta a keep se salta y se cuenta.
CREATE FUNCTION public.undo_organization_merge(p_merge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  m         public.organization_merge;
  r         public.organization_merge_row;
  v_skipped integer := 0;
  v_n       integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO m FROM public.organization_merge WHERE id = p_merge_id FOR UPDATE;
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
    SELECT 1 FROM public.organization_merge l
    WHERE l.workspace_id = m.workspace_id AND l.drop_organization_id = m.keep_organization_id
      AND l.undone_at IS NULL AND l.merged_at >= m.merged_at AND l.id <> m.id
  ) THEN
    RAISE EXCEPTION 'undo the later merge first' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.workspace_organization o
  WHERE o.id IN (m.keep_organization_id, m.drop_organization_id)
  ORDER BY o.id
  FOR UPDATE;

  -- Las dos como estaban. Si alguien creó después otra organización con el
  -- nombre o el slug de la que vuelve, el índice único lo dice (23505).
  PERFORM private.organization_merge_restore(m.keep_before);
  PERFORM private.organization_merge_restore(m.drop_before);

  FOR r IN
    SELECT * FROM public.organization_merge_row x WHERE x.merge_id = m.id ORDER BY x.id DESC
  LOOP
    v_n := 0;
    BEGIN
      IF r.table_name = 'conversation' THEN
        UPDATE public.conversation SET organization_id = m.drop_organization_id
        WHERE id = r.row_id AND organization_id = m.keep_organization_id AND deleted_at IS NULL;
      ELSIF r.table_name = 'invoice' THEN
        UPDATE public.invoice SET payer_organization_id = m.drop_organization_id
        WHERE id = r.row_id AND payer_organization_id = m.keep_organization_id AND deleted_at IS NULL;
      ELSIF r.table_name = 'workspace_person' THEN
        UPDATE public.workspace_person SET organization_id = m.drop_organization_id
        WHERE workspace_id = m.workspace_id AND person_id = r.row_id
          AND organization_id = m.keep_organization_id AND deleted_at IS NULL;
      ELSIF r.table_name = 'venue' THEN
        UPDATE public.venue SET organization_id = m.drop_organization_id
        WHERE id = r.row_id AND organization_id = m.keep_organization_id AND deleted_at IS NULL;
      END IF;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    EXCEPTION WHEN unique_violation OR foreign_key_violation OR check_violation THEN
      v_n := 0;
    END;
    IF v_n = 0 THEN
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  UPDATE public.organization_merge SET undone_at = now(), undone_by = auth.uid() WHERE id = m.id;

  RETURN jsonb_build_object('merge_id', m.id, 'skipped', v_skipped);
END;
$$;
COMMENT ON FUNCTION public.undo_organization_merge(uuid) IS
  '84: deshace una fusión de organizaciones (admin del espacio, 30 días, una vez): las dos como estaban y lo movido vuelve a drop; lo apuntado después a keep se queda. Devuelve cuántas filas se saltó. SECURITY DEFINER.';
REVOKE ALL ON FUNCTION public.undo_organization_merge(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.undo_organization_merge(uuid) TO authenticated;
