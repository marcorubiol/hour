-- ADR-244 · Los viajes de la gira salen solo en las funciones vecinas.
--
-- Revisión del 23-11-2026 sobre ADR-242: un viaje con `line_id` y sin `bolo_id`
-- salía en TODAS las funciones de su línea («Gira de otoño 2027»: 12 viajes de
-- febrero a mayo en cada una de sus 36 funciones) y, por existir, apagaba la
-- sugerencia del viaje del día. `date.line_id` era el marco del viaje
-- (ADR-072 § 3), no «sirve a todas las funciones».
--
-- Cambia solo `private.performance_trips_jsonb` (misma firma, CREATE OR REPLACE):
--   1. Un viaje de línea sin bolo es de una función si cae entre la función
--      anterior y la siguiente de la misma línea (días distintos del suyo; vivas y
--      no canceladas) y no está más cerca de la vecina que de ella. Antes de la
--      primera, de la primera; después de la última, de la última; entre dos, de
--      la más cercana (a igual distancia, de las dos).
--   2. Solo un viaje atado al bolo apaga la sugerencia por día y víspera. Los de
--      la misma línea no se sugieren (los decide la ventana).
-- `trips_for_performance` y `get_public_roadsheet` llaman a esta función, así que
-- el pase, la hoja interna y la pública cambian a la vez.
--
-- Puerta § 34: NO destructiva (sin DROP, sin cambio de firma ni de datos).
-- Rollback: `build/runbooks/rollback-20261123-line-trips-window.sql` (la versión
-- de `20261122140000`).

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
  v_prev_day     date;
  v_next_day     date;
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

  -- ADR-244: la ventana de la gira. Un viaje de línea sin bolo es de las
  -- funciones vecinas, no de todas: va entre la función anterior y la
  -- siguiente de la misma línea (días distintos del de esta función).
  IF v_perf.line_id IS NOT NULL THEN
    SELECT max(p.performed_at) INTO v_prev_day
      FROM public.performance p
     WHERE p.line_id = v_perf.line_id
       AND p.project_id = v_perf.project_id
       AND p.deleted_at IS NULL
       AND p.status <> 'cancelled'
       AND p.performed_at < v_perf.performed_at;
    SELECT min(p.performed_at) INTO v_next_day
      FROM public.performance p
     WHERE p.line_id = v_perf.line_id
       AND p.project_id = v_perf.project_id
       AND p.deleted_at IS NULL
       AND p.status <> 'cancelled'
       AND p.performed_at > v_perf.performed_at;
  END IF;

  SELECT nullif(pv.timezone, '') INTO v_perf_tz
    FROM public.venue pv
   WHERE pv.id = v_perf.venue_id
     AND pv.deleted_at IS NULL;

  WITH trips AS (
    SELECT
      d.*,
      k.first_day,
      greatest(k.first_day, coalesce(k.end_day, k.first_day)) AS last_day
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
    WHERE d.project_id = v_perf.project_id
      AND d.kind = 'travel_day'
      AND d.status <> 'cancelled'
      AND d.deleted_at IS NULL
  ),
  bound AS (
    SELECT t.*, 'bolo'::text AS link_source
      FROM trips t
     WHERE v_live_bolo_id IS NOT NULL
       AND t.bolo_id = v_live_bolo_id
    UNION ALL
    SELECT t.*, 'line'::text AS link_source
      FROM trips t
     WHERE NOT p_bolo_only
       AND v_perf.line_id IS NOT NULL
       AND t.line_id = v_perf.line_id
       AND t.bolo_id IS NULL
       -- Dentro de la ventana (sin tocar la función anterior ni la siguiente)…
       AND (v_prev_day IS NULL OR t.last_day > v_prev_day)
       AND (v_next_day IS NULL OR t.first_day < v_next_day)
       -- …y no más cerca de la vecina que de esta (a igual distancia, de las dos).
       AND (v_prev_day IS NULL OR (v_perf.performed_at - t.last_day) <= (t.first_day - v_prev_day))
       AND (v_next_day IS NULL OR (t.first_day - v_perf.performed_at) <= (v_next_day - t.last_day))
  ),
  suggested AS (
    SELECT t.*, 'suggested'::text AS link_source
      FROM trips t
     WHERE NOT p_bolo_only
       -- Solo un viaje atado al bolo apaga la sugerencia: los de la gira no.
       AND NOT EXISTS (SELECT 1 FROM bound b WHERE b.link_source = 'bolo')
       AND t.bolo_id IS NULL
       -- Los de la misma línea ya los decide la ventana de la gira.
       AND (v_perf.line_id IS NULL OR t.line_id IS DISTINCT FROM v_perf.line_id)
       AND t.first_day <= v_perf.performed_at
       AND t.last_day >= v_perf.performed_at - 1
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
  'ADR-242 + ADR-244: regla única de viajes de una función: atados a su bolo U atados a su línea sin bolo dentro de la ventana de la gira (entre la función anterior y la siguiente de la línea) U sugeridos por día y víspera (sin bolo, de otra línea o sin línea) cuando ninguno está atado al bolo. Nunca devuelve bolo_id ni travel_stage.notes.';
