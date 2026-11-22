-- Rollback de 20261122140000_date_bolo_link (ADR-242).
--
-- Revierte `get_public_roadsheet` al cuerpo de `20261119150000`, borra
-- `trips_for_performance` y `private.performance_trips_jsonb`, restaura
-- `delete_bolo` (20260722102000) y `create_date` a su firma anterior de 18
-- parámetros (20260926100000), quita el trigger `date_guard_bolo` y borra la
-- columna `public.date.bolo_id` con su índice y su CHECK.
--
-- PIERDE los enlaces `date.bolo_id` escritos desde la migración. Si hace falta
-- conservarlos antes de revertir:
--   CREATE TABLE tmp_date_bolo_link AS
--   SELECT id, bolo_id FROM public.date WHERE bolo_id IS NOT NULL;

BEGIN;

-- 1. Restaurar get_public_roadsheet al cuerpo de 20261119150000.
CREATE OR REPLACE FUNCTION public.get_public_roadsheet(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_share public.roadsheet_share;
  v_result jsonb;
  v_contacts boolean;
  v_tz text;
  v_person_role text;
BEGIN
  SELECT * INTO v_share
  FROM public.roadsheet_share
  WHERE token = p_token AND revoked_at IS NULL
    AND expires_at > now();
  IF v_share.id IS NULL THEN
    RETURN NULL;
  END IF;
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
      'shared_note', p.shared_note,
      'logistics', CASE WHEN v_share.role IN ('performer', 'tech_manager')
                        THEN p.logistics ELSE '{}'::jsonb END,
      'hospitality', CASE WHEN v_share.role = 'performer'
                          THEN p.hospitality ELSE '{}'::jsonb END,
      'technical', CASE WHEN v_share.role IN ('venue', 'tech_manager')
                        THEN p.technical ELSE '{}'::jsonb END
    ) || private.performance_timeslots(p.id)
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
  || jsonb_build_object('late_moves', COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
         'kind', n.milestone_kind, 'label', n.milestone_label,
         'from', n.moved_from, 'to', n.moved_to, 'moved_at', n.moved_at)
         ORDER BY n.moved_at)
       FROM public.roadsheet_late_notice n
       WHERE n.performance_id = p.id AND n.moved_at IS NOT NULL), '[]'::jsonb))
  || jsonb_build_object('trade', (SELECT w.trade FROM public.workspace w WHERE w.id = p.workspace_id))
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

-- 2. Borrar funciones nuevas de lectura de viajes por función.
DROP FUNCTION IF EXISTS public.trips_for_performance(uuid);
DROP FUNCTION IF EXISTS private.performance_trips_jsonb(uuid, boolean, boolean);

-- 3. Restaurar delete_bolo al cuerpo de 20260722102000.
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
    RAISE EXCEPTION 'bolo has invoices — discard or cancel them first'
      USING ERRCODE = '23503';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment
    WHERE bolo_id = p_bolo_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'bolo has recorded payments — remove them first'
      USING ERRCODE = '23503';
  END IF;

  UPDATE public.bolo SET deleted_at = now() WHERE id = p_bolo_id;
END;
$function$;

ALTER FUNCTION public.delete_bolo(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_bolo(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_bolo(uuid) TO authenticated;

-- 4. Restaurar create_date a la firma de 18 parámetros de 20260926100000.
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

ALTER FUNCTION public.create_date(
  uuid, public.date_kind, timestamptz, timestamptz, boolean, text, text, text,
  text, public.date_status, uuid, uuid, text, text, text, text, text, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_date(
  uuid, public.date_kind, timestamptz, timestamptz, boolean, text, text, text,
  text, public.date_status, uuid, uuid, text, text, text, text, text, text
) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.create_date(
  uuid, public.date_kind, timestamptz, timestamptz, boolean, text, text, text,
  text, public.date_status, uuid, uuid, text, text, text, text, text, text
) TO authenticated;

-- 5. Quitar trigger, índice, CHECK y columna.
DROP TRIGGER IF EXISTS date_guard_bolo ON public.date;
DROP FUNCTION IF EXISTS private.guard_date_bolo_same_project();
DROP INDEX IF EXISTS public.date_bolo_idx;
ALTER TABLE public.date DROP CONSTRAINT IF EXISTS date_bolo_travel_only;
ALTER TABLE public.date DROP COLUMN IF EXISTS bolo_id;

COMMIT;
