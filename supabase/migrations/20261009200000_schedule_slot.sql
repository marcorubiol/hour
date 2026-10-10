-- ADR-090 P1 · `schedule_slot`: la escaleta, una lista de momentos colgada de
-- la función o del día (`_tasks.md § 17`).
--
-- Hasta hoy el orden del día de una función eran CINCO COLUMNAS fijas en
-- `performance` (`load_in_at`, `soundcheck_at`, `start_at`, `loadout_at`,
-- `wrap_at`) con un CHECK de orden: una lista disfrazada de columnas, y nadie
-- podía añadir «photo call» sin migración. Un ensayo no tenía ninguna.
--
-- LO QUE ESTA MIGRACIÓN HACE:
--
--   1. `schedule_slot`, colgada de una función XOR de un día. Postura de
--      `travel_stage`: RLS forzada, solo SELECT directo, escritura por RPC.
--   2. Cinco RPC de escritura, todas con la puerta `edit:performance` sobre el
--      proyecto del padre: create / update / delete / reorder, y
--      `replace_schedule_slots`, la que diffea una lista entera por id (la
--      materialización que el worker de collab usará en P2, y la que usa hoy
--      el PATCH de la función).
--   3. Backfill: cada franja con hora se convierte en un slot con su `kind`
--      (`load_in · soundcheck · start · loadout · wrap`), en ese orden.
--   4. `get_public_calendar` y `get_public_roadsheet` leen las franjas de
--      `schedule_slot`, con EL MISMO JSON de salida que antes.
--   5. DROP de las cinco columnas y del CHECK `performance_timeslots_ordered`.
--
-- Decisiones mínimas sobre la letra del ADR (anotadas para el coordinador):
--   · `label` es NULLABLE: un slot con `kind` conocido se nombra desde el kind
--     (y así se traduce); uno libre lleva label. El CHECK exige al menos uno.
--   · `at` es NOT NULL: un momento sin hora no es un momento de la escaleta.
--   · `kind` es texto con forma de identificador, no un enum (ADR-090: «adiós
--     al enum»).
--   · `sort` es 1..N sin huecos, con UNIQUE diferible por padre, como
--     `travel_stage.position`. Esos dos UNIQUE son también los índices
--     `(performance_id, sort)` y `(date_id, sort)` que pedía el ADR.
--   · El backfill ordena por el orden canónico de las cinco franjas, no por
--     hora: el CHECK viejo solo ordenaba pares ADYACENTES, así que con huecos
--     la hora podía no seguir el orden de columnas.
--   · La regla de orden de las cinco franjas no desaparece para el usuario:
--     la valida ahora el PATCH de la app (`$lib/schedule-slot.ts`), porque
--     con labels libres no tiene sentido como CHECK de tabla.
--
-- NO ES COMPATIBLE CON EL WORKER DESPLEGADO. El Worker de hoy nombra las cinco
-- columnas en el `select` de `/api/performances`, del detalle y del PATCH:
-- con la base migrada, esos endpoints dan 400/42703 y caen el mes, la agenda,
-- el tablero, el detalle y el road sheet. Esta migración y el Worker que lee
-- `schedule_slot` van JUNTOS, en una ventana corta: apply y deploy seguidos.
--
-- DESTRUCTIVA SEGÚN § 34 (DROP COLUMN). Staging obligatorio e `inspect` antes.
-- Sin CASCADE a propósito: si algo que solo tiene producción depende de una
-- de las columnas (una vista en `hour_backup_20260720`, por ejemplo), el DROP
-- falla y la transacción entera revierte. Y antes del DROP se pregunta al
-- catálogo por cualquier función que nombre las columnas (ver § 6).

-- ── 1 · la tabla ──────────────────────────────────────────────────────────
CREATE TABLE public.schedule_slot (
  id             uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  -- Heredados del padre, y guardados aquí para que la policy no tenga que
  -- cruzar al padre para saber de qué proyecto es (ADR-090).
  workspace_id   uuid NOT NULL REFERENCES public.workspace(id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES public.project(id) ON DELETE CASCADE,
  performance_id uuid REFERENCES public.performance(id) ON DELETE CASCADE,
  date_id        uuid REFERENCES public.date(id) ON DELETE CASCADE,
  label          text,
  kind           text,
  at             timestamptz NOT NULL,
  ends_at        timestamptz,
  sort           smallint NOT NULL,
  notes          text,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- Exactamente un padre: la función o el día.
  CONSTRAINT schedule_slot_one_parent
    CHECK (num_nonnulls(performance_id, date_id) = 1),
  CONSTRAINT schedule_slot_named
    CHECK (label IS NOT NULL OR kind IS NOT NULL),
  CONSTRAINT schedule_slot_label_nonblank
    CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 200),
  CONSTRAINT schedule_slot_kind_format
    CHECK (kind IS NULL OR kind ~ '^[a-z][a-z0-9_]{0,31}$'),
  CONSTRAINT schedule_slot_time_range
    CHECK (ends_at IS NULL OR ends_at >= at),
  CONSTRAINT schedule_slot_sort_positive CHECK (sort >= 1),
  CONSTRAINT schedule_slot_notes_length
    CHECK (notes IS NULL OR length(notes) <= 5000),
  -- Un orden sin empates por padre. DIFERIDAS porque reordenar reescribe todas
  -- las posiciones en una sentencia. Los NULL no chocan entre sí, así que cada
  -- una solo ordena a los hijos de su tipo de padre.
  CONSTRAINT schedule_slot_performance_sort_key
    UNIQUE (performance_id, sort) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT schedule_slot_date_sort_key
    UNIQUE (date_id, sort) DEFERRABLE INITIALLY DEFERRED
);

COMMENT ON TABLE public.schedule_slot IS
  'ADR-090: one moment of the running order (load in, photo call, start...). Hangs from a performance XOR a date. Written only through create/update/delete/reorder/replace_schedule_slot(s). The five legacy timeslots live here with kind load_in|soundcheck|start|loadout|wrap.';
COMMENT ON COLUMN public.schedule_slot.kind IS
  'Optional machine kind (icons, road sheet role matrix). Legacy timeslots: load_in, soundcheck, start, loadout, wrap. A slot with a kind and no label is named from its kind.';
COMMENT ON COLUMN public.schedule_slot.sort IS
  'Position 1..N within its parent, no gaps. In P2 the CRDT owns the order and this is its materialization.';

CREATE INDEX schedule_slot_workspace_id_idx ON public.schedule_slot (workspace_id);
CREATE INDEX schedule_slot_project_id_idx   ON public.schedule_slot (project_id);
CREATE INDEX schedule_slot_created_by_idx   ON public.schedule_slot (created_by) WHERE created_by IS NOT NULL;

ALTER TABLE public.schedule_slot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_slot FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.schedule_slot FROM PUBLIC, anon, service_role;

-- Se lee con el permiso con que se lee el padre (`performance_select` y
-- `date_select` piden `read:performance`), y desaparece con él: un padre
-- borrado (`deleted_at`) no deja momentos visibles.
CREATE POLICY schedule_slot_select ON public.schedule_slot
  FOR SELECT TO authenticated
  USING (
    public.has_permission(project_id, 'read:performance')
    AND (
      (performance_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.performance p
        WHERE p.id = schedule_slot.performance_id AND p.deleted_at IS NULL))
      OR
      (date_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.date d
        WHERE d.id = schedule_slot.date_id AND d.deleted_at IS NULL))
    )
  );

GRANT SELECT ON TABLE public.schedule_slot TO authenticated;

CREATE TRIGGER schedule_slot_set_updated_at
BEFORE UPDATE ON public.schedule_slot
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER schedule_slot_audit
AFTER INSERT OR DELETE OR UPDATE ON public.schedule_slot
FOR EACH ROW EXECUTE FUNCTION public.write_audit();

-- ── 2 · la puerta común ───────────────────────────────────────────────────
-- Resuelve el padre, lo bloquea (dos escrituras en la misma escaleta se ponen
-- en fila en vez de calcular la misma posición) y comprueba `edit:performance`.
-- «No existe» y «no es tuyo» dan el mismo 42501: no es un oráculo de
-- existencia. Vive en `private`, fuera del esquema que expone PostgREST.
CREATE FUNCTION private.schedule_slot_parent(
  p_target_table text,
  p_target_id    uuid,
  OUT workspace_id uuid,
  OUT project_id   uuid
)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_target_table = 'performance' THEN
    SELECT p.workspace_id, p.project_id INTO workspace_id, project_id
    FROM public.performance p
    WHERE p.id = p_target_id AND p.deleted_at IS NULL
    FOR UPDATE;
  ELSIF p_target_table = 'date' THEN
    SELECT d.workspace_id, d.project_id INTO workspace_id, project_id
    FROM public.date d
    WHERE d.id = p_target_id AND d.deleted_at IS NULL
    FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'target_table must be performance or date' USING ERRCODE = '22023';
  END IF;

  IF project_id IS NULL OR NOT public.has_permission(project_id, 'edit:performance') THEN
    RAISE EXCEPTION '% % not found', p_target_table, p_target_id USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.schedule_slot_parent(text, uuid) FROM PUBLIC, anon, authenticated;

-- El padre de un slot existente, en la forma (tabla, id) que toman las demás.
CREATE FUNCTION private.schedule_slot_target(p_slot_id uuid, OUT target_table text, OUT target_id uuid)
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE WHEN s.performance_id IS NOT NULL THEN 'performance' ELSE 'date' END,
         coalesce(s.performance_id, s.date_id)
  FROM public.schedule_slot s WHERE s.id = p_slot_id;
$$;

REVOKE ALL ON FUNCTION private.schedule_slot_target(uuid) FROM PUBLIC, anon, authenticated;

-- Cierra los huecos de `sort` tras un borrado.
CREATE FUNCTION private.schedule_slot_compact(p_target_table text, p_target_id uuid)
RETURNS void
LANGUAGE sql
SET search_path TO 'public', 'pg_temp'
AS $$
  UPDATE public.schedule_slot s
  SET sort = r.rn
  FROM (
    SELECT id, row_number() OVER (ORDER BY sort) AS rn
    FROM public.schedule_slot
    WHERE (p_target_table = 'performance' AND performance_id = p_target_id)
       OR (p_target_table = 'date' AND date_id = p_target_id)
  ) r
  WHERE s.id = r.id AND s.sort <> r.rn;
$$;

REVOKE ALL ON FUNCTION private.schedule_slot_compact(text, uuid) FROM PUBLIC, anon, authenticated;

-- ── 3 · las cinco puertas de escritura ────────────────────────────────────

-- create_schedule_slot: añade un momento AL FINAL de la escaleta.
CREATE FUNCTION public.create_schedule_slot(
  p_target_table text,
  p_target_id    uuid,
  p_at           timestamptz,
  p_label        text DEFAULT NULL,
  p_kind         text DEFAULT NULL,
  p_ends_at      timestamptz DEFAULT NULL,
  p_notes        text DEFAULT NULL
) RETURNS public.schedule_slot
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_parent record;
  v_sort   smallint;
  v_row    public.schedule_slot;
BEGIN
  SELECT * INTO v_parent FROM private.schedule_slot_parent(p_target_table, p_target_id);

  IF p_at IS NULL THEN
    RAISE EXCEPTION 'at cannot be null' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(max(sort), 0) + 1 INTO v_sort
  FROM public.schedule_slot
  WHERE (p_target_table = 'performance' AND performance_id = p_target_id)
     OR (p_target_table = 'date' AND date_id = p_target_id);

  INSERT INTO public.schedule_slot (
    workspace_id, project_id, performance_id, date_id,
    label, kind, at, ends_at, sort, notes, created_by
  ) VALUES (
    v_parent.workspace_id, v_parent.project_id,
    CASE WHEN p_target_table = 'performance' THEN p_target_id END,
    CASE WHEN p_target_table = 'date' THEN p_target_id END,
    nullif(btrim(coalesce(p_label, '')), ''),
    nullif(btrim(coalesce(p_kind, '')), ''),
    p_at, p_ends_at, v_sort,
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- update_schedule_slot: SUSTITUYE los campos del momento (lo que llega NULL se
-- borra, como en `update_travel_stage`). La posición no se toca aquí.
CREATE FUNCTION public.update_schedule_slot(
  p_slot_id uuid,
  p_at      timestamptz,
  p_label   text DEFAULT NULL,
  p_kind    text DEFAULT NULL,
  p_ends_at timestamptz DEFAULT NULL,
  p_notes   text DEFAULT NULL
) RETURNS public.schedule_slot
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_target record;
  v_row    public.schedule_slot;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_target FROM private.schedule_slot_target(p_slot_id);
  IF v_target.target_id IS NULL THEN
    RAISE EXCEPTION 'slot % not found', p_slot_id USING ERRCODE = '42501';
  END IF;
  PERFORM private.schedule_slot_parent(v_target.target_table, v_target.target_id);

  IF p_at IS NULL THEN
    RAISE EXCEPTION 'at cannot be null' USING ERRCODE = '22023';
  END IF;

  UPDATE public.schedule_slot SET
    at      = p_at,
    label   = nullif(btrim(coalesce(p_label, '')), ''),
    kind    = nullif(btrim(coalesce(p_kind, '')), ''),
    ends_at = p_ends_at,
    notes   = nullif(btrim(coalesce(p_notes, '')), '')
  WHERE id = p_slot_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- delete_schedule_slot: borra de verdad (el audit_log guarda la fila) y cierra
-- el hueco, para que las posiciones sigan siendo 1..N.
CREATE FUNCTION public.delete_schedule_slot(p_slot_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_target record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_target FROM private.schedule_slot_target(p_slot_id);
  IF v_target.target_id IS NULL THEN
    RAISE EXCEPTION 'slot % not found', p_slot_id USING ERRCODE = '42501';
  END IF;
  PERFORM private.schedule_slot_parent(v_target.target_table, v_target.target_id);

  DELETE FROM public.schedule_slot WHERE id = p_slot_id;
  PERFORM private.schedule_slot_compact(v_target.target_table, v_target.target_id);
END;
$$;

-- reorder_schedule_slots: el orden entero de una escaleta, de una vez. La
-- lista tiene que ser EXACTAMENTE sus momentos: ni uno de más, ni uno de
-- menos, ni repetidos.
CREATE FUNCTION public.reorder_schedule_slots(
  p_target_table text,
  p_target_id    uuid,
  p_slot_ids     uuid[]
) RETURNS SETOF public.schedule_slot
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_n integer := coalesce(array_length(p_slot_ids, 1), 0);
BEGIN
  PERFORM private.schedule_slot_parent(p_target_table, p_target_id);

  IF p_slot_ids IS NULL
    OR v_n <> (SELECT count(DISTINCT x) FROM unnest(p_slot_ids) x)
    OR v_n <> (
      SELECT count(*) FROM public.schedule_slot
      WHERE (p_target_table = 'performance' AND performance_id = p_target_id)
         OR (p_target_table = 'date' AND date_id = p_target_id))
    OR EXISTS (
      SELECT 1 FROM unnest(p_slot_ids) x
      WHERE NOT EXISTS (
        SELECT 1 FROM public.schedule_slot s
        WHERE s.id = x
          AND ((p_target_table = 'performance' AND s.performance_id = p_target_id)
            OR (p_target_table = 'date' AND s.date_id = p_target_id))))
  THEN
    RAISE EXCEPTION 'slot ids must be exactly the slots of this running order'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.schedule_slot s
  SET sort = o.ord
  FROM unnest(p_slot_ids) WITH ORDINALITY AS o(id, ord)
  WHERE s.id = o.id AND s.sort <> o.ord;

  RETURN QUERY
  SELECT * FROM public.schedule_slot
  WHERE (p_target_table = 'performance' AND performance_id = p_target_id)
     OR (p_target_table = 'date' AND date_id = p_target_id)
  ORDER BY sort;
END;
$$;

-- replace_schedule_slots: la escaleta entera, en una transacción, diffeada por
-- id (ADR-090 § materialización). `p_slots` es un array JSON en el orden
-- final; cada elemento `{id?, label?, kind?, at, ends_at?, notes?}`.
--   · id que ya es de esta escaleta → se actualiza si cambió algo.
--   · id nuevo (o sin id)          → se crea, con ese id si lo trae (el id
--                                    del Y.Map en P2).
--   · fila que no está en la lista → se borra.
--   · id que pertenece a OTRA escaleta → 22023: no se roba un slot ajeno.
-- Las posiciones salen del orden del array, 1..N.
CREATE FUNCTION public.replace_schedule_slots(
  p_target_table text,
  p_target_id    uuid,
  p_slots        jsonb
) RETURNS SETOF public.schedule_slot
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_parent record;
  v_item   jsonb;
  v_ord    integer;
  v_id     uuid;
  v_ids    uuid[] := '{}';
BEGIN
  SELECT * INTO v_parent FROM private.schedule_slot_parent(p_target_table, p_target_id);

  IF p_slots IS NULL OR jsonb_typeof(p_slots) <> 'array' THEN
    RAISE EXCEPTION 'slots must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_slots) > 200 THEN
    RAISE EXCEPTION 'too many slots (max 200)' USING ERRCODE = '22023';
  END IF;

  -- Ids explícitos: sin repetidos, y ninguno de otra escaleta.
  SELECT coalesce(array_agg((e->>'id')::uuid), '{}') INTO v_ids
  FROM jsonb_array_elements(p_slots) e
  WHERE nullif(e->>'id', '') IS NOT NULL;

  IF cardinality(v_ids) <> (SELECT count(DISTINCT x) FROM unnest(v_ids) x) THEN
    RAISE EXCEPTION 'duplicate slot id' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.schedule_slot s
    WHERE s.id = ANY (v_ids)
      AND NOT ((p_target_table = 'performance' AND s.performance_id IS NOT DISTINCT FROM p_target_id)
            OR (p_target_table = 'date' AND s.date_id IS NOT DISTINCT FROM p_target_id))
  ) THEN
    RAISE EXCEPTION 'slot belongs to another running order' USING ERRCODE = '22023';
  END IF;

  -- Bajas.
  DELETE FROM public.schedule_slot s
  WHERE ((p_target_table = 'performance' AND s.performance_id = p_target_id)
      OR (p_target_table = 'date' AND s.date_id = p_target_id))
    AND NOT (s.id = ANY (v_ids));

  -- Altas y cambios, en orden. Las UNIQUE de `sort` son diferidas, así que
  -- las posiciones intermedias pueden coincidir dentro de la transacción.
  FOR v_item, v_ord IN
    SELECT e, o FROM jsonb_array_elements(p_slots) WITH ORDINALITY AS t(e, o)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'each slot must be an object' USING ERRCODE = '22023';
    END IF;
    IF nullif(v_item->>'at', '') IS NULL THEN
      RAISE EXCEPTION 'slot % has no at', v_ord USING ERRCODE = '22023';
    END IF;

    v_id := coalesce(nullif(v_item->>'id', '')::uuid, public.uuid_generate_v7());

    INSERT INTO public.schedule_slot AS s (
      id, workspace_id, project_id, performance_id, date_id,
      label, kind, at, ends_at, sort, notes, created_by
    ) VALUES (
      v_id, v_parent.workspace_id, v_parent.project_id,
      CASE WHEN p_target_table = 'performance' THEN p_target_id END,
      CASE WHEN p_target_table = 'date' THEN p_target_id END,
      nullif(btrim(coalesce(v_item->>'label', '')), ''),
      nullif(btrim(coalesce(v_item->>'kind', '')), ''),
      (v_item->>'at')::timestamptz,
      nullif(v_item->>'ends_at', '')::timestamptz,
      v_ord,
      nullif(btrim(coalesce(v_item->>'notes', '')), ''),
      auth.uid()
    )
    ON CONFLICT (id) DO UPDATE SET
      label   = EXCLUDED.label,
      kind    = EXCLUDED.kind,
      at      = EXCLUDED.at,
      ends_at = EXCLUDED.ends_at,
      sort    = EXCLUDED.sort,
      notes   = EXCLUDED.notes
    -- Solo si cambió algo: así el audit_log no se llena de no-cambios cada
    -- vez que el doc se materializa.
    WHERE (s.label, s.kind, s.at, s.ends_at, s.sort, s.notes)
          IS DISTINCT FROM
          (EXCLUDED.label, EXCLUDED.kind, EXCLUDED.at, EXCLUDED.ends_at, EXCLUDED.sort, EXCLUDED.notes);
  END LOOP;

  RETURN QUERY
  SELECT * FROM public.schedule_slot
  WHERE (p_target_table = 'performance' AND performance_id = p_target_id)
     OR (p_target_table = 'date' AND date_id = p_target_id)
  ORDER BY sort;
END;
$$;

REVOKE ALL ON FUNCTION public.create_schedule_slot(text, uuid, timestamptz, text, text, timestamptz, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_schedule_slot(text, uuid, timestamptz, text, text, timestamptz, text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.update_schedule_slot(uuid, timestamptz, text, text, timestamptz, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_schedule_slot(uuid, timestamptz, text, text, timestamptz, text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.delete_schedule_slot(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_schedule_slot(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.reorder_schedule_slots(text, uuid, uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reorder_schedule_slots(text, uuid, uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.replace_schedule_slots(text, uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.replace_schedule_slots(text, uuid, jsonb) TO authenticated;

-- ── 4 · backfill de las cinco franjas ─────────────────────────────────────
-- Todas las funciones, también las borradas (soft): el dato no se pierde por
-- estar en la papelera. El orden es el canónico de las columnas.
INSERT INTO public.schedule_slot (
  workspace_id, project_id, performance_id, kind, at, sort, created_by
)
SELECT p.workspace_id, p.project_id, p.id, t.kind, t.at,
       row_number() OVER (PARTITION BY p.id ORDER BY t.ord)::smallint,
       p.created_by
FROM public.performance p
CROSS JOIN LATERAL (VALUES
  (1, 'load_in',    p.load_in_at),
  (2, 'soundcheck', p.soundcheck_at),
  (3, 'start',      p.start_at),
  (4, 'loadout',    p.loadout_at),
  (5, 'wrap',       p.wrap_at)
) AS t(ord, kind, at)
WHERE t.at IS NOT NULL;

-- Comprobación: tantas filas como franjas con hora había. Si no cuadra, la
-- transacción entera revierte antes de que el DROP se lleve los originales.
DO $$
DECLARE
  v_expected bigint;
  v_actual   bigint;
BEGIN
  SELECT count(load_in_at) + count(soundcheck_at) + count(start_at)
       + count(loadout_at) + count(wrap_at)
    INTO v_expected FROM public.performance;
  SELECT count(*) INTO v_actual FROM public.schedule_slot WHERE performance_id IS NOT NULL;
  IF v_expected <> v_actual THEN
    RAISE EXCEPTION 'schedule_slot backfill mismatch: % timeslots, % slots', v_expected, v_actual;
  END IF;
  RAISE NOTICE 'schedule_slot backfill: % slots', v_actual;
END;
$$;

-- ── 5 · las proyecciones públicas leen de schedule_slot ───────────────────
-- Mismo JSON de salida que antes: las cinco claves siguen ahí, derivadas del
-- primer slot de cada kind. El feed ICS y el road sheet público no cambian.
-- CREATE OR REPLACE con la MISMA firma y el mismo tipo de retorno, para
-- conservar los grants a anon que dan vida a los enlaces públicos. Si
-- producción lleva otra sobrecarga que el repo no registra, la comprobación
-- del § 6 la encuentra (nombraría las columnas) y aborta antes del DROP.

-- Las cinco franjas de una función como el jsonb de siempre. Privada: solo la
-- llaman las dos proyecciones públicas, que son SECURITY DEFINER.
CREATE FUNCTION private.performance_timeslots(p_performance_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'load_in_at',    (SELECT s.at FROM public.schedule_slot s WHERE s.performance_id = p_performance_id AND s.kind = 'load_in'    ORDER BY s.sort LIMIT 1),
    'soundcheck_at', (SELECT s.at FROM public.schedule_slot s WHERE s.performance_id = p_performance_id AND s.kind = 'soundcheck' ORDER BY s.sort LIMIT 1),
    'start_at',      (SELECT s.at FROM public.schedule_slot s WHERE s.performance_id = p_performance_id AND s.kind = 'start'      ORDER BY s.sort LIMIT 1),
    'loadout_at',    (SELECT s.at FROM public.schedule_slot s WHERE s.performance_id = p_performance_id AND s.kind = 'loadout'    ORDER BY s.sort LIMIT 1),
    'wrap_at',       (SELECT s.at FROM public.schedule_slot s WHERE s.performance_id = p_performance_id AND s.kind = 'wrap'       ORDER BY s.sort LIMIT 1)
  );
$$;

REVOKE ALL ON FUNCTION private.performance_timeslots(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_calendar(p_token text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_share public.calendar_share;
  v_result jsonb;
BEGIN
  SELECT * INTO v_share
  FROM public.calendar_share
  WHERE token = p_token AND revoked_at IS NULL;
  IF v_share.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- A soft-deleted workspace kills its feeds too.
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace w
    WHERE w.id = v_share.workspace_id AND w.deleted_at IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'workspace', (SELECT jsonb_build_object('name', w.name, 'slug', w.slug, 'timezone', w.timezone)
                  FROM public.workspace w
                  WHERE w.id = v_share.workspace_id AND w.deleted_at IS NULL),
    'performances', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'slug', p.slug, 'performed_at', p.performed_at,
        'status', p.status, 'venue_name', p.venue_name, 'city', p.city,
        'country', p.country,
        'updated_at', p.updated_at,
        'project', (SELECT jsonb_build_object('name', pr.name)
                    FROM public.project pr WHERE pr.id = p.project_id),
        'venue', (SELECT jsonb_build_object(
                    'name', vn.name, 'city', vn.city, 'country', vn.country,
                    'address', vn.address, 'timezone', vn.timezone)
                  FROM public.venue vn WHERE vn.id = p.venue_id AND vn.deleted_at IS NULL)
      ) || private.performance_timeslots(p.id) ORDER BY p.performed_at)
      FROM public.performance p
      WHERE p.workspace_id = v_share.workspace_id
        AND p.deleted_at IS NULL
        AND p.status IN ('confirmed', 'done', 'invoiced', 'paid')), '[]'::jsonb),
    'dates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'kind', d.kind, 'status', d.status, 'title', d.title,
        'starts_at', d.starts_at, 'ends_at', d.ends_at, 'all_day', d.all_day,
        'venue_name', d.venue_name, 'city', d.city, 'updated_at', d.updated_at,
        'project', (SELECT jsonb_build_object('name', pr.name)
                    FROM public.project pr WHERE pr.id = d.project_id)
      ) ORDER BY d.starts_at)
      FROM public.date d
      WHERE d.workspace_id = v_share.workspace_id
        AND d.deleted_at IS NULL
        AND d.status <> 'cancelled'), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_public_calendar(text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.get_public_roadsheet(p_token text) RETURNS jsonb
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_share public.roadsheet_share;
  v_result jsonb;
BEGIN
  SELECT * INTO v_share
  FROM public.roadsheet_share
  WHERE token = p_token AND revoked_at IS NULL;
  IF v_share.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'role', v_share.role,
    'performance', jsonb_build_object(
      'id', p.id, 'slug', p.slug, 'performed_at', p.performed_at,
      'status', p.status, 'venue_name', p.venue_name, 'city', p.city,
      'country', p.country,
      'logistics', p.logistics, 'hospitality', p.hospitality, 'technical', p.technical
    ) || private.performance_timeslots(p.id),
    'project', (SELECT jsonb_build_object('name', pr.name, 'slug', pr.slug)
                FROM public.project pr WHERE pr.id = p.project_id),
    'venue', (SELECT jsonb_build_object(
                'name', vn.name, 'city', vn.city, 'country', vn.country,
                'address', vn.address, 'capacity', vn.capacity,
                'timezone', vn.timezone, 'contacts', vn.contacts)
              FROM public.venue vn WHERE vn.id = p.venue_id AND vn.deleted_at IS NULL),
    'cast', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'role', cm.role,
        'person', jsonb_build_object('full_name', pe.full_name, 'email', pe.email, 'phone', pe.phone)))
      FROM public.cast_member cm
      JOIN public.person pe ON pe.id = cm.person_id
      WHERE cm.project_id = p.project_id AND cm.deleted_at IS NULL), '[]'::jsonb),
    'cast_overrides', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'role', co.role, 'reason', co.reason,
        'person', jsonb_build_object('full_name', pe.full_name, 'email', pe.email, 'phone', pe.phone),
        'replaces', rp.full_name))
      FROM public.cast_override co
      JOIN public.person pe ON pe.id = co.person_id
      LEFT JOIN public.person rp ON rp.id = co.replaces_person_id
      WHERE co.performance_id = p.id AND co.deleted_at IS NULL), '[]'::jsonb),
    'crew', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'role', cr.role, 'notes', cr.notes, 'contact_override', cr.contact_override,
        'person', jsonb_build_object('full_name', pe.full_name, 'email', pe.email, 'phone', pe.phone)))
      FROM public.crew_assignment cr
      JOIN public.person pe ON pe.id = cr.person_id
      WHERE cr.performance_id = p.id AND cr.deleted_at IS NULL), '[]'::jsonb),
    'assets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', av.kind, 'direction', av.direction, 'notes', av.notes, 'uploaded_at', av.uploaded_at))
      FROM public.asset_version av
      WHERE av.performance_id = p.id AND av.deleted_at IS NULL), '[]'::jsonb)
  ) INTO v_result
  FROM public.performance p
  WHERE p.id = v_share.performance_id AND p.deleted_at IS NULL;

  RETURN v_result;
END;
$$;


ALTER FUNCTION public.get_public_roadsheet(text) OWNER TO postgres;


-- ── 6 · el catálogo, antes del DROP ───────────────────────────────────────
-- Una función plpgsql que nombre una columna no la sujeta (no hay dependencia
-- registrada): el DROP pasaría y la función moriría en la primera llamada.
-- Se pregunta al catálogo, en TODOS los esquemas de usuario (también
-- `hour_backup_20260720`), por cualquier cuerpo que nombre una de las cinco.
-- Las dos proyecciones públicas ya no las nombran como columnas; las claves
-- del JSON las pone la función privada de arriba, que por eso se excluye.
DO $$
DECLARE
  v_hits text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_hits
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg_toast%'
    AND p.oid <> 'private.performance_timeslots(uuid)'::regprocedure
    AND p.prosrc ~ '\m(load_in_at|soundcheck_at|start_at|loadout_at|wrap_at)\M';
  IF v_hits IS NOT NULL THEN
    RAISE EXCEPTION 'functions still name the dropped timeslot columns: %', v_hits;
  END IF;
END;
$$;

-- ── 7 · las cinco columnas se van ─────────────────────────────────────────
-- Sin CASCADE: una vista o un objeto que dependa de ellas hace fallar el DROP
-- y revertir la migración entera, que es justo lo que se quiere. Los grants
-- de SELECT por columnas (20260720172431) se van con las columnas.
ALTER TABLE public.performance
  DROP CONSTRAINT performance_timeslots_ordered,
  DROP COLUMN load_in_at,
  DROP COLUMN soundcheck_at,
  DROP COLUMN start_at,
  DROP COLUMN loadout_at,
  DROP COLUMN wrap_at;

COMMENT ON COLUMN public.performance.hold_notice_days IS
  'ADR-079 §2: hold decision notice as lead time. NULL = standard default (30) · 0 = no notice · N = notify N days before the start slot (schedule_slot kind=start, ADR-090). Urgency is derived (start − notice), never stored.';
