-- ADR-241 · Fase 1: «Mi calendario» personal por suscripción (.ics cruzando espacios).
--
-- 1. `membership.calendar_scope`: 'mine' | 'all' | 'none' | NULL.
--    NULL sigue `membership.view_scope` (ADR-151) y, si éste es NULL, el
--    defecto del paquete/rol. 'none' saca ese espacio del calendario personal.
--    Solo nivel espacio; se escribe con `set_my_calendar_scope`.
-- 2. `public.user_calendar_feed`: un enlace personal revocable y con caducidad
--    (1 año por defecto) + preferencia de aviso (`none` | `day_before` |
--    `2h_before`). RLS forzada deny-all (igual que `calendar_share`, ADR-054):
--    solo acceso por RPC.
-- 3. `private.effective_calendar_scope` y `private.person_is_rostered_on_performance`:
--    helpers internos de alcance y convocatoria sin contestar (ADR-235).
-- 4. `public.get_personal_calendar(p_token text)`: devuelve el JSON saneado
--    cruzando todos los espacios del dueño del token cuyo alcance efectivo no
--    es `'none'`, respetando permisos (un `guest` solo ve sus funciones/fechas
--    accesibles, nunca toda la compañía), excluyendo `cancelled`, `proposed` y
--    lo contestado como `not_going`, y marcando `unanswered` en las funciones
--    donde está en reparto sin haber contestado. Nunca dinero, notas internas,
--    localizadores ni datos de otras personas (ADR-054).
--
-- ADITIVA según § 34: columna nullable con CHECK, tabla nueva deny-all,
-- funciones nuevas sin tocar firmas existentes.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.get_personal_calendar(text);
--   DROP FUNCTION IF EXISTS public.revoke_my_calendar_feed();
--   DROP FUNCTION IF EXISTS public.update_my_calendar_feed(text);
--   DROP FUNCTION IF EXISTS public.create_my_calendar_feed(text);
--   DROP FUNCTION IF EXISTS public.get_my_calendar_feed();
--   DROP FUNCTION IF EXISTS public.set_my_calendar_scope(uuid, text);
--   DROP FUNCTION IF EXISTS private.person_is_rostered_on_performance(uuid, uuid);
--   DROP FUNCTION IF EXISTS private.effective_calendar_scope(public.membership_role, text, text, text);
--   DROP TABLE IF EXISTS public.user_calendar_feed;
--   ALTER TABLE public.membership DROP CONSTRAINT IF EXISTS membership_calendar_scope_check;
--   ALTER TABLE public.membership DROP COLUMN IF EXISTS calendar_scope;

-- ── 1 · membership.calendar_scope ─────────────────────────────────────────
ALTER TABLE public.membership
  ADD COLUMN calendar_scope text,
  ADD CONSTRAINT membership_calendar_scope_check
    CHECK (calendar_scope IS NULL OR (level = 'workspace' AND calendar_scope IN ('mine', 'all', 'none')));

COMMENT ON COLUMN public.membership.calendar_scope IS
  'ADR-241: what this member''s personal calendar includes from this workspace: mine, all, or none. NULL follows membership.view_scope (ADR-151) and its package default. Workspace level only; written through set_my_calendar_scope.';

CREATE FUNCTION public.set_my_calendar_scope(p_workspace_id uuid, p_scope text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_id     uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_scope IS NOT NULL AND p_scope NOT IN ('mine', 'all', 'none') THEN
    RAISE EXCEPTION 'calendar_scope must be mine, all, none, or null' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_id
  FROM public.membership
  WHERE user_id = v_caller
    AND workspace_id = p_workspace_id
    AND level = 'workspace'
    AND accepted_at IS NOT NULL
  LIMIT 1;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'workspace membership not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.membership
  SET calendar_scope = p_scope
  WHERE id = v_id
    AND calendar_scope IS DISTINCT FROM p_scope;
END;
$function$;

COMMENT ON FUNCTION public.set_my_calendar_scope(uuid, text) IS
  'ADR-241: sets the caller''s calendar_scope (mine | all | none | null) on their own accepted workspace membership.';

REVOKE ALL ON FUNCTION public.set_my_calendar_scope(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_my_calendar_scope(uuid, text) TO authenticated;

-- ── 2 · user_calendar_feed ────────────────────────────────────────────────
CREATE TABLE public.user_calendar_feed (
  id         uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE,
  alarm_mode text NOT NULL DEFAULT 'none'
    CONSTRAINT user_calendar_feed_alarm_mode_check CHECK (alarm_mode IN ('none', 'day_before', '2h_before')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 year'),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_calendar_feed IS
  'ADR-241 Fase 1: personal cross-workspace subscribable .ics feed token (revocable, expiring, with alarm preference). Deny-all RLS; accessed only through SECURITY DEFINER RPCs.';

CREATE UNIQUE INDEX user_calendar_feed_one_active_per_user
  ON public.user_calendar_feed (user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX user_calendar_feed_active_token_idx
  ON public.user_calendar_feed (token)
  WHERE revoked_at IS NULL;

ALTER TABLE public.user_calendar_feed ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_calendar_feed FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_calendar_feed FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.user_calendar_feed TO service_role;

CREATE TRIGGER user_calendar_feed_set_updated_at
BEFORE UPDATE ON public.user_calendar_feed
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3 · RPCs de gestión del enlace personal ───────────────────────────────
CREATE FUNCTION public.get_my_calendar_feed()
 RETURNS SETOF public.user_calendar_feed
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT *
    FROM public.user_calendar_feed
    WHERE user_id = v_caller
      AND revoked_at IS NULL
      AND expires_at > now()
    ORDER BY created_at DESC
    LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_calendar_feed() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_calendar_feed() TO authenticated;

CREATE FUNCTION public.create_my_calendar_feed(p_alarm_mode text DEFAULT 'none'::text)
 RETURNS public.user_calendar_feed
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_feed   public.user_calendar_feed;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_alarm_mode IS NULL OR p_alarm_mode NOT IN ('none', 'day_before', '2h_before') THEN
    RAISE EXCEPTION 'alarm_mode must be none, day_before, or 2h_before' USING ERRCODE = '22023';
  END IF;

  -- Revocar cualquier enlace previo activo del usuario antes de emitir el nuevo.
  UPDATE public.user_calendar_feed
  SET revoked_at = now()
  WHERE user_id = v_caller
    AND revoked_at IS NULL;

  INSERT INTO public.user_calendar_feed (user_id, token, alarm_mode, expires_at)
  VALUES (
    v_caller,
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    p_alarm_mode,
    now() + interval '1 year'
  )
  RETURNING * INTO v_feed;

  RETURN v_feed;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_my_calendar_feed(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_my_calendar_feed(text) TO authenticated;

CREATE FUNCTION public.update_my_calendar_feed(p_alarm_mode text)
 RETURNS public.user_calendar_feed
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_feed   public.user_calendar_feed;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_alarm_mode IS NULL OR p_alarm_mode NOT IN ('none', 'day_before', '2h_before') THEN
    RAISE EXCEPTION 'alarm_mode must be none, day_before, or 2h_before' USING ERRCODE = '22023';
  END IF;

  UPDATE public.user_calendar_feed
  SET alarm_mode = p_alarm_mode
  WHERE user_id = v_caller
    AND revoked_at IS NULL
    AND expires_at > now()
  RETURNING * INTO v_feed;

  IF v_feed.id IS NULL THEN
    RAISE EXCEPTION 'active personal calendar feed not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_feed;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_my_calendar_feed(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_my_calendar_feed(text) TO authenticated;

CREATE FUNCTION public.revoke_my_calendar_feed()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.user_calendar_feed
  SET revoked_at = now()
  WHERE user_id = v_caller
    AND revoked_at IS NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.revoke_my_calendar_feed() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_my_calendar_feed() TO authenticated;

-- ── 4 · Helpers internos de alcance y reparto ─────────────────────────────
CREATE FUNCTION private.effective_calendar_scope(
  p_role           public.membership_role,
  p_preset         text,
  p_view_scope     text,
  p_calendar_scope text
)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_calendar_scope IN ('mine', 'all', 'none') THEN p_calendar_scope
    WHEN p_view_scope IN ('mine', 'all') THEN p_view_scope
    WHEN p_role IN ('owner', 'guest') THEN 'all'
    WHEN p_preset IN ('minim', 'equip') THEN 'mine'
    WHEN p_preset IN ('coordinacio', 'direccio') THEN 'all'
    WHEN p_role = 'viewer' THEN 'mine'
    ELSE 'all'
  END;
$function$;

REVOKE ALL ON FUNCTION private.effective_calendar_scope(public.membership_role, text, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.person_is_rostered_on_performance(p_performance_id uuid, p_person_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_person_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.performance p
      JOIN public.cast_member cm ON cm.project_id = p.project_id AND cm.deleted_at IS NULL
      WHERE p.id = p_performance_id AND cm.person_id = p_person_id
        AND NOT EXISTS (
          SELECT 1 FROM public.cast_override co
          WHERE co.performance_id = p.id AND co.deleted_at IS NULL
            AND co.replaces_person_id = p_person_id
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.cast_override co
      WHERE co.performance_id = p_performance_id AND co.deleted_at IS NULL AND co.person_id = p_person_id
    )
    OR EXISTS (
      SELECT 1 FROM public.crew_assignment cr
      WHERE cr.performance_id = p_performance_id AND cr.deleted_at IS NULL AND cr.person_id = p_person_id
    )
  );
$function$;

REVOKE ALL ON FUNCTION private.person_is_rostered_on_performance(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- ── 5 · get_personal_calendar (anon + authenticated, por token) ───────────
CREATE FUNCTION public.get_personal_calendar(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_feed   public.user_calendar_feed;
  v_person uuid;
  v_locale text;
  v_result jsonb;
BEGIN
  SELECT * INTO v_feed
  FROM public.user_calendar_feed
  WHERE token = p_token
    AND revoked_at IS NULL
    AND expires_at > now();

  IF v_feed.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT up.person_id, up.locale
  INTO v_person, v_locale
  FROM public.user_profile up
  WHERE up.user_id = v_feed.user_id;

  WITH included_spaces AS (
    SELECT
      w.id,
      w.name,
      w.slug,
      w.timezone,
      w.trade,
      m.workspace_role,
      private.effective_calendar_scope(m.workspace_role, m.preset, m.view_scope, m.calendar_scope) AS scope
    FROM public.membership m
    JOIN public.workspace w ON w.id = m.workspace_id AND w.deleted_at IS NULL
    WHERE m.user_id = v_feed.user_id
      AND m.level = 'workspace'
      AND m.accepted_at IS NOT NULL
      AND (m.expires_at IS NULL OR m.expires_at > now())
      AND private.effective_calendar_scope(m.workspace_role, m.preset, m.view_scope, m.calendar_scope) <> 'none'
  ),
  guest_targets AS (
    SELECT m.project_id, m.bolo_id, m.performance_id
    FROM public.membership m
    WHERE m.user_id = v_feed.user_id
      AND m.level <> 'workspace'
      AND m.accepted_at IS NOT NULL
      AND (m.expires_at IS NULL OR m.expires_at > now())
  )
  SELECT jsonb_build_object(
    'alarm_mode', v_feed.alarm_mode,
    'expires_at', v_feed.expires_at,
    'locale', v_locale,
    'performances', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'slug', p.slug,
          'performed_at', p.performed_at,
          'status', p.status,
          'venue_name', p.venue_name,
          'city', p.city,
          'country', p.country,
          'updated_at', p.updated_at,
          'unanswered', (
            v_person IS NOT NULL
            AND private.person_is_rostered_on_performance(p.id, v_person)
            AND NOT EXISTS (
              SELECT 1 FROM public.commitment_person c
              WHERE c.performance_id = p.id AND c.person_id = v_person
            )
          ),
          'workspace', jsonb_build_object(
            'id', s.id, 'name', s.name, 'slug', s.slug, 'timezone', s.timezone, 'trade', s.trade
          ),
          'project', (
            SELECT jsonb_build_object('name', pr.name)
            FROM public.project pr WHERE pr.id = p.project_id
          ),
          'venue', (
            SELECT jsonb_build_object(
              'name', vn.name, 'city', vn.city, 'country', vn.country,
              'address', vn.address, 'timezone', vn.timezone
            )
            FROM public.venue vn WHERE vn.id = p.venue_id AND vn.deleted_at IS NULL
          )
        )
        || private.performance_timeslots(p.id)
        || jsonb_build_object('schedule', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'kind', sl.kind, 'label', sl.label, 'at', sl.at, 'ends_at', sl.ends_at)
               ORDER BY sl.sort)
             FROM public.schedule_slot sl
             WHERE sl.performance_id = p.id), '[]'::jsonb))
        ORDER BY p.performed_at, p.id
      )
      FROM public.performance p
      JOIN included_spaces s ON s.id = p.workspace_id
      WHERE p.deleted_at IS NULL
        AND p.status IN ('hold', 'hold_1', 'hold_2', 'hold_3', 'confirmed', 'done', 'invoiced', 'paid')
        -- Quien dijo «no puedo» no la recibe en su calendario (ADR-241 § 2.1).
        AND (v_person IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.commitment_person cn
          WHERE cn.performance_id = p.id AND cn.person_id = v_person AND cn.state = 'not_going'
        ))
        AND (
          CASE
            WHEN s.workspace_role = 'guest' THEN
              private.person_is_on_performance(p.id, v_person)
              OR EXISTS (
                SELECT 1 FROM guest_targets gt
                WHERE gt.performance_id = p.id
                   OR (gt.bolo_id IS NOT NULL AND gt.bolo_id = p.bolo_id)
                   OR (gt.project_id IS NOT NULL AND gt.project_id = p.project_id)
              )
            WHEN s.scope = 'all' THEN true
            ELSE private.person_is_on_performance(p.id, v_person)
          END
        )
    ), '[]'::jsonb),
    'dates', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', d.id,
          'kind', d.kind,
          'status', d.status,
          'title', d.title,
          'starts_at', d.starts_at,
          'ends_at', d.ends_at,
          'all_day', d.all_day,
          'venue_name', d.venue_name,
          'city', d.city,
          'updated_at', d.updated_at,
          'workspace', jsonb_build_object(
            'id', s.id, 'name', s.name, 'slug', s.slug, 'timezone', s.timezone, 'trade', s.trade
          ),
          'project', (
            SELECT jsonb_build_object('name', pr.name)
            FROM public.project pr WHERE pr.id = d.project_id
          ),
          'stages', CASE WHEN d.kind = 'travel_day' THEN COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'mode', ts.mode, 'from_city', ts.from_city, 'from_place', ts.from_place,
                'to_city', ts.to_city, 'to_place', ts.to_place,
                'depart_at', ts.depart_at, 'arrive_at', ts.arrive_at,
                'depart_tz', ts.depart_tz, 'arrive_tz', ts.arrive_tz)
                ORDER BY ts.position)
              FROM public.travel_stage ts
              WHERE ts.date_id = d.id), '[]'::jsonb) ELSE '[]'::jsonb END
        )
        ORDER BY d.starts_at, d.id
      )
      FROM public.date d
      JOIN included_spaces s ON s.id = d.workspace_id
      WHERE d.deleted_at IS NULL
        AND d.status <> 'cancelled'
        AND (v_person IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.commitment_person cn
          WHERE cn.date_id = d.id AND cn.person_id = v_person AND cn.state = 'not_going'
        ))
        AND (
          CASE
            WHEN s.workspace_role = 'guest' THEN
              (v_person IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.commitment_person cg
                WHERE cg.date_id = d.id AND cg.person_id = v_person AND cg.state = 'going'
              ))
              OR EXISTS (
                SELECT 1 FROM guest_targets gt
                WHERE gt.project_id IS NOT NULL AND gt.project_id = d.project_id
              )
            WHEN s.scope = 'all' THEN true
            ELSE (v_person IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.commitment_person cg
              WHERE cg.date_id = d.id AND cg.person_id = v_person AND cg.state = 'going'
            ))
          END
        )
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.get_personal_calendar(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_personal_calendar(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_personal_calendar(text) TO anon, authenticated;
