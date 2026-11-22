-- ADR-242 · Fase 1: el viaje se ata a su bolo (esquema, guarda y lectura de viajes por función).
--
-- Encargo «el viaje se ata a su bolo» (Marco, 2026-11-22):
--   1. `public.date.bolo_id` (uuid NULL REFERENCES public.bolo(id) ON DELETE SET NULL),
--      CHECK `date_bolo_travel_only` (solo `kind = 'travel_day'`) e índice parcial
--      `date_bolo_idx` (`deleted_at IS NULL AND bolo_id IS NOT NULL`).
--   2. Guarda en Postgres (`private.guard_date_bolo_same_project`, trigger
--      `date_guard_bolo` BEFORE INSERT OR UPDATE OF bolo_id, project_id): el bolo
--      debe estar vivo, pertenecer al mismo proyecto y ser visible para quien escribe
--      (`read:money` cuando hay `auth.uid()`). Un único 42501 para «no existe»,
--      «otro proyecto» y «sin permiso» (sin oráculo de existencia).
--   3. `public.create_date` añade `p_bolo_id uuid DEFAULT NULL` al final de la firma.
--      DROP por nombre consultando `pg_proc` para no dejar sobrecargas (PostgREST 300).
--      Compatible con el Worker desplegado (llama por nombre sin `p_bolo_id`).
--   4. `public.delete_bolo(uuid)`: desata `public.date.bolo_id = NULL` antes del
--      borrado blando (ON DELETE SET NULL no dispara con soft-delete).
--   5. Relleno mínimo: los viajes vivos con `performance_id` cuya función viva apunta
--      a un bolo vivo del mismo proyecto copian ese `bolo_id`. Nada más se rellena.
--   6. Una sola regla compartida en Postgres (`private.performance_trips_jsonb`):
--      viajes de una función = atados a su bolo U atados a su línea sin bolo U
--      (solo si no hay ninguno atado) sugeridos por día y víspera sin `bolo_id`.
--      - `public.trips_for_performance(uuid)`: lectura autenticada para el pase y la
--        hoja interna; funciona para todo el equipo con `read:performance` (sin abrir
--        `read:money` ni exponer `bolo_id`) y para invitados de bolo (solo los atados
--        a su bolo).
--      - `public.get_public_roadsheet(text)`: actualizada con `CREATE OR REPLACE` a
--        la misma regla, solo para `performer` y `tech_manager`, nunca `venue`, nunca
--        `travel_stage.notes`.
--
-- Puerta § 34: DESTRUCTIVA por una sola razón: `create_date` cambia de firma y
-- requiere DROP antes de CREATE (mismo patrón que `20260926100000_travel_stages.sql`).
-- Requiere backup, prueba en staging, plan y apply por `production-migrate.yml`.
-- Rollback escrito y probado en local: `build/runbooks/rollback-20261122-date-bolo-link.sql`.

-- ── 1 · Columna, CHECK e índice parcial en public.date ───────────────────────

ALTER TABLE public.date
  ADD COLUMN bolo_id uuid REFERENCES public.bolo(id) ON DELETE SET NULL,
  ADD CONSTRAINT date_bolo_travel_only CHECK (bolo_id IS NULL OR kind = 'travel_day');

CREATE INDEX date_bolo_idx
  ON public.date (bolo_id)
  WHERE deleted_at IS NULL AND bolo_id IS NOT NULL;

COMMENT ON COLUMN public.date.bolo_id IS
  'ADR-242: bolo al que sirve este viaje (solo kind = travel_day). Un bolo con varias funciones comparte ida y vuelta; un viaje de gira que sirve a varios bolos usa line_id.';

-- ── 2 · Guarda de proyecto y permiso de bolo en public.date ──────────────────

CREATE OR REPLACE FUNCTION private.guard_date_bolo_same_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bolo_project uuid;
  v_caller       uuid := auth.uid();
BEGIN
  IF NEW.bolo_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Si el enlace y el proyecto no han cambiado en un UPDATE, no bloquear ediciones
  -- de otros campos por quien tiene edit:performance sin read:money.
  IF TG_OP = 'UPDATE'
     AND NEW.bolo_id IS NOT DISTINCT FROM OLD.bolo_id
     AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN
    RETURN NEW;
  END IF;

  SELECT b.project_id INTO v_bolo_project
    FROM public.bolo b
   WHERE b.id = NEW.bolo_id
     AND b.deleted_at IS NULL;

  IF v_bolo_project IS NULL
     OR v_bolo_project IS DISTINCT FROM NEW.project_id
     OR (v_caller IS NOT NULL AND NOT public.has_permission(NEW.project_id, 'read:money')) THEN
    RAISE EXCEPTION 'bolo_id must reference a readable live bolo of the same project'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION private.guard_date_bolo_same_project() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.guard_date_bolo_same_project() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.guard_date_bolo_same_project() IS
  'ADR-242: un viaje solo puede colgar de un bolo vivo de su proyecto que el llamante pueda leer (read:money). Un único 42501 evita oráculos de existencia.';

DROP TRIGGER IF EXISTS date_guard_bolo ON public.date;
CREATE TRIGGER date_guard_bolo
  BEFORE INSERT OR UPDATE OF bolo_id, project_id ON public.date
  FOR EACH ROW EXECUTE FUNCTION private.guard_date_bolo_same_project();

-- ── 3 · create_date gana p_bolo_id al final (DEFAULT NULL) ───────────────────
-- DROP por nombre consultando pg_proc para no dejar sobrecargas (ADR-097).

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
  p_destination_country text DEFAULT NULL,
  p_bolo_id             uuid DEFAULT NULL
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
    RAISE EXCEPTION 'auth.uid() is null: RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_starts_at IS NULL THEN
    RAISE EXCEPTION 'starts_at cannot be null' USING ERRCODE = '22023';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('tentative', 'confirmed') THEN
    RAISE EXCEPTION 'status must be tentative or confirmed on create'
      USING ERRCODE = '22023';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.project
  WHERE id = p_project_id AND deleted_at IS NULL;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'project % not found', p_project_id
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_permission(p_project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'edit:performance required to create a date'
      USING ERRCODE = '42501';
  END IF;

  -- Coherencia de cascada (patrón ADR-043).
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

  -- ADR-242: solo viajes se atan a un bolo, y solo si el llamante ve ese bolo.
  IF p_bolo_id IS NOT NULL THEN
    IF p_kind <> 'travel_day' THEN
      RAISE EXCEPTION 'bolo_id requires kind=travel_day' USING ERRCODE = '22023';
    END IF;
    IF NOT public.has_permission(p_project_id, 'read:money') OR NOT EXISTS (
      SELECT 1 FROM public.bolo
      WHERE id = p_bolo_id AND project_id = p_project_id AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'bolo_id must reference a readable live bolo of the same project'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_travel_direction IS NOT NULL THEN
    IF p_kind <> 'travel_day'
      OR p_travel_direction NOT IN ('outbound', 'return', 'leg') THEN
      RAISE EXCEPTION 'travel_direction requires kind=travel_day and one of outbound/return/leg'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF (v_origin_city IS NOT NULL OR v_origin_cc IS NOT NULL
      OR v_dest_city IS NOT NULL OR v_dest_cc IS NOT NULL)
     AND p_kind <> 'travel_day' THEN
    RAISE EXCEPTION 'origin/destination require kind=travel_day' USING ERRCODE = '22023';
  END IF;

  IF v_label IS NOT NULL AND p_kind <> 'other' THEN
    RAISE EXCEPTION 'label is only accepted for kind=other' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.date (
    workspace_id, project_id, line_id, performance_id, bolo_id,
    kind, status, title, starts_at, ends_at, all_day,
    venue_name, city, country, travel_direction,
    origin_city, origin_country, destination_city, destination_country,
    custom_fields, created_by
  ) VALUES (
    v_workspace_id, p_project_id, p_line_id, p_performance_id, p_bolo_id,
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

ALTER FUNCTION public.create_date(
  uuid, public.date_kind, timestamptz, timestamptz, boolean, text, text, text,
  text, public.date_status, uuid, uuid, text, text, text, text, text, text, uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_date(
  uuid, public.date_kind, timestamptz, timestamptz, boolean, text, text, text,
  text, public.date_status, uuid, uuid, text, text, text, text, text, text, uuid
) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.create_date(
  uuid, public.date_kind, timestamptz, timestamptz, boolean, text, text, text,
  text, public.date_status, uuid, uuid, text, text, text, text, text, text, uuid
) TO authenticated;

COMMENT ON FUNCTION public.create_date(
  uuid, public.date_kind, timestamptz, timestamptz, boolean, text, text, text,
  text, public.date_status, uuid, uuid, text, text, text, text, text, text, uuid
) IS 'Crea una fecha (ADR-078, ADR-089, ADR-242). Exige edit:performance; p_bolo_id solo en travel_day y con read:money en el mismo proyecto.';

-- ── 4 · delete_bolo desata los viajes del bolo antes del borrado blando ──────

CREATE OR REPLACE FUNCTION public.delete_bolo(p_bolo_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller     uuid := auth.uid();
  v_project_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT project_id INTO v_project_id
  FROM public.bolo WHERE id = p_bolo_id AND deleted_at IS NULL;

  IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:money') THEN
    RAISE EXCEPTION 'bolo % not found', p_bolo_id USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_line il
    JOIN public.invoice i ON i.id = il.invoice_id
    WHERE il.bolo_id = p_bolo_id
      AND i.deleted_at IS NULL
      AND i.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'bolo has invoices: discard or cancel them first'
      USING ERRCODE = '23503';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment
    WHERE bolo_id = p_bolo_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'bolo has recorded payments: remove them first'
      USING ERRCODE = '23503';
  END IF;

  -- ADR-242: ON DELETE SET NULL no se dispara en borrado blando; desatamos aquí.
  UPDATE public.date
     SET bolo_id = NULL
   WHERE bolo_id = p_bolo_id
     AND deleted_at IS NULL;

  UPDATE public.bolo SET deleted_at = now() WHERE id = p_bolo_id;
END;
$function$;

ALTER FUNCTION public.delete_bolo(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_bolo(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_bolo(uuid) TO authenticated;

-- ── 5 · Relleno mínimo: viajes con performance_id cuya función tiene bolo ────

UPDATE public.date d
   SET bolo_id = p.bolo_id
  FROM public.performance p
  JOIN public.bolo b ON b.id = p.bolo_id AND b.deleted_at IS NULL
 WHERE d.kind = 'travel_day'
   AND d.deleted_at IS NULL
   AND d.bolo_id IS NULL
   AND d.performance_id = p.id
   AND p.deleted_at IS NULL
   AND p.project_id = d.project_id
   AND p.project_id = b.project_id;

-- ── 6 · Regla única de viajes de una función (pase, hoja interna y pública) ──

CREATE OR REPLACE FUNCTION private.performance_trips_jsonb(
  p_performance_id uuid,
  p_include_meta   boolean DEFAULT false,
  p_bolo_only      boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_perf         public.performance;
  v_live_bolo_id uuid;
  v_perf_tz      text;
  v_result       jsonb;
BEGIN
  SELECT * INTO v_perf
    FROM public.performance p
   WHERE p.id = p_performance_id
     AND p.deleted_at IS NULL;

  IF v_perf.id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF v_perf.bolo_id IS NOT NULL THEN
    SELECT b.id INTO v_live_bolo_id
      FROM public.bolo b
     WHERE b.id = v_perf.bolo_id
       AND b.deleted_at IS NULL;
  END IF;

  SELECT nullif(pv.timezone, '') INTO v_perf_tz
    FROM public.venue pv
   WHERE pv.id = v_perf.venue_id
     AND pv.deleted_at IS NULL;

  WITH bound AS (
    SELECT
      d.*,
      CASE
        WHEN v_live_bolo_id IS NOT NULL AND d.bolo_id = v_live_bolo_id THEN 'bolo'
        ELSE 'line'
      END AS link_source
    FROM public.date d
    WHERE d.project_id = v_perf.project_id
      AND d.kind = 'travel_day'
      AND d.status <> 'cancelled'
      AND d.deleted_at IS NULL
      AND (
        (v_live_bolo_id IS NOT NULL AND d.bolo_id = v_live_bolo_id)
        OR (
          NOT p_bolo_only
          AND v_perf.line_id IS NOT NULL
          AND d.line_id = v_perf.line_id
          AND d.bolo_id IS NULL
        )
      )
  ),
  suggested AS (
    SELECT
      d.*,
      'suggested'::text AS link_source
    FROM public.date d
    LEFT JOIN public.venue tv ON tv.id = d.venue_id AND tv.deleted_at IS NULL
    CROSS JOIN LATERAL (
      SELECT coalesce(nullif(tv.timezone, ''), v_perf_tz, 'UTC') AS tz
    ) z
    CROSS JOIN LATERAL (
      SELECT
        CASE WHEN d.all_day THEN (d.starts_at AT TIME ZONE 'UTC')::date
             ELSE (d.starts_at AT TIME ZONE z.tz)::date END AS first_day,
        CASE WHEN d.ends_at IS NULL THEN NULL
             WHEN d.all_day THEN (d.ends_at AT TIME ZONE 'UTC')::date
             ELSE (d.ends_at AT TIME ZONE z.tz)::date END AS end_day
    ) k
    WHERE NOT p_bolo_only
      AND NOT EXISTS (SELECT 1 FROM bound)
      AND d.project_id = v_perf.project_id
      AND d.kind = 'travel_day'
      AND d.status <> 'cancelled'
      AND d.deleted_at IS NULL
      AND d.bolo_id IS NULL
      AND k.first_day <= v_perf.performed_at
      AND greatest(k.first_day, coalesce(k.end_day, k.first_day)) >= v_perf.performed_at - 1
  ),
  picked AS (
    SELECT * FROM bound
    UNION ALL
    SELECT * FROM suggested
  )
  SELECT COALESCE(
    jsonb_agg(
      (
        jsonb_build_object(
          'id', d.id,
          'title', d.title,
          'starts_at', d.starts_at,
          'ends_at', d.ends_at,
          'all_day', d.all_day,
          'travel_direction', d.travel_direction,
          'origin_city', d.origin_city,
          'destination_city', d.destination_city,
          'tz', (SELECT nullif(tv.timezone, '') FROM public.venue tv WHERE tv.id = d.venue_id AND tv.deleted_at IS NULL),
          'stages', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'mode', ts.mode, 'from_city', ts.from_city, 'from_place', ts.from_place,
              'to_city', ts.to_city, 'to_place', ts.to_place,
              'depart_at', ts.depart_at, 'arrive_at', ts.arrive_at,
              'depart_tz', ts.depart_tz, 'arrive_tz', ts.arrive_tz,
              'reference', ts.reference)
              ORDER BY ts.depart_at, ts.position)
            FROM public.travel_stage ts
            WHERE ts.date_id = d.id AND ts.depart_at IS NOT NULL), '[]'::jsonb),
          'going', COALESCE((
            SELECT jsonb_agg(wp.full_name ORDER BY wp.full_name)
            FROM public.commitment_person c
            JOIN public.workspace_person wp
              ON wp.workspace_id = d.workspace_id AND wp.person_id = c.person_id
             AND wp.deleted_at IS NULL
            WHERE c.date_id = d.id AND c.state = 'going'
              AND nullif(btrim(wp.full_name), '') IS NOT NULL), '[]'::jsonb)
        )
        || CASE WHEN p_include_meta THEN jsonb_build_object(
             'status', d.status,
             'link_source', d.link_source
           ) ELSE '{}'::jsonb END
      )
      ORDER BY d.starts_at, d.id
    ),
    '[]'::jsonb
  ) INTO v_result
  FROM picked d;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION private.performance_trips_jsonb(uuid, boolean, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.performance_trips_jsonb(uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.performance_trips_jsonb(uuid, boolean, boolean) IS
  'ADR-242: regla única de viajes de una función (atados al bolo U atados a la línea sin bolo U sugeridos por día y víspera si no hay ninguno atado). Nunca devuelve bolo_id ni travel_stage.notes.';

CREATE FUNCTION public.trips_for_performance(p_performance_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_project_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT p.project_id INTO v_project_id
    FROM public.performance p
   WHERE p.id = p_performance_id
     AND p.deleted_at IS NULL;

  IF v_project_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF public.has_permission(v_project_id, 'read:performance') THEN
    RETURN private.performance_trips_jsonb(p_performance_id, true, false);
  END IF;

  IF private.performance_readable_through_chain_by_caller(p_performance_id) THEN
    RETURN private.performance_trips_jsonb(p_performance_id, true, true);
  END IF;

  RETURN '[]'::jsonb;
END;
$function$;

ALTER FUNCTION public.trips_for_performance(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.trips_for_performance(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.trips_for_performance(uuid) TO authenticated;

COMMENT ON FUNCTION public.trips_for_performance(uuid) IS
  'ADR-242: devuelve los viajes de una función cruzando performance.bolo_id en Postgres sin abrir read:money ni exponer bolo_id. Con read:performance devuelve bolo U línea U sugeridos; para invitados de bolo por cadena, solo los atados al bolo.';

-- ── 7 · get_public_roadsheet usa la misma regla (solo performer y tech_manager)

CREATE OR REPLACE FUNCTION public.get_public_roadsheet(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_share public.roadsheet_share;
  v_result jsonb;
  -- 120 · la matriz de ADR-041 (`ROLE_SECTIONS`, `PERSONAL_CONTACTS` en
  -- $lib/roadsheet), ya aquí: lo que el rol no ve no sale de la base.
  v_contacts boolean;
  -- 121 B (ADR-183): la zona del día y si la persona del enlace sigue en la función.
  v_tz text;
  v_person_role text;
BEGIN
  SELECT * INTO v_share
  FROM public.roadsheet_share
  WHERE token = p_token AND revoked_at IS NULL
    -- ADR-163 § 2: un enlace caducado no devuelve nada, como uno revocado.
    AND expires_at > now();
  IF v_share.id IS NULL THEN
    RETURN NULL;
  END IF;
  -- Un enlace personal vale lo que la persona en la función hoy: si ya no está,
  -- nada (como un token inválido); si está, su papel de hoy, no el guardado.
  IF v_share.person_id IS NOT NULL THEN
    v_person_role := private.roadsheet_person_role(v_share.performance_id, v_share.person_id);
    IF v_person_role IS NULL THEN
      RETURN NULL;
    END IF;
    v_share.role := v_person_role;
  END IF;
  v_contacts := v_share.role = 'tech_manager';
  v_tz := private.performance_timezone(v_share.performance_id);

  SELECT jsonb_build_object(
    'role', v_share.role,
    'performance', jsonb_build_object(
      'id', p.id, 'slug', p.slug, 'performed_at', p.performed_at,
      'status', p.status, 'venue_name', p.venue_name, 'city', p.city,
      'country', p.country,
      -- 226 (ADR-226): la nota para quien recibe la hoja, en todos los roles.
      'shared_note', p.shared_note,
      'logistics', CASE WHEN v_share.role IN ('performer', 'tech_manager')
                        THEN p.logistics ELSE '{}'::jsonb END,
      'hospitality', CASE WHEN v_share.role = 'performer'
                          THEN p.hospitality ELSE '{}'::jsonb END,
      'technical', CASE WHEN v_share.role IN ('venue', 'tech_manager')
                        THEN p.technical ELSE '{}'::jsonb END
    ) || private.performance_timeslots(p.id)
      -- ADR-090 P3: la escaleta ENTERA, en su orden, momentos libres incluidos.
      -- Misma forma que el bundle interno (`ScheduleMoment`): sin `notes`,
      -- que esta proyección pública no ha llevado nunca.
      || jsonb_build_object('schedule', COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'kind', s.kind, 'label', s.label, 'at', s.at, 'ends_at', s.ends_at)
             ORDER BY s.sort)
           FROM public.schedule_slot s
           WHERE s.performance_id = p.id), '[]'::jsonb)),
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
        'person', jsonb_build_object('full_name', pe.full_name,
                    'email', CASE WHEN v_contacts THEN pe.email END,
                    'phone', CASE WHEN v_contacts THEN pe.phone END)))
      FROM public.cast_member cm
      JOIN public.person pe ON pe.id = cm.person_id
      WHERE cm.project_id = p.project_id AND cm.deleted_at IS NULL), '[]'::jsonb),
    'cast_overrides', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'role', co.role, 'reason', co.reason,
        'person', jsonb_build_object('full_name', pe.full_name,
                    'email', CASE WHEN v_contacts THEN pe.email END,
                    'phone', CASE WHEN v_contacts THEN pe.phone END),
        'replaces', rp.full_name))
      FROM public.cast_override co
      JOIN public.person pe ON pe.id = co.person_id
      LEFT JOIN public.person rp ON rp.id = co.replaces_person_id
      WHERE co.performance_id = p.id AND co.deleted_at IS NULL), '[]'::jsonb),
    'crew', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'role', cr.role,
        'notes', CASE WHEN v_contacts THEN cr.notes END,
        'contact_override', CASE WHEN v_contacts THEN cr.contact_override END,
        'person', jsonb_build_object('full_name', pe.full_name,
                    'email', CASE WHEN v_contacts THEN pe.email END,
                    'phone', CASE WHEN v_contacts THEN pe.phone END)))
      FROM public.crew_assignment cr
      JOIN public.person pe ON pe.id = cr.person_id
      WHERE cr.performance_id = p.id AND cr.deleted_at IS NULL), '[]'::jsonb),
    'assets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', av.kind, 'direction', av.direction, 'notes', NULL::text, 'uploaded_at', av.uploaded_at))
      FROM public.asset_version av
      WHERE v_share.role = 'tech_manager'
        AND av.performance_id = p.id AND av.deleted_at IS NULL), '[]'::jsonb),
    -- 88: los materiales de salida de la línea y de la función, con enlace.
    'materials', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', av.kind, 'url', av.url, 'slug', av.slug, 'uploaded_at', av.uploaded_at,
        'scope', CASE WHEN av.performance_id IS NOT NULL THEN 'performance' ELSE 'line' END)
        ORDER BY (av.performance_id IS NULL), av.kind, av.uploaded_at DESC)
      FROM public.asset_version av
      WHERE av.deleted_at IS NULL
        AND av.direction = 'outbound'
        AND av.url ~* '^https?://'
        AND (av.performance_id = p.id OR (p.line_id IS NOT NULL AND av.line_id = p.line_id))), '[]'::jsonb)
  )
  -- ADR-166 + ADR-242: viajes atados al bolo (y a su línea sin bolo), o el
  -- día y la víspera si no hay ninguno atado; solo para quien viaja, nunca venue.
  || CASE WHEN v_share.role IN ('performer', 'tech_manager')
          THEN jsonb_build_object('travel', private.performance_trips_jsonb(p.id, false, false))
          ELSE '{}'::jsonb END
  -- 121 B (ADR-183): las horas que movió un aviso, para «cambiado hoy · antes HH:MM».
  || jsonb_build_object('late_moves', COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
         'kind', n.milestone_kind, 'label', n.milestone_label,
         'from', n.moved_from, 'to', n.moved_to, 'moved_at', n.moved_at)
         ORDER BY n.moved_at)
       FROM public.roadsheet_late_notice n
       WHERE n.performance_id = p.id AND n.moved_at IS NOT NULL), '[]'::jsonb))
  -- 143 (ADR-129 § 7): el oficio del espacio, para que la hoja hable el suyo.
  || jsonb_build_object('trade', (SELECT w.trade FROM public.workspace w WHERE w.id = p.workspace_id))
  -- 226 (ADR-226): a quién llama la sala. Solo en el enlace de sala.
  || CASE WHEN v_share.role = 'venue' THEN jsonb_build_object('company_contact', (
       SELECT CASE
                WHEN x.person_name IS NOT NULL AND x.person_phone IS NOT NULL
                  THEN jsonb_build_object('kind', 'person', 'name', x.person_name, 'phone', x.person_phone)
                WHEN x.ws_phone IS NOT NULL
                  THEN jsonb_build_object('kind', 'company', 'name', x.ws_name, 'phone', x.ws_phone)
              END
       FROM (
         SELECT
           CASE WHEN p.venue_contact_person_id IS NOT NULL
                 AND private.roadsheet_person_role(p.id, p.venue_contact_person_id) IS NOT NULL
                THEN nullif(btrim(private.roadsheet_person_name(p.workspace_id, p.venue_contact_person_id)), '')
           END AS person_name,
           CASE WHEN p.venue_contact_person_id IS NOT NULL
                 AND private.roadsheet_person_role(p.id, p.venue_contact_person_id) IS NOT NULL
                THEN coalesce(
                  (SELECT nullif(btrim(ca.contact_override->>'phone'), '')
                   FROM public.crew_assignment ca
                   WHERE ca.performance_id = p.id AND ca.person_id = p.venue_contact_person_id
                     AND ca.deleted_at IS NULL
                     AND nullif(btrim(ca.contact_override->>'phone'), '') IS NOT NULL
                   ORDER BY ca.created_at LIMIT 1),
                  (SELECT nullif(btrim(wp.phone), '')
                   FROM public.workspace_person wp
                   WHERE wp.workspace_id = p.workspace_id AND wp.person_id = p.venue_contact_person_id
                     AND wp.deleted_at IS NULL
                   LIMIT 1))
           END AS person_phone,
           w.name AS ws_name,
           nullif(btrim(w.phone), '') AS ws_phone
         FROM public.workspace w
         WHERE w.id = p.workspace_id) x))
     ELSE '{}'::jsonb END
  -- Sólo en un enlace personal de alguien que sigue en la función: de quién es
  -- la hoja y «Llego tarde».
  || CASE WHEN v_person_role IS NOT NULL THEN jsonb_build_object(
       'holder', jsonb_build_object(
         'name', private.roadsheet_person_name(p.workspace_id, v_share.person_id),
         'role', private.roadsheet_person_role_word(p.id, v_share.person_id)),
       'late', jsonb_build_object(
         'open', (now() AT TIME ZONE v_tz)::date = p.performed_at,
         'recipients', COALESCE((
           SELECT jsonb_agg(x.name ORDER BY x.name)
           FROM (
             SELECT DISTINCT nullif(btrim(up.full_name), '') AS name
             FROM public.membership m
             JOIN public.user_profile up ON up.user_id = m.user_id
             WHERE m.level = 'workspace' AND m.workspace_id = p.workspace_id
               AND m.accepted_at IS NOT NULL
               AND public.has_permission_for_user(p.project_id, 'edit:performance', m.user_id)
           ) x WHERE x.name IS NOT NULL), '[]'::jsonb),
         'last', (
           SELECT jsonb_build_object(
             'created_at', n.created_at, 'minutes', n.minutes,
             'milestone', CASE WHEN n.milestone_at IS NULL THEN NULL ELSE jsonb_build_object(
               'kind', n.milestone_kind, 'label', n.milestone_label, 'at', n.milestone_at) END,
             'seen_at', n.seen_at,
             'seen_by', (SELECT nullif(btrim(up.full_name), '') FROM public.user_profile up
                         WHERE up.user_id = n.seen_by))
           FROM public.roadsheet_late_notice n
           WHERE n.share_id = v_share.id
             AND (n.created_at AT TIME ZONE v_tz)::date = (now() AT TIME ZONE v_tz)::date
           ORDER BY n.created_at DESC, n.id DESC
           LIMIT 1)))
     ELSE '{}'::jsonb END
  INTO v_result
  FROM public.performance p
  WHERE p.id = v_share.performance_id AND p.deleted_at IS NULL;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.get_public_roadsheet(text) OWNER TO postgres;
