-- ADR-089 P1: el viaje es un trayecto. Origen → destino en `date`, y tramos.
--
-- Hasta hoy un viaje era una ciudad y una dirección (`travel_direction`), así
-- que la card solo sabía decir «→ Sevilla». Marco quiere los dos extremos y,
-- cuando haga falta, los tramos del medio (avión → taxi → metro). El modelo lo
-- aprobó el 2026-07-23 y lo confirmó el 2026-09-26.
--
-- LO QUE ESTA MIGRACIÓN HACE, y en qué se aparta de la letra del ADR:
--
--   1. `transport_mode`, el enum de los nueve modos.
--   2. Los extremos en `date`: `origin_*` y `destination_*`. Solo un
--      `travel_day` los lleva, igual que `travel_direction`.
--   3. `travel_stage`, 1:N por viaje, opcional. Postura de `bolo`: RLS forzada,
--      solo SELECT directo, escritura por cuatro RPC.
--   4. `create_date` aprende los extremos.
--
--   El ADR decía extender también `update_date` y `create_date_series`, y
--   ninguna de las dos tiene sentido contra el catálogo de hoy:
--   - `update_date` NO EXISTE. Una fecha se edita por PATCH directo contra
--     `date`, con la policy `date_update` y un GRANT de tabla, así que las
--     columnas nuevas ya son editables sin tocar nada. Lo que falta está en la
--     app (`DatePatchSchema`), que es P2.
--   - `create_date_series` RECHAZA `travel_day` («travel_day cannot be
--     created as a series»). Un viaje nunca nace en tanda, así que darle
--     extremos sería un parámetro que no puede usarse.
--
-- COMPATIBLE CON EL WORKER DESPLEGADO. La app llama a `create_date` por
-- argumentos con nombre, y los cuatro nuevos van al final con DEFAULT NULL:
-- la llamada de hoy resuelve a la función nueva sin cambiar. La base puede ir
-- por delante del Worker.
--
-- DESTRUCTIVA SEGÚN § 34, y por una sola razón: `create_date` cambia de firma,
-- así que hay DROP. Por eso se borra por NOMBRE preguntando al catálogo, no
-- por firma: es la lección del 2026-08-10, cuando un DROP por firma calló ante
-- una sobrecarga que solo tenía producción.

-- ── 1 · los modos ─────────────────────────────────────────────────────────
CREATE TYPE public.transport_mode AS ENUM (
  'plane', 'train', 'bus', 'car', 'taxi', 'metro', 'walk', 'ferry', 'other'
);

COMMENT ON TYPE public.transport_mode IS
  'ADR-089: how a travel stage moves. Basics (plane/train/bus/car), last mile (taxi/metro/walk), sea (ferry), and other.';

-- ── 2 · los extremos del viaje, en date ───────────────────────────────────
ALTER TABLE public.date
  ADD COLUMN origin_city         text,
  ADD COLUMN origin_country      character(2),
  ADD COLUMN destination_city    text,
  ADD COLUMN destination_country character(2);

ALTER TABLE public.date
  ADD CONSTRAINT date_origin_country_format
    CHECK (origin_country IS NULL OR origin_country ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT date_destination_country_format
    CHECK (destination_country IS NULL OR destination_country ~ '^[A-Z]{2}$'),
  -- Solo un viaje tiene extremos, como solo un viaje tiene dirección
  -- (`date_travel_direction`). Un ensayo con origen sería un dato sin sentido.
  ADD CONSTRAINT date_travel_endpoints CHECK (
    kind = 'travel_day'
    OR (origin_city IS NULL AND origin_country IS NULL
        AND destination_city IS NULL AND destination_country IS NULL)
  );

COMMENT ON COLUMN public.date.origin_city IS
  'ADR-089: where a travel day starts. The card reads origin → destination; old rows fall back to city/travel_direction.';
COMMENT ON COLUMN public.date.destination_city IS
  'ADR-089: where a travel day ends. travel_direction stays alongside: it still feeds awayBands() (ADR-078 §6).';

-- ── 3 · travel_stage ──────────────────────────────────────────────────────
CREATE TABLE public.travel_stage (
  id           uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id uuid NOT NULL REFERENCES public.workspace(id) ON DELETE CASCADE,
  -- Heredado del viaje, y guardado aquí para que la policy no tenga que
  -- cruzar `date` para saber de qué proyecto es.
  project_id   uuid NOT NULL REFERENCES public.project(id) ON DELETE CASCADE,
  date_id      uuid NOT NULL REFERENCES public.date(id) ON DELETE CASCADE,
  position     integer NOT NULL,
  mode         public.transport_mode NOT NULL DEFAULT 'other',
  from_city    text,
  from_country character(2),
  -- Aeropuerto, estación, hotel: el sitio concreto dentro de la ciudad.
  from_place   text,
  to_city      text,
  to_country   character(2),
  to_place     text,
  depart_at    timestamptz,
  arrive_at    timestamptz,
  -- Localizador, número de vuelo, matrícula.
  reference    text,
  notes        text,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT travel_stage_position_positive CHECK (position >= 1),
  CONSTRAINT travel_stage_from_country_format
    CHECK (from_country IS NULL OR from_country ~ '^[A-Z]{2}$'),
  CONSTRAINT travel_stage_to_country_format
    CHECK (to_country IS NULL OR to_country ~ '^[A-Z]{2}$'),
  CONSTRAINT travel_stage_time_range
    CHECK (depart_at IS NULL OR arrive_at IS NULL OR arrive_at >= depart_at),
  -- Un orden sin empates. DIFERIDA porque reordenar reescribe todas las
  -- posiciones en una sentencia y en medio dos filas pueden coincidir.
  CONSTRAINT travel_stage_date_position_key
    UNIQUE (date_id, position) DEFERRABLE INITIALLY DEFERRED
);

COMMENT ON TABLE public.travel_stage IS
  'ADR-089: one leg of a travel day (plane → taxi → metro). Optional: a trip can be just origin → destination. Written only through create/update/delete/reorder_travel_stage(s).';

CREATE INDEX travel_stage_workspace_id_idx ON public.travel_stage (workspace_id);
CREATE INDEX travel_stage_project_id_idx   ON public.travel_stage (project_id);
CREATE INDEX travel_stage_created_by_idx   ON public.travel_stage (created_by) WHERE created_by IS NOT NULL;

ALTER TABLE public.travel_stage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.travel_stage FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.travel_stage FROM PUBLIC, anon, service_role;

-- Se lee con el permiso con que se lee el viaje, y desaparece con él: un
-- viaje borrado (`date.deleted_at`) no deja tramos visibles.
CREATE POLICY travel_stage_select ON public.travel_stage
  FOR SELECT TO authenticated
  USING (
    public.has_permission(project_id, 'read:performance')
    AND EXISTS (
      SELECT 1 FROM public.date d
      WHERE d.id = travel_stage.date_id AND d.deleted_at IS NULL
    )
  );

GRANT SELECT ON TABLE public.travel_stage TO authenticated;

CREATE TRIGGER travel_stage_set_updated_at
BEFORE UPDATE ON public.travel_stage
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER travel_stage_audit
AFTER INSERT OR DELETE OR UPDATE ON public.travel_stage
FOR EACH ROW EXECUTE FUNCTION public.write_audit();

-- ── 3b · las cuatro puertas de escritura ──────────────────────────────────
-- Todas con la misma forma: «no existe» y «no es tuyo» dan el mismo 42501,
-- para no ser un oráculo de existencia; la puerta es `edit:performance`
-- sobre el proyecto del viaje.

-- create_travel_stage: añade un tramo AL FINAL del viaje.
CREATE FUNCTION public.create_travel_stage(
  p_date_id      uuid,
  p_mode         public.transport_mode DEFAULT 'other',
  p_from_city    text DEFAULT NULL,
  p_from_country text DEFAULT NULL,
  p_from_place   text DEFAULT NULL,
  p_to_city      text DEFAULT NULL,
  p_to_country   text DEFAULT NULL,
  p_to_place     text DEFAULT NULL,
  p_depart_at    timestamptz DEFAULT NULL,
  p_arrive_at    timestamptz DEFAULT NULL,
  p_reference    text DEFAULT NULL,
  p_notes        text DEFAULT NULL
) RETURNS public.travel_stage
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_date     public.date;
  v_position integer;
  v_row      public.travel_stage;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE: dos altas a la vez en el mismo viaje se ponen en fila, en vez
  -- de calcular la misma posición y chocar contra la UNIQUE al confirmar.
  SELECT * INTO v_date
  FROM public.date WHERE id = p_date_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_date.id IS NULL OR NOT public.has_permission(v_date.project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'date % not found', p_date_id USING ERRCODE = '42501';
  END IF;

  IF v_date.kind <> 'travel_day' THEN
    RAISE EXCEPTION 'only a travel_day has stages' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(max(position), 0) + 1 INTO v_position
  FROM public.travel_stage WHERE date_id = p_date_id;

  INSERT INTO public.travel_stage (
    workspace_id, project_id, date_id, position, mode,
    from_city, from_country, from_place,
    to_city, to_country, to_place,
    depart_at, arrive_at, reference, notes, created_by
  ) VALUES (
    v_date.workspace_id, v_date.project_id, p_date_id, v_position,
    coalesce(p_mode, 'other'),
    nullif(btrim(coalesce(p_from_city, '')), ''),
    nullif(upper(btrim(coalesce(p_from_country, ''))), ''),
    nullif(btrim(coalesce(p_from_place, '')), ''),
    nullif(btrim(coalesce(p_to_city, '')), ''),
    nullif(upper(btrim(coalesce(p_to_country, ''))), ''),
    nullif(btrim(coalesce(p_to_place, '')), ''),
    p_depart_at, p_arrive_at,
    nullif(btrim(coalesce(p_reference, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_caller
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- update_travel_stage: SUSTITUYE los campos del tramo. Lo que llega NULL se
-- borra: el editor manda el tramo entero, y un parcial aquí obligaría a
-- distinguir «no lo toques» de «vacíalo». La posición no se toca aquí; para
-- eso está reorder_travel_stages.
CREATE FUNCTION public.update_travel_stage(
  p_stage_id     uuid,
  p_mode         public.transport_mode,
  p_from_city    text DEFAULT NULL,
  p_from_country text DEFAULT NULL,
  p_from_place   text DEFAULT NULL,
  p_to_city      text DEFAULT NULL,
  p_to_country   text DEFAULT NULL,
  p_to_place     text DEFAULT NULL,
  p_depart_at    timestamptz DEFAULT NULL,
  p_arrive_at    timestamptz DEFAULT NULL,
  p_reference    text DEFAULT NULL,
  p_notes        text DEFAULT NULL
) RETURNS public.travel_stage
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_project_id uuid;
  v_row        public.travel_stage;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT s.project_id INTO v_project_id
  FROM public.travel_stage s
  JOIN public.date d ON d.id = s.date_id AND d.deleted_at IS NULL
  WHERE s.id = p_stage_id;

  IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'stage % not found', p_stage_id USING ERRCODE = '42501';
  END IF;

  UPDATE public.travel_stage SET
    mode         = coalesce(p_mode, 'other'),
    from_city    = nullif(btrim(coalesce(p_from_city, '')), ''),
    from_country = nullif(upper(btrim(coalesce(p_from_country, ''))), ''),
    from_place   = nullif(btrim(coalesce(p_from_place, '')), ''),
    to_city      = nullif(btrim(coalesce(p_to_city, '')), ''),
    to_country   = nullif(upper(btrim(coalesce(p_to_country, ''))), ''),
    to_place     = nullif(btrim(coalesce(p_to_place, '')), ''),
    depart_at    = p_depart_at,
    arrive_at    = p_arrive_at,
    reference    = nullif(btrim(coalesce(p_reference, '')), ''),
    notes        = nullif(btrim(coalesce(p_notes, '')), '')
  WHERE id = p_stage_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- delete_travel_stage: borra el tramo de verdad (el audit_log guarda la fila)
-- y cierra el hueco, para que las posiciones sigan siendo 1..N.
CREATE FUNCTION public.delete_travel_stage(p_stage_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_project_id uuid;
  v_date_id    uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT s.project_id, s.date_id INTO v_project_id, v_date_id
  FROM public.travel_stage s
  JOIN public.date d ON d.id = s.date_id AND d.deleted_at IS NULL
  WHERE s.id = p_stage_id;

  IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'stage % not found', p_stage_id USING ERRCODE = '42501';
  END IF;

  -- La misma fila que usa create_travel_stage para ponerse en fila.
  PERFORM 1 FROM public.date WHERE id = v_date_id FOR UPDATE;

  DELETE FROM public.travel_stage WHERE id = p_stage_id;

  UPDATE public.travel_stage s
  SET position = r.rn
  FROM (
    SELECT id, row_number() OVER (ORDER BY position) AS rn
    FROM public.travel_stage WHERE date_id = v_date_id
  ) r
  WHERE s.id = r.id AND s.position <> r.rn;
END;
$$;

-- reorder_travel_stages: el orden entero de un viaje, de una vez. La lista
-- tiene que ser EXACTAMENTE los tramos del viaje: ni uno de más, ni uno de
-- menos, ni repetidos. Un reorden parcial dejaría el orden a medio decir.
CREATE FUNCTION public.reorder_travel_stages(p_date_id uuid, p_stage_ids uuid[])
RETURNS SETOF public.travel_stage
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_date public.date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_date
  FROM public.date WHERE id = p_date_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_date.id IS NULL OR NOT public.has_permission(v_date.project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'date % not found', p_date_id USING ERRCODE = '42501';
  END IF;

  IF p_stage_ids IS NULL
    OR coalesce(array_length(p_stage_ids, 1), 0)
       <> (SELECT count(DISTINCT x) FROM unnest(p_stage_ids) x)
    OR (SELECT count(*) FROM public.travel_stage WHERE date_id = p_date_id)
       <> coalesce(array_length(p_stage_ids, 1), 0)
    OR EXISTS (
      SELECT 1 FROM unnest(p_stage_ids) x
      WHERE NOT EXISTS (
        SELECT 1 FROM public.travel_stage s WHERE s.id = x AND s.date_id = p_date_id
      )
    )
  THEN
    RAISE EXCEPTION 'stage ids must be exactly the stages of this travel day'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.travel_stage s
  SET position = o.ord
  FROM unnest(p_stage_ids) WITH ORDINALITY AS o(id, ord)
  WHERE s.id = o.id AND s.position <> o.ord;

  RETURN QUERY
  SELECT * FROM public.travel_stage WHERE date_id = p_date_id ORDER BY position;
END;
$$;

REVOKE ALL ON FUNCTION public.create_travel_stage(
  uuid, public.transport_mode, text, text, text, text, text, text,
  timestamptz, timestamptz, text, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_travel_stage(
  uuid, public.transport_mode, text, text, text, text, text, text,
  timestamptz, timestamptz, text, text
) TO authenticated;

REVOKE ALL ON FUNCTION public.update_travel_stage(
  uuid, public.transport_mode, text, text, text, text, text, text,
  timestamptz, timestamptz, text, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_travel_stage(
  uuid, public.transport_mode, text, text, text, text, text, text,
  timestamptz, timestamptz, text, text
) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_travel_stage(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_travel_stage(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.reorder_travel_stages(uuid, uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reorder_travel_stages(uuid, uuid[]) TO authenticated;

-- ── 4 · create_date aprende los extremos ──────────────────────────────────
-- POR NOMBRE, NO POR FIRMA (ver la cabecera y 20260731120000). Si producción
-- lleva una sobrecarga que el checkpoint no registra, se va con las demás, y
-- queda exactamente una: la de abajo.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT oid::regprocedure::text AS signature
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname = 'create_date'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', fn.signature);
  END LOOP;
END;
$$;

CREATE FUNCTION public.create_date(
  p_project_id          uuid,
  p_kind                public.date_kind,
  p_starts_at           timestamptz,
  p_ends_at             timestamptz DEFAULT NULL,
  p_all_day             boolean DEFAULT false,
  p_title               text DEFAULT NULL,
  p_venue_name          text DEFAULT NULL,
  p_city                text DEFAULT NULL,
  p_country             text DEFAULT NULL,
  p_status              public.date_status DEFAULT 'tentative',
  p_performance_id      uuid DEFAULT NULL,
  p_line_id             uuid DEFAULT NULL,
  p_travel_direction    text DEFAULT NULL,
  p_label               text DEFAULT NULL,
  p_origin_city         text DEFAULT NULL,
  p_origin_country      text DEFAULT NULL,
  p_destination_city    text DEFAULT NULL,
  p_destination_country text DEFAULT NULL
) RETURNS public.date
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_label        text := nullif(btrim(coalesce(p_label, '')), '');
  v_origin_city  text := nullif(btrim(coalesce(p_origin_city, '')), '');
  v_origin_cc    text := nullif(upper(btrim(coalesce(p_origin_country, ''))), '');
  v_dest_city    text := nullif(btrim(coalesce(p_destination_city, '')), '');
  v_dest_cc      text := nullif(upper(btrim(coalesce(p_destination_country, ''))), '');
  v_row          public.date;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_starts_at IS NULL THEN
    RAISE EXCEPTION 'starts_at cannot be null' USING ERRCODE = '22023';
  END IF;

  -- §9: the enum of 4 is never exposed at creation.
  IF p_status IS NULL OR p_status NOT IN ('tentative', 'confirmed') THEN
    RAISE EXCEPTION 'status must be tentative or confirmed on create'
      USING ERRCODE = '22023';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.project
  WHERE id = p_project_id AND deleted_at IS NULL;

  IF v_workspace_id IS NULL THEN
    -- Not-found and no-membership collapse (no existence oracle).
    RAISE EXCEPTION 'project % not found', p_project_id
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_permission(p_project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'edit:performance required to create a date'
      USING ERRCODE = '42501';
  END IF;

  -- Cascade coherence (ADR-043 pattern).
  IF p_line_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.line
    WHERE id = p_line_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'line does not belong to project' USING ERRCODE = '22023';
  END IF;

  IF p_performance_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.performance
    WHERE id = p_performance_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'performance does not belong to project' USING ERRCODE = '22023';
  END IF;

  -- Travel axis: only travel days carry a direction.
  IF p_travel_direction IS NOT NULL THEN
    IF p_kind <> 'travel_day'
      OR p_travel_direction NOT IN ('outbound', 'return', 'leg') THEN
      RAISE EXCEPTION 'travel_direction requires kind=travel_day and one of outbound/return/leg'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ADR-089: only travel days carry endpoints (date_travel_endpoints says the
  -- same; this says it with a readable error).
  IF (v_origin_city IS NOT NULL OR v_origin_cc IS NOT NULL
      OR v_dest_city IS NOT NULL OR v_dest_cc IS NOT NULL)
     AND p_kind <> 'travel_day' THEN
    RAISE EXCEPTION 'origin/destination require kind=travel_day' USING ERRCODE = '22023';
  END IF;

  -- §8: label is the Altres axis — only kind='other' rows carry one.
  IF v_label IS NOT NULL AND p_kind <> 'other' THEN
    RAISE EXCEPTION 'label is only accepted for kind=other' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.date (
    workspace_id, project_id, line_id, performance_id,
    kind, status, title, starts_at, ends_at, all_day,
    venue_name, city, country, travel_direction,
    origin_city, origin_country, destination_city, destination_country,
    custom_fields, created_by
  ) VALUES (
    v_workspace_id, p_project_id, p_line_id, p_performance_id,
    p_kind, p_status,
    nullif(btrim(coalesce(p_title, '')), ''),
    p_starts_at, p_ends_at, coalesce(p_all_day, false),
    nullif(btrim(coalesce(p_venue_name, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(upper(btrim(coalesce(p_country, ''))), ''),
    p_travel_direction,
    v_origin_city, v_origin_cc, v_dest_city, v_dest_cc,
    CASE WHEN v_label IS NULL THEN '{}'::jsonb
         ELSE jsonb_build_object('label', v_label) END,
    v_caller
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_date(
  uuid, public.date_kind, timestamptz, timestamptz, boolean, text, text, text,
  text, public.date_status, uuid, uuid, text, text, text, text, text, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_date(
  uuid, public.date_kind, timestamptz, timestamptz, boolean, text, text, text,
  text, public.date_status, uuid, uuid, text, text, text, text, text, text
) TO authenticated;
