-- Caducidad del enlace público de la hoja de ruta (ADR-160 § 2, _tasks.md § 68).
--
-- ADR-047 dejó apuntado que un enlace público (`roadsheet_share`) no caducaba
-- nunca: un PDF reenviado seguía abriendo la hoja de ruta de una función de
-- hace un año. La regla es la de la invitación de bolo (ADR-142 § 2): vale
-- hasta que acaba el día siguiente a la última función, en la zona del
-- espacio.
--
--   1. `roadsheet_share.expires_at timestamptz NOT NULL`: el primer instante
--      en que el enlace ya no abre.
--   2. `private.roadsheet_share_default_expiry(p_performance_id)`: si la
--      función cuelga de un bolo, `private.bolo_access_ends_at(bolo_id)` (la
--      misma de ADR-142: el principio del segundo día tras la última función
--      viva del bolo); si no, el principio del segundo día tras la función.
--      Se calcula al crear el enlace y se GUARDA: si el bolo se alarga
--      después, el enlace no le sigue (se alarga a mano).
--   3. Los enlaces que ya existen se rellenan con la misma regla. Los de
--      funciones ya pasadas quedan caducados en el acto: es lo que se busca.
--   4. `create_roadsheet_share` lo rellena. Firma y cuerpo de la base viva
--      (`20260720105713`, la única migración que la define); sólo cambia el
--      INSERT.
--   5. `get_public_roadsheet` no devuelve nada si ha caducado. Firma y cuerpo
--      de `20261010180000` (la última que la define); sólo cambia el WHERE.
--   6. `set_roadsheet_share_expiry(p_share_id, p_last_day date)`: «Cambiar la
--      fecha». El enlace abre hasta que acaba `p_last_day` en la zona del
--      espacio. Misma puerta que `revoke_roadsheet_share` (`edit:performance`
--      sobre la función del enlace, 42501 para todo). Un último día anterior a
--      hoy (en la zona del espacio), 22023: para cortarlo ya está revocar.
--
-- `list_roadsheet_shares` devuelve `SETOF roadsheet_share`: la columna nueva
-- sale sola, sin tocarla. Sigue listando los caducados (no revocados), para
-- que la pantalla diga «caducó el …» y deje alargarlo.
-- Hashear el token no entra (ADR-047, sigue en _tasks.md).
-- Rollback: volver a aplicar las dos funciones de sus migraciones de origen,
-- DROP FUNCTION set_roadsheet_share_expiry y roadsheet_share_default_expiry,
-- ALTER TABLE roadsheet_share DROP COLUMN expires_at.

-- ── 1 · la regla ─────────────────────────────────────────────────────────────
CREATE FUNCTION private.roadsheet_share_default_expiry(p_performance_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(
    CASE WHEN pf.bolo_id IS NOT NULL THEN private.bolo_access_ends_at(pf.bolo_id) END,
    ((pf.performed_at + 2)::timestamp AT TIME ZONE w.timezone)
  )
  FROM public.performance pf
  JOIN public.workspace w ON w.id = pf.workspace_id
  WHERE pf.id = p_performance_id;
$$;
REVOKE ALL ON FUNCTION private.roadsheet_share_default_expiry(uuid) FROM PUBLIC, anon, authenticated;

-- ── 2 · la columna, rellena ──────────────────────────────────────────────────
ALTER TABLE public.roadsheet_share ADD COLUMN expires_at timestamptz;

UPDATE public.roadsheet_share s
SET expires_at = private.roadsheet_share_default_expiry(s.performance_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.roadsheet_share WHERE expires_at IS NULL) THEN
    RAISE EXCEPTION 'roadsheet_share backfill left a NULL expires_at';
  END IF;
END;
$$;

ALTER TABLE public.roadsheet_share ALTER COLUMN expires_at SET NOT NULL;

COMMENT ON COLUMN public.roadsheet_share.expires_at IS
  'ADR-160: the first instant the public link no longer opens. Default: the start of the second day after the bolo''s last live function (or the function''s), in the workspace''s zone (ADR-142 § 2). Changed by set_roadsheet_share_expiry.';

-- ── 3 · create_roadsheet_share lo rellena ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_roadsheet_share(p_performance_id uuid, p_role text) RETURNS public.roadsheet_share
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_project uuid;
  v_ws uuid;
  v_share public.roadsheet_share;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('venue', 'performer', 'tech_manager') THEN
    RAISE EXCEPTION 'role must be venue|performer|tech_manager' USING ERRCODE = '22023';
  END IF;

  SELECT project_id, workspace_id INTO v_project, v_ws
  FROM public.performance WHERE id = p_performance_id AND deleted_at IS NULL;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'performance not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_permission(v_project, 'edit:performance') THEN
    RAISE EXCEPTION 'edit:performance required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.roadsheet_share (token, workspace_id, performance_id, role, created_by, expires_at)
  VALUES (
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    v_ws, p_performance_id, p_role, v_caller,
    private.roadsheet_share_default_expiry(p_performance_id)
  )
  RETURNING * INTO v_share;
  RETURN v_share;
END;
$$;

-- ── 4 · get_public_roadsheet calla si ha caducado ────────────────────────────
-- Cuerpo de 20261010180000; sólo cambia el WHERE del enlace.
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
  WHERE token = p_token AND revoked_at IS NULL
    -- ADR-160 § 2: un enlace caducado no devuelve nada, como uno revocado.
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
      WHERE av.performance_id = p.id AND av.deleted_at IS NULL), '[]'::jsonb)
  ) INTO v_result
  FROM public.performance p
  WHERE p.id = v_share.performance_id AND p.deleted_at IS NULL;

  RETURN v_result;
END;
$$;


ALTER FUNCTION public.get_public_roadsheet(text) OWNER TO postgres;

-- ── 5 · Cambiar la fecha ─────────────────────────────────────────────────────
CREATE FUNCTION public.set_roadsheet_share_expiry(p_share_id uuid, p_last_day date)
RETURNS public.roadsheet_share
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_project uuid;
  v_tz      text;
  v_share   public.roadsheet_share;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT p.project_id, w.timezone INTO v_project, v_tz
  FROM public.roadsheet_share s
  JOIN public.performance p ON p.id = s.performance_id
  JOIN public.workspace w ON w.id = s.workspace_id
  WHERE s.id = p_share_id AND s.revoked_at IS NULL;
  IF v_project IS NULL OR NOT public.has_permission(v_project, 'edit:performance') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  IF p_last_day IS NULL OR p_last_day < (now() AT TIME ZONE v_tz)::date THEN
    RAISE EXCEPTION 'the last day is today or later' USING ERRCODE = '22023';
  END IF;

  UPDATE public.roadsheet_share
  SET expires_at = ((p_last_day + 1)::timestamp AT TIME ZONE v_tz)
  WHERE id = p_share_id
  RETURNING * INTO v_share;
  RETURN v_share;
END;
$$;

COMMENT ON FUNCTION public.set_roadsheet_share_expiry(uuid, date) IS
  'ADR-160: the public road sheet link opens until p_last_day ends, in the workspace''s zone. edit:performance on the link''s performance (42501 otherwise). A last day before today is 22023.';
REVOKE ALL ON FUNCTION public.set_roadsheet_share_expiry(uuid, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_roadsheet_share_expiry(uuid, date) TO authenticated;
