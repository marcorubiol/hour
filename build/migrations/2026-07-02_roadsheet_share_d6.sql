-- ADR-047 (D6 partial): signed public road sheet links. A share row pins
-- a performance + a role; the public RPC returns the sanitized bundle
-- (NEVER fee, NEVER notes, NEVER engagement/person internals) and the
-- worker applies the role matrix before responding. Table is deny-all
-- (FORCE RLS, no policies) — all management goes through SECURITY
-- DEFINER RPCs gated on edit:show.
--
-- Applied live 2026-07-02 via Supabase MCP (migration name
-- `roadsheet_share_d6`).

CREATE TABLE public.roadsheet_share (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  token          text NOT NULL UNIQUE,
  workspace_id   uuid NOT NULL REFERENCES public.workspace (id) ON DELETE CASCADE,
  performance_id uuid NOT NULL REFERENCES public.performance (id) ON DELETE CASCADE,
  role           text NOT NULL CHECK (role IN ('venue', 'performer', 'tech_manager')),
  created_by     uuid REFERENCES auth.users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz
);

ALTER TABLE public.roadsheet_share ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadsheet_share FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.roadsheet_share FROM PUBLIC, anon, authenticated;

CREATE INDEX roadsheet_share_perf_idx ON public.roadsheet_share (performance_id) WHERE revoked_at IS NULL;

-- ── create ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_roadsheet_share(
  p_performance_id uuid,
  p_role text
)
RETURNS public.roadsheet_share
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF NOT public.has_permission(v_project, 'edit:show') THEN
    RAISE EXCEPTION 'edit:show required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.roadsheet_share (token, workspace_id, performance_id, role, created_by)
  VALUES (
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    v_ws, p_performance_id, p_role, v_caller
  )
  RETURNING * INTO v_share;
  RETURN v_share;
END;
$function$;

-- ── list ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_roadsheet_shares(p_performance_id uuid)
RETURNS SETOF public.roadsheet_share
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_project uuid;
BEGIN
  SELECT project_id INTO v_project
  FROM public.performance WHERE id = p_performance_id AND deleted_at IS NULL;
  IF v_project IS NULL OR NOT public.has_permission(v_project, 'edit:show') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT * FROM public.roadsheet_share
    WHERE performance_id = p_performance_id AND revoked_at IS NULL
    ORDER BY created_at DESC;
END;
$function$;

-- ── revoke ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revoke_roadsheet_share(p_share_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_project uuid;
BEGIN
  SELECT p.project_id INTO v_project
  FROM public.roadsheet_share s
  JOIN public.performance p ON p.id = s.performance_id
  WHERE s.id = p_share_id AND s.revoked_at IS NULL;
  IF v_project IS NULL OR NOT public.has_permission(v_project, 'edit:show') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.roadsheet_share SET revoked_at = now() WHERE id = p_share_id;
END;
$function$;

-- ── public fetch (anon-executable) ──────────────────────────────────────
-- Returns the sanitized bundle for a live token. NO fee, NO notes, NO
-- engagement/person internals beyond call-sheet names+contacts (the
-- worker strips contacts for venue/performer roles).
CREATE OR REPLACE FUNCTION public.get_public_roadsheet(p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
      'load_in_at', p.load_in_at, 'soundcheck_at', p.soundcheck_at,
      'start_at', p.start_at, 'loadout_at', p.loadout_at, 'wrap_at', p.wrap_at,
      'logistics', p.logistics, 'hospitality', p.hospitality, 'technical', p.technical
    ),
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
$function$;

REVOKE ALL ON FUNCTION public.create_roadsheet_share(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_roadsheet_share(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.list_roadsheet_shares(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_roadsheet_shares(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.revoke_roadsheet_share(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_roadsheet_share(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_public_roadsheet(text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_roadsheet(text) TO anon, authenticated;
