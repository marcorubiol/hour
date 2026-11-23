-- Rollback de 20261123100000_line_trips_window.sql (ADR-244): vuelve la regla
-- de 20261122140000 (ADR-242): los viajes de línea sin bolo salen en todas las
-- funciones de la línea y cualquier viaje atado apaga la sugerencia.
BEGIN;

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

COMMIT;
