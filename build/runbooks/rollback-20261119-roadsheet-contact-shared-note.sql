-- Rollback de 20261119140000_roadsheet_contact_shared_note (ADR-225).
-- `get_public_roadsheet` vuelve al cuerpo de 20261113110000 (sin `shared_note` ni
-- `company_contact`) y se borran las dos columnas de `performance` (con su
-- índice, su CHECK y su grant). PIERDE los datos: las notas compartidas y los
-- contactos elegidos. Si hace falta conservarlos, copiarlos antes:
--   CREATE TABLE tmp_roadsheet_contact_shared_note AS
--   SELECT id, shared_note, venue_contact_person_id FROM public.performance
--   WHERE shared_note IS NOT NULL OR venue_contact_person_id IS NOT NULL;
-- El código desplegado tolera la base sin las columnas (lee sin ellas), así que
-- se puede aplicar con cualquier Worker; la pantalla solo deja de ofrecer los campos
-- cuando una lectura falla con 42703.

BEGIN;

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

DROP INDEX IF EXISTS public.performance_venue_contact_person_idx;
ALTER TABLE public.performance DROP CONSTRAINT IF EXISTS performance_shared_note_length;
ALTER TABLE public.performance
  DROP COLUMN IF EXISTS shared_note,
  DROP COLUMN IF EXISTS venue_contact_person_id;

COMMIT;
