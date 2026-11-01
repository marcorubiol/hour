-- 88 y 80b · La hoja de ruta pública lleva los materiales de la línea de la
-- función y el viaje del día (`_tasks.md` § AHORA; ADR-166 § 5 dejó escrito
-- qué pedía la migración del viaje). Una sola redefinición de
-- `get_public_roadsheet`.
--
-- Firma y cuerpo de partida: `pg_get_functiondef` de producción, 2026-11-01
-- (la de `20261101130000_roadsheet_share_expiry`, con la caducidad). Misma
-- firma `(text)`, CREATE OR REPLACE: no hay sobrecarga. Sin comentario en la
-- base; grants vivos: anon y authenticated sí, service_role no (no cambian).
--
-- 88 · `materials`: los materiales de salida (`direction = 'outbound'`) de la
--   línea de la función y los de la propia función, con su enlace. La base no
--   tiene «público» por material: lo más cercano es la dirección. Un material
--   de salida es, por definición, lo que la compañía manda fuera (rider,
--   plano, dossier); los recibidos (`inbound`, de la sala) y los adaptados no
--   salen. Solo enlaces http(s), como pide la escritura (`MaterialCreateSchema`).
--   Sin `notes` (esta proyección no ha llevado nunca notas). Para todos los
--   roles: el rider y el plano son justo lo que una sala necesita. Si hace
--   falta elegir material a material, la propuesta es una columna
--   `asset_version.public boolean DEFAULT false` que la hoja pública lea.
--   `assets` (los de la función, sin enlace) no cambia.
--
-- 80b · `travel`: solo para `performer` y `tech_manager`, nunca para `venue`
--   (ADR-166 § 1). La regla de `tripsOfPerformance` ($lib/roadsheet) en SQL:
--   un `date` `travel_day` del mismo proyecto, no cancelado ni borrado, que
--   toca el día de la función o la víspera (empieza uno de esos dos días, o
--   empezó antes y sigue en marcha la víspera). Los días se leen con el reloj
--   de la sala del viaje y, si no tiene, con el de la sala de la función (UTC
--   si ninguna); un viaje de día entero guarda sus días en UTC, como los
--   devuelve PostgREST. Misma forma que `RoadsheetTrip`: los tramos con hora de
--   salida, en orden de salida, sin `notes`; «quién va» es solo quien dijo
--   «voy», por el nombre de su dossier en el espacio (ADR-147), en orden
--   alfabético; sin nadie, una lista vacía (viaje de la compañía).
--
-- ADITIVA según § 34: misma firma, dos claves nuevas en el JSON. El Worker de
-- hoy las ignora; el de esta rama pasa `travel` a `buildRoadsheet`.
--
-- Rollback: volver a aplicar el cuerpo de `get_public_roadsheet` de
-- `20261101130000_roadsheet_share_expiry.sql`.

CREATE OR REPLACE FUNCTION public.get_public_roadsheet(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_share public.roadsheet_share;
  v_result jsonb;
BEGIN
  SELECT * INTO v_share
  FROM public.roadsheet_share
  WHERE token = p_token AND revoked_at IS NULL
    -- ADR-163 § 2: un enlace caducado no devuelve nada, como uno revocado.
    AND expires_at > now();
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
      WHERE av.performance_id = p.id AND av.deleted_at IS NULL), '[]'::jsonb),
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
  -- 80b: el viaje del día y de la víspera, solo para quien viaja.
  || CASE WHEN v_share.role IN ('performer', 'tech_manager') THEN jsonb_build_object('travel', COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
         'id', d.id, 'title', d.title, 'starts_at', d.starts_at, 'all_day', d.all_day,
         'origin_city', d.origin_city, 'destination_city', d.destination_city,
         'tz', nullif(tv.timezone, ''),
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
             AND nullif(btrim(wp.full_name), '') IS NOT NULL), '[]'::jsonb))
         ORDER BY d.starts_at)
       FROM public.date d
       LEFT JOIN public.venue tv ON tv.id = d.venue_id AND tv.deleted_at IS NULL
       CROSS JOIN LATERAL (
         SELECT coalesce(nullif(tv.timezone, ''),
                         (SELECT nullif(pv.timezone, '') FROM public.venue pv
                          WHERE pv.id = p.venue_id AND pv.deleted_at IS NULL),
                         'UTC') AS tz
       ) z
       CROSS JOIN LATERAL (
         SELECT CASE WHEN d.all_day THEN (d.starts_at AT TIME ZONE 'UTC')::date
                     ELSE (d.starts_at AT TIME ZONE z.tz)::date END AS first_day,
                CASE WHEN d.ends_at IS NULL THEN NULL
                     WHEN d.all_day THEN (d.ends_at AT TIME ZONE 'UTC')::date
                     ELSE (d.ends_at AT TIME ZONE z.tz)::date END AS end_day
       ) k
       WHERE d.project_id = p.project_id
         AND d.kind = 'travel_day'
         AND d.status <> 'cancelled'
         AND d.deleted_at IS NULL
         AND k.first_day <= p.performed_at
         AND greatest(k.first_day, coalesce(k.end_day, k.first_day)) >= p.performed_at - 1), '[]'::jsonb))
     ELSE '{}'::jsonb END
  INTO v_result
  FROM public.performance p
  WHERE p.id = v_share.performance_id AND p.deleted_at IS NULL;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.get_public_roadsheet(text) OWNER TO postgres;
