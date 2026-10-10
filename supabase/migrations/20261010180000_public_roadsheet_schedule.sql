-- § 17 P3 · ADR-090: la hoja de ruta PÚBLICA lleva la escaleta entera.
--
-- Hasta aquí `get_public_roadsheet` solo devolvía las cinco franjas
-- (`private.performance_timeslots`), así que quien abría el enlace público
-- veía menos que la hoja interna, que desde la escaleta lista todos los
-- momentos («photo call» incluido). Ahora el objeto `performance` lleva además
-- `schedule`: cada momento con `kind`, `label`, `at` y `ends_at`, en el orden
-- de `sort`, sin `notes` (la proyección pública no las lleva). Las cinco
-- franjas siguen viajando igual, para el Worker de antes.
--
-- CREATE OR REPLACE con la MISMA firma `(p_token text)`: conserva el GRANT a
-- anon y a authenticated y el REVOKE de PUBLIC del checkpoint, y el dueño.
-- Aditiva: el Worker desplegado ignora la clave nueva, así que puede entrar
-- antes que el código.
--
-- Rollback: `build/runbooks/rollback-20261010-public-roadsheet-schedule.sql`.

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
      WHERE av.performance_id = p.id AND av.deleted_at IS NULL), '[]'::jsonb)
  ) INTO v_result
  FROM public.performance p
  WHERE p.id = v_share.performance_id AND p.deleted_at IS NULL;

  RETURN v_result;
END;
$$;


ALTER FUNCTION public.get_public_roadsheet(text) OWNER TO postgres;
