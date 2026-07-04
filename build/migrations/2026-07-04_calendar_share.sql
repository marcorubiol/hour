-- ADR-054: subscribable ICS calendar feed. A share row pins a WORKSPACE;
-- the public RPC returns confirmed-and-beyond performances plus
-- non-cancelled dates for the token's workspace. The Worker renders the
-- RFC 5545 text — the RPC only assembles sanitized JSON (NEVER fee,
-- NEVER notes, NEVER engagement/person internals).
--
-- Same capability-token pattern as the road sheet share (ADR-047): table
-- is deny-all (FORCE RLS, no policies), all management goes through
-- SECURITY DEFINER RPCs, the public fetch is anon-executable and returns
-- NULL for unknown/revoked tokens. Rationale: an artist lives in
-- Google/Apple Calendar — if confirmed gigs aren't subscribable, someone
-- copies them by hand and the sources diverge
-- (_notes/research-redesign-gaps.md § 2).
--
-- Gating: minting/revoking a public link is a publishing action (like the
-- road sheet's edit:show gate), so create/revoke require a WRITE role
-- (owner|admin|member) — a read-only viewer/guest must not mint a
-- permanent anon link to the whole workspace calendar. list is any
-- accepted member (seeing existing feeds is harmless).

CREATE TABLE public.calendar_share (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  token        text NOT NULL UNIQUE,
  workspace_id uuid NOT NULL REFERENCES public.workspace (id) ON DELETE CASCADE,
  created_by   uuid REFERENCES auth.users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);

ALTER TABLE public.calendar_share ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_share FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.calendar_share FROM PUBLIC, anon, authenticated;

CREATE INDEX calendar_share_ws_idx ON public.calendar_share (workspace_id) WHERE revoked_at IS NULL;

-- ── create ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_calendar_share(
  p_workspace_id uuid
)
RETURNS public.calendar_share
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_share public.calendar_share;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_membership m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = v_caller
      AND m.accepted_at IS NOT NULL
      AND m.role IN ('owner', 'admin', 'member')
  ) THEN
    RAISE EXCEPTION 'a write role is required to publish a calendar feed'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.calendar_share (token, workspace_id, created_by)
  VALUES (
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    p_workspace_id, v_caller
  )
  RETURNING * INTO v_share;
  RETURN v_share;
END;
$function$;

-- ── list ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_calendar_shares(p_workspace_id uuid)
RETURNS SETOF public.calendar_share
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_membership m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = auth.uid()
      AND m.accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT * FROM public.calendar_share
    WHERE workspace_id = p_workspace_id AND revoked_at IS NULL
    ORDER BY created_at DESC;
END;
$function$;

-- ── revoke ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revoke_calendar_share(p_share_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ws uuid;
BEGIN
  SELECT s.workspace_id INTO v_ws
  FROM public.calendar_share s
  WHERE s.id = p_share_id AND s.revoked_at IS NULL;
  IF v_ws IS NULL OR auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_membership m
    WHERE m.workspace_id = v_ws
      AND m.user_id = auth.uid()
      AND m.accepted_at IS NOT NULL
      AND m.role IN ('owner', 'admin', 'member')
  ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.calendar_share SET revoked_at = now() WHERE id = p_share_id;
END;
$function$;

-- ── public fetch (anon-executable) ──────────────────────────────────────
-- Sanitized feed JSON for a live token: performances confirmed and
-- beyond (confirmed | done | invoiced | paid) + non-cancelled dates.
-- The linked venue rides along for location + timezone. NO fee, NO
-- notes, NO engagement/person data of any kind.
CREATE OR REPLACE FUNCTION public.get_public_calendar(p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_share public.calendar_share;
  v_result jsonb;
BEGIN
  SELECT * INTO v_share
  FROM public.calendar_share
  WHERE token = p_token AND revoked_at IS NULL;
  IF v_share.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- A soft-deleted workspace kills its feeds too.
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace w
    WHERE w.id = v_share.workspace_id AND w.deleted_at IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'workspace', (SELECT jsonb_build_object('name', w.name, 'slug', w.slug, 'timezone', w.timezone)
                  FROM public.workspace w
                  WHERE w.id = v_share.workspace_id AND w.deleted_at IS NULL),
    'performances', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'slug', p.slug, 'performed_at', p.performed_at,
        'status', p.status, 'venue_name', p.venue_name, 'city', p.city,
        'country', p.country,
        'load_in_at', p.load_in_at, 'soundcheck_at', p.soundcheck_at,
        'start_at', p.start_at, 'loadout_at', p.loadout_at, 'wrap_at', p.wrap_at,
        'updated_at', p.updated_at,
        'project', (SELECT jsonb_build_object('name', pr.name)
                    FROM public.project pr WHERE pr.id = p.project_id),
        'venue', (SELECT jsonb_build_object(
                    'name', vn.name, 'city', vn.city, 'country', vn.country,
                    'address', vn.address, 'timezone', vn.timezone)
                  FROM public.venue vn WHERE vn.id = p.venue_id AND vn.deleted_at IS NULL)
      ) ORDER BY p.performed_at)
      FROM public.performance p
      WHERE p.workspace_id = v_share.workspace_id
        AND p.deleted_at IS NULL
        AND p.status IN ('confirmed', 'done', 'invoiced', 'paid')), '[]'::jsonb),
    'dates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'kind', d.kind, 'status', d.status, 'title', d.title,
        'starts_at', d.starts_at, 'ends_at', d.ends_at, 'all_day', d.all_day,
        'venue_name', d.venue_name, 'city', d.city, 'updated_at', d.updated_at,
        'project', (SELECT jsonb_build_object('name', pr.name)
                    FROM public.project pr WHERE pr.id = d.project_id)
      ) ORDER BY d.starts_at)
      FROM public.date d
      WHERE d.workspace_id = v_share.workspace_id
        AND d.deleted_at IS NULL
        AND d.status <> 'cancelled'), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_calendar_share(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_calendar_share(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.list_calendar_shares(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_calendar_shares(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.revoke_calendar_share(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_calendar_share(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_public_calendar(text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_calendar(text) TO anon, authenticated;
