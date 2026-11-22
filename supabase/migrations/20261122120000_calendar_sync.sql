-- ADR-241 · Fases 2 a 5: sincronización bidireccional controlada con Apple Calendar (CalDAV) y Google Calendar (API v3).
--
-- 1. `public.calendar_connection`: una conexión por proveedor (`icloud` | `google`) y usuario.
--    Credenciales cifradas en el Worker (AES-256-GCM con `CALENDAR_TOKEN_KEY`, AAD atado a
--    usuario + proveedor + cuenta). RLS forzada deny-all: el texto cifrado nunca sale por
--    PostgREST.
-- 2. `public.calendar_event_link`: relación entre cada evento escrito en el calendario «Hour»
--    remoto y su función o fecha de Hour (UID, id remoto, ETag, huella SHA-256, secuencia y
--    últimas horas escritas para ignorar ecos y detectar cambios manuales de Fase 4).
-- 3. `public.calendar_busy`: intervalos ocupados leídos de los calendarios externos elegidos
--    (Fase 3). NUNCA título, lugar ni descripción: solo `starts_at`, `ends_at`, `all_day`.
--    Se borran en cascada al desconectar.
-- 4. `public.calendar_change_proposal`: cambios hechos desde Apple/Google sobre una fecha de
--    Hour (ensayos, viajes; nunca funciones) que aparecen en «Te espera» con «Aplicar ·
--    Descartar» (Fase 4).
-- 5. Triggers ligeros que marcan `dirty = true` en conexiones activas al cambiar funciones,
--    fechas, escaleta, tramos, reparto, «voy/no puedo» o alcance de calendario.
-- 6. RPCs `authenticated` (gestión propia, lectura segura de ocupado compartido y aplicar/
--    descartar propuestas) y RPCs `service_role` (solo para el Worker de sincronización).
--
-- ADITIVA según § 34: solo tablas, índices, triggers sobre cambios y funciones nuevas.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS performance_calendar_dirty ON public.performance;
--   DROP TRIGGER IF EXISTS date_calendar_dirty ON public.date;
--   DROP TRIGGER IF EXISTS schedule_slot_calendar_dirty ON public.schedule_slot;
--   DROP TRIGGER IF EXISTS travel_stage_calendar_dirty ON public.travel_stage;
--   DROP TRIGGER IF EXISTS commitment_person_calendar_dirty ON public.commitment_person;
--   DROP TRIGGER IF EXISTS cast_member_calendar_dirty ON public.cast_member;
--   DROP TRIGGER IF EXISTS cast_override_calendar_dirty ON public.cast_override;
--   DROP TRIGGER IF EXISTS crew_assignment_calendar_dirty ON public.crew_assignment;
--   DROP TRIGGER IF EXISTS membership_calendar_dirty ON public.membership;
--   DROP FUNCTION IF EXISTS private.mark_workspace_calendars_dirty();
--   DROP FUNCTION IF EXISTS private.mark_membership_calendar_dirty();
--   DROP FUNCTION IF EXISTS public.calendar_mark_dirty_by_watch(text, text);
--   DROP FUNCTION IF EXISTS public.calendar_watch_save(uuid, text, text, text, timestamptz);
--   DROP FUNCTION IF EXISTS public.calendar_connection_secret_for_user(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.calendar_delete_connection_service(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.calendar_sync_finish(uuid, text, text, text, jsonb, text, boolean);
--   DROP FUNCTION IF EXISTS public.calendar_upsert_proposal(uuid, uuid, text, timestamptz, timestamptz, boolean);
--   DROP FUNCTION IF EXISTS public.calendar_replace_busy(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.calendar_delete_event_link(uuid, text);
--   DROP FUNCTION IF EXISTS public.calendar_upsert_event_link(uuid, text, text, uuid, text, text, text, integer, text, text, boolean);
--   DROP FUNCTION IF EXISTS public.calendar_connection_links(uuid);
--   DROP FUNCTION IF EXISTS public.calendar_user_payload(uuid, text);
--   DROP FUNCTION IF EXISTS public.calendar_sync_claim(integer, boolean, uuid);
--   DROP FUNCTION IF EXISTS public.dismiss_calendar_change_proposal(uuid);
--   DROP FUNCTION IF EXISTS public.apply_calendar_change_proposal(uuid);
--   DROP FUNCTION IF EXISTS public.list_my_calendar_waiting();
--   DROP FUNCTION IF EXISTS public.get_calendar_busy_in_window(date, date, uuid[]);
--   DROP FUNCTION IF EXISTS public.request_my_calendar_sync(uuid);
--   DROP FUNCTION IF EXISTS public.update_my_calendar_connection(uuid, text, jsonb);
--   DROP FUNCTION IF EXISTS public.upsert_my_calendar_connection(text, text, text, integer, text, text, text, text, jsonb);
--   DROP FUNCTION IF EXISTS public.list_my_calendar_connections();
--   DROP TABLE IF EXISTS public.calendar_change_proposal;
--   DROP TABLE IF EXISTS public.calendar_busy;
--   DROP TABLE IF EXISTS public.calendar_event_link;
--   DROP TABLE IF EXISTS public.calendar_connection;

-- ── 1 · calendar_connection ───────────────────────────────────────────────
CREATE TABLE public.calendar_connection (
  id                     uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  user_id                uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider               text NOT NULL CHECK (provider IN ('icloud', 'google')),
  account_email          text NOT NULL,
  credentials_ciphertext text NOT NULL,
  key_version            integer NOT NULL DEFAULT 1,
  hour_calendar_id       text,
  principal_url          text,
  calendar_home_url      text,
  sync_cursor            text,
  busy_calendar_ids      jsonb NOT NULL DEFAULT '[]'::jsonb,
  available_calendars    jsonb NOT NULL DEFAULT '[]'::jsonb,
  alarm_mode             text NOT NULL DEFAULT 'none'
    CHECK (alarm_mode IN ('none', 'day_before', '2h_before')),
  status                 text NOT NULL DEFAULT 'ok'
    CHECK (status IN ('ok', 'paused')),
  dirty                  boolean NOT NULL DEFAULT true,
  leased_until           timestamptz,
  watch_channel_id       text,
  watch_resource_id      text,
  watch_token_hash       text,
  watch_expires_at       timestamptz,
  last_synced_at         timestamptz,
  last_error             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_connection_user_provider_key UNIQUE (user_id, provider)
);

COMMENT ON TABLE public.calendar_connection IS
  'ADR-241 Fases 2-5: per-user external calendar connection (iCloud CalDAV or Google Calendar API v3). Credentials are AES-256-GCM encrypted in the Worker; table is deny-all for anon/authenticated.';

CREATE INDEX calendar_connection_dirty_idx
  ON public.calendar_connection (updated_at)
  WHERE status = 'ok' AND dirty = true;

CREATE INDEX calendar_connection_watch_idx
  ON public.calendar_connection (watch_channel_id)
  WHERE watch_channel_id IS NOT NULL;

ALTER TABLE public.calendar_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_connection FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.calendar_connection FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.calendar_connection TO service_role;

CREATE TRIGGER calendar_connection_set_updated_at
BEFORE UPDATE ON public.calendar_connection
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2 · calendar_event_link ───────────────────────────────────────────────
CREATE TABLE public.calendar_event_link (
  id             uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  connection_id  uuid NOT NULL REFERENCES public.calendar_connection(id) ON DELETE CASCADE,
  uid            text NOT NULL,
  entity_kind    text NOT NULL CHECK (entity_kind IN ('performance', 'date')),
  entity_id      uuid NOT NULL,
  remote_id      text NOT NULL,
  remote_etag    text,
  fingerprint    text NOT NULL,
  sequence       integer NOT NULL DEFAULT 0,
  last_start_at  text,
  last_end_at    text,
  last_all_day   boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_event_link_conn_uid_key UNIQUE (connection_id, uid)
);

CREATE INDEX calendar_event_link_entity_idx
  ON public.calendar_event_link (entity_kind, entity_id);

ALTER TABLE public.calendar_event_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_event_link FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.calendar_event_link FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.calendar_event_link TO service_role;

CREATE TRIGGER calendar_event_link_set_updated_at
BEFORE UPDATE ON public.calendar_event_link
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3 · calendar_busy (Fase 3: solo intervalos, nunca títulos ni lugares) ─
CREATE TABLE public.calendar_busy (
  id                 uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  connection_id      uuid NOT NULL REFERENCES public.calendar_connection(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  person_id          uuid REFERENCES public.person(id) ON DELETE CASCADE,
  starts_at          timestamptz NOT NULL,
  ends_at            timestamptz NOT NULL,
  all_day            boolean NOT NULL DEFAULT false,
  source_calendar_id text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_busy_valid_range CHECK (ends_at > starts_at)
);

COMMENT ON TABLE public.calendar_busy IS
  'ADR-241 Fase 3: busy time intervals read from the user''s selected external calendars. Intentionally stores NO titles, NO locations, and NO descriptions. Deleted on disconnect.';

CREATE INDEX calendar_busy_conn_idx ON public.calendar_busy (connection_id);
CREATE INDEX calendar_busy_person_window_idx ON public.calendar_busy (person_id, starts_at, ends_at)
  WHERE person_id IS NOT NULL;
CREATE INDEX calendar_busy_user_window_idx ON public.calendar_busy (user_id, starts_at, ends_at);

ALTER TABLE public.calendar_busy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_busy FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.calendar_busy FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.calendar_busy TO service_role;

-- ── 4 · calendar_change_proposal (Fase 4: solo fechas, nunca funciones) ───
CREATE TABLE public.calendar_change_proposal (
  id                 uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  connection_id      uuid NOT NULL REFERENCES public.calendar_connection(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date_id            uuid NOT NULL REFERENCES public.date(id) ON DELETE CASCADE,
  remote_etag        text,
  proposed_starts_at timestamptz NOT NULL,
  proposed_ends_at   timestamptz,
  proposed_all_day   boolean NOT NULL DEFAULT false,
  status             text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'dismissed')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.calendar_change_proposal IS
  'ADR-241 Fase 4: remote edits made in Apple/Google Calendar on an Hour date (rehearsal, travel, etc.; never performances), surfaced in «Te espera» with Apply / Dismiss.';

CREATE UNIQUE INDEX calendar_change_proposal_one_pending
  ON public.calendar_change_proposal (connection_id, date_id)
  WHERE status = 'pending';

CREATE INDEX calendar_change_proposal_user_pending_idx
  ON public.calendar_change_proposal (user_id)
  WHERE status = 'pending';

ALTER TABLE public.calendar_change_proposal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_change_proposal FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.calendar_change_proposal FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.calendar_change_proposal TO service_role;

CREATE TRIGGER calendar_change_proposal_set_updated_at
BEFORE UPDATE ON public.calendar_change_proposal
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 5 · Triggers para marcar conexiones dirty al cambiar datos en Hour ────
CREATE FUNCTION private.mark_workspace_calendars_dirty()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ws uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_ws := OLD.workspace_id;
  ELSE
    v_ws := NEW.workspace_id;
  END IF;

  IF v_ws IS NOT NULL THEN
    UPDATE public.calendar_connection cc
    SET dirty = true
    WHERE cc.status = 'ok'
      AND cc.dirty = false
      AND EXISTS (
        SELECT 1 FROM public.membership m
        WHERE m.user_id = cc.user_id
          AND m.workspace_id = v_ws
          AND m.level = 'workspace'
          AND m.accepted_at IS NOT NULL
      );
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION private.mark_workspace_calendars_dirty() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER performance_calendar_dirty
AFTER INSERT OR UPDATE OR DELETE ON public.performance
FOR EACH ROW EXECUTE FUNCTION private.mark_workspace_calendars_dirty();

CREATE TRIGGER date_calendar_dirty
AFTER INSERT OR UPDATE OR DELETE ON public.date
FOR EACH ROW EXECUTE FUNCTION private.mark_workspace_calendars_dirty();

CREATE TRIGGER schedule_slot_calendar_dirty
AFTER INSERT OR UPDATE OR DELETE ON public.schedule_slot
FOR EACH ROW EXECUTE FUNCTION private.mark_workspace_calendars_dirty();

CREATE TRIGGER travel_stage_calendar_dirty
AFTER INSERT OR UPDATE OR DELETE ON public.travel_stage
FOR EACH ROW EXECUTE FUNCTION private.mark_workspace_calendars_dirty();

CREATE TRIGGER commitment_person_calendar_dirty
AFTER INSERT OR UPDATE OR DELETE ON public.commitment_person
FOR EACH ROW EXECUTE FUNCTION private.mark_workspace_calendars_dirty();

CREATE TRIGGER cast_member_calendar_dirty
AFTER INSERT OR UPDATE OR DELETE ON public.cast_member
FOR EACH ROW EXECUTE FUNCTION private.mark_workspace_calendars_dirty();

CREATE TRIGGER cast_override_calendar_dirty
AFTER INSERT OR UPDATE OR DELETE ON public.cast_override
FOR EACH ROW EXECUTE FUNCTION private.mark_workspace_calendars_dirty();

CREATE TRIGGER crew_assignment_calendar_dirty
AFTER INSERT OR UPDATE OR DELETE ON public.crew_assignment
FOR EACH ROW EXECUTE FUNCTION private.mark_workspace_calendars_dirty();

CREATE FUNCTION private.mark_membership_calendar_dirty()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.view_scope IS DISTINCT FROM OLD.view_scope
     OR NEW.calendar_scope IS DISTINCT FROM OLD.calendar_scope
     OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
    UPDATE public.calendar_connection
    SET dirty = true
    WHERE user_id = NEW.user_id AND status = 'ok' AND dirty = false;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION private.mark_membership_calendar_dirty() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER membership_calendar_dirty
AFTER UPDATE ON public.membership
FOR EACH ROW EXECUTE FUNCTION private.mark_membership_calendar_dirty();

-- ── 6 · RPCs para usuarios autenticados ───────────────────────────────────
CREATE FUNCTION public.list_my_calendar_connections()
 RETURNS TABLE (
   id                  uuid,
   provider            text,
   account_email       text,
   hour_calendar_id    text,
   busy_calendar_ids   jsonb,
   available_calendars jsonb,
   alarm_mode          text,
   status              text,
   dirty               boolean,
   last_synced_at      timestamptz,
   last_error          text,
   created_at          timestamptz
 )
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
    SELECT c.id, c.provider, c.account_email, c.hour_calendar_id,
           c.busy_calendar_ids, c.available_calendars, c.alarm_mode,
           c.status, c.dirty, c.last_synced_at, c.last_error, c.created_at
    FROM public.calendar_connection c
    WHERE c.user_id = v_caller
    ORDER BY c.created_at ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_my_calendar_connections() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_my_calendar_connections() TO authenticated;

CREATE FUNCTION public.upsert_my_calendar_connection(
  p_provider               text,
  p_account_email          text,
  p_credentials_ciphertext text,
  p_key_version            integer DEFAULT 1,
  p_alarm_mode             text DEFAULT 'none',
  p_hour_calendar_id       text DEFAULT NULL,
  p_principal_url          text DEFAULT NULL,
  p_calendar_home_url      text DEFAULT NULL,
  p_available_calendars    jsonb DEFAULT '[]'::jsonb
)
 RETURNS uuid
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
  IF p_provider NOT IN ('icloud', 'google') THEN
    RAISE EXCEPTION 'invalid provider' USING ERRCODE = '22023';
  END IF;
  IF p_alarm_mode NOT IN ('none', 'day_before', '2h_before') THEN
    RAISE EXCEPTION 'invalid alarm_mode' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.calendar_connection (
    user_id, provider, account_email, credentials_ciphertext, key_version,
    alarm_mode, hour_calendar_id, principal_url, calendar_home_url,
    available_calendars, status, dirty, last_error
  )
  VALUES (
    v_caller, p_provider, lower(trim(p_account_email)), p_credentials_ciphertext, p_key_version,
    p_alarm_mode, p_hour_calendar_id, p_principal_url, p_calendar_home_url,
    COALESCE(p_available_calendars, '[]'::jsonb), 'ok', true, NULL
  )
  ON CONFLICT (user_id, provider) DO UPDATE SET
    account_email          = EXCLUDED.account_email,
    credentials_ciphertext = EXCLUDED.credentials_ciphertext,
    key_version            = EXCLUDED.key_version,
    alarm_mode             = EXCLUDED.alarm_mode,
    hour_calendar_id       = COALESCE(EXCLUDED.hour_calendar_id, public.calendar_connection.hour_calendar_id),
    principal_url          = COALESCE(EXCLUDED.principal_url, public.calendar_connection.principal_url),
    calendar_home_url      = COALESCE(EXCLUDED.calendar_home_url, public.calendar_connection.calendar_home_url),
    available_calendars    = COALESCE(EXCLUDED.available_calendars, public.calendar_connection.available_calendars),
    status                 = 'ok',
    dirty                  = true,
    last_error             = NULL
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_my_calendar_connection(text, text, text, integer, text, text, text, text, jsonb)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_my_calendar_connection(text, text, text, integer, text, text, text, text, jsonb)
  TO authenticated;

CREATE FUNCTION public.update_my_calendar_connection(
  p_connection_id     uuid,
  p_alarm_mode        text DEFAULT NULL,
  p_busy_calendar_ids jsonb DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_found  uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_alarm_mode IS NOT NULL AND p_alarm_mode NOT IN ('none', 'day_before', '2h_before') THEN
    RAISE EXCEPTION 'invalid alarm_mode' USING ERRCODE = '22023';
  END IF;
  IF p_busy_calendar_ids IS NOT NULL AND jsonb_typeof(p_busy_calendar_ids) <> 'array' THEN
    RAISE EXCEPTION 'busy_calendar_ids must be a JSON array' USING ERRCODE = '22023';
  END IF;

  UPDATE public.calendar_connection
  SET
    alarm_mode        = COALESCE(p_alarm_mode, alarm_mode),
    busy_calendar_ids = COALESCE(p_busy_calendar_ids, busy_calendar_ids),
    dirty             = true
  WHERE id = p_connection_id AND user_id = v_caller
  RETURNING id INTO v_found;

  IF v_found IS NULL THEN
    RAISE EXCEPTION 'calendar connection not found' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_my_calendar_connection(uuid, text, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_my_calendar_connection(uuid, text, jsonb) TO authenticated;

CREATE FUNCTION public.request_my_calendar_sync(p_connection_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_found  uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.calendar_connection
  SET dirty = true, leased_until = NULL
  WHERE id = p_connection_id AND user_id = v_caller
  RETURNING id INTO v_found;

  IF v_found IS NULL THEN
    RAISE EXCEPTION 'calendar connection not found' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.request_my_calendar_sync(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.request_my_calendar_sync(uuid) TO authenticated;

CREATE FUNCTION public.delete_my_calendar_connection(p_connection_id uuid)
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
  DELETE FROM public.calendar_connection
  WHERE id = p_connection_id AND user_id = v_caller;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_my_calendar_connection(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_my_calendar_connection(uuid) TO authenticated;

-- Fase 3: leer ocupado de personas que comparten espacio con quien consulta.
-- NUNCA títulos, lugares ni notas: solo person_id, starts_at, ends_at, all_day.
CREATE FUNCTION public.get_calendar_busy_in_window(
  p_from          date,
  p_to            date,
  p_workspace_ids uuid[] DEFAULT NULL
)
 RETURNS TABLE (
   id           uuid,
   workspace_id uuid,
   person_id    uuid,
   starts_at    timestamptz,
   ends_at      timestamptz,
   all_day      boolean,
   full_name    text,
   slug         text
 )
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
    WITH caller_spaces AS (
      SELECT m.workspace_id
      FROM public.membership m
      JOIN public.workspace w ON w.id = m.workspace_id AND w.deleted_at IS NULL
      WHERE m.user_id = v_caller
        AND m.level = 'workspace'
        AND m.accepted_at IS NOT NULL
        AND m.workspace_role IN ('owner', 'admin', 'member', 'viewer')
        AND (p_workspace_ids IS NULL OR m.workspace_id = ANY(p_workspace_ids))
    ),
    shared_people AS (
      SELECT DISTINCT ON (cb.id)
        cb.id,
        cs.workspace_id,
        cb.person_id,
        cb.starts_at,
        cb.ends_at,
        cb.all_day,
        wp.full_name,
        wp.slug
      FROM public.calendar_busy cb
      JOIN public.membership tm
        ON tm.user_id = cb.user_id
       AND tm.level = 'workspace'
       AND tm.accepted_at IS NOT NULL
      JOIN caller_spaces cs ON cs.workspace_id = tm.workspace_id
      LEFT JOIN public.workspace_person wp
        ON wp.workspace_id = cs.workspace_id
       AND wp.person_id = cb.person_id
       AND wp.deleted_at IS NULL
      WHERE cb.person_id IS NOT NULL
        AND cb.ends_at >= p_from::timestamptz
        AND cb.starts_at < (p_to + 1)::timestamptz
      ORDER BY cb.id, cs.workspace_id
    )
    SELECT sp.id, sp.workspace_id, sp.person_id, sp.starts_at, sp.ends_at, sp.all_day, sp.full_name, sp.slug
    FROM shared_people sp
    ORDER BY sp.starts_at ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_calendar_busy_in_window(date, date, uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_calendar_busy_in_window(date, date, uuid[]) TO authenticated;

-- Fase 2 (pausa) + Fase 4 (propuestas) para «Te espera».
CREATE FUNCTION public.list_my_calendar_waiting()
 RETURNS jsonb
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

  RETURN jsonb_build_object(
    'paused', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'provider', c.provider,
        'account_email', c.account_email,
        'last_error', c.last_error,
        'updated_at', c.updated_at
      ) ORDER BY c.updated_at DESC)
      FROM public.calendar_connection c
      WHERE c.user_id = v_caller AND c.status = 'paused'
    ), '[]'::jsonb),
    'proposals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cp.id,
        'date_id', cp.date_id,
        'proposed_starts_at', cp.proposed_starts_at,
        'proposed_ends_at', cp.proposed_ends_at,
        'proposed_all_day', cp.proposed_all_day,
        'current_starts_at', d.starts_at,
        'current_ends_at', d.ends_at,
        'current_all_day', d.all_day,
        'date_kind', d.kind,
        'date_title', d.title,
        'workspace_id', d.workspace_id,
        'project_id', d.project_id,
        'project_name', pr.name,
        'workspace_timezone', w.timezone,
        'created_at', cp.created_at
      ) ORDER BY cp.created_at DESC)
      FROM public.calendar_change_proposal cp
      JOIN public.date d ON d.id = cp.date_id AND d.deleted_at IS NULL AND d.status <> 'cancelled'
      JOIN public.workspace w ON w.id = d.workspace_id AND w.deleted_at IS NULL
      LEFT JOIN public.project pr ON pr.id = d.project_id
      WHERE cp.user_id = v_caller
        AND cp.status = 'pending'
        AND (d.project_id IS NULL OR public.has_permission(d.project_id, 'edit:performance'))
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.list_my_calendar_waiting() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_my_calendar_waiting() TO authenticated;

CREATE FUNCTION public.apply_calendar_change_proposal(p_proposal_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_prop   public.calendar_change_proposal;
  v_date   public.date;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prop
  FROM public.calendar_change_proposal
  WHERE id = p_proposal_id AND user_id = v_caller AND status = 'pending';

  IF v_prop.id IS NULL THEN
    RAISE EXCEPTION 'proposal not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_date
  FROM public.date
  WHERE id = v_prop.date_id AND deleted_at IS NULL;

  IF v_date.id IS NULL THEN
    RAISE EXCEPTION 'date not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_date.project_id IS NOT NULL AND NOT public.has_permission(v_date.project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'edit permission required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.date
  SET
    starts_at = v_prop.proposed_starts_at,
    ends_at   = v_prop.proposed_ends_at,
    all_day   = v_prop.proposed_all_day
  WHERE id = v_date.id;

  UPDATE public.calendar_change_proposal
  SET status = 'applied'
  WHERE id = v_prop.id;

  UPDATE public.calendar_connection
  SET dirty = true
  WHERE id = v_prop.connection_id;

  RETURN v_date.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_calendar_change_proposal(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.apply_calendar_change_proposal(uuid) TO authenticated;

CREATE FUNCTION public.dismiss_calendar_change_proposal(p_proposal_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_conn   uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.calendar_change_proposal
  SET status = 'dismissed'
  WHERE id = p_proposal_id AND user_id = v_caller AND status = 'pending'
  RETURNING connection_id INTO v_conn;

  IF v_conn IS NULL THEN
    RAISE EXCEPTION 'proposal not found' USING ERRCODE = 'P0002';
  END IF;

  -- Al descartar, Hour vuelve a imponer su hora en la siguiente pasada.
  UPDATE public.calendar_connection
  SET dirty = true
  WHERE id = v_conn;
END;
$function$;

REVOKE ALL ON FUNCTION public.dismiss_calendar_change_proposal(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.dismiss_calendar_change_proposal(uuid) TO authenticated;

-- ── 7 · RPCs solo para service_role (Worker de sincronización) ────────────
CREATE FUNCTION public.calendar_sync_claim(
  p_limit         integer DEFAULT 5,
  p_dirty_only    boolean DEFAULT false,
  p_connection_id uuid DEFAULT NULL
)
 RETURNS SETOF public.calendar_connection
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
    WITH picked AS (
      SELECT c.id
      FROM public.calendar_connection c
      WHERE c.status = 'ok'
        AND (p_connection_id IS NULL OR c.id = p_connection_id)
        AND (p_connection_id IS NOT NULL OR c.leased_until IS NULL OR c.leased_until < now())
        AND (
          p_connection_id IS NOT NULL
          OR (p_dirty_only AND c.dirty = true)
          OR (NOT p_dirty_only AND (c.dirty = true OR c.last_synced_at IS NULL OR c.last_synced_at < now() - interval '9 minutes'))
        )
      ORDER BY c.dirty DESC, c.last_synced_at ASC NULLS FIRST
      LIMIT GREATEST(1, LEAST(p_limit, 20))
      FOR UPDATE SKIP LOCKED
    )
    UPDATE public.calendar_connection c
    SET leased_until = now() + interval '3 minutes'
    FROM picked
    WHERE c.id = picked.id
    RETURNING c.*;
END;
$function$;

REVOKE ALL ON FUNCTION public.calendar_sync_claim(integer, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_sync_claim(integer, boolean, uuid) TO service_role;

CREATE FUNCTION public.calendar_connection_secret_for_user(
  p_connection_id uuid,
  p_user_id       uuid
)
 RETURNS SETOF public.calendar_connection
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT *
  FROM public.calendar_connection
  WHERE id = p_connection_id AND user_id = p_user_id
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.calendar_connection_secret_for_user(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_connection_secret_for_user(uuid, uuid) TO service_role;

CREATE FUNCTION public.calendar_delete_connection_service(
  p_connection_id uuid,
  p_user_id       uuid
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.calendar_connection
  WHERE id = p_connection_id AND user_id = p_user_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.calendar_delete_connection_service(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_delete_connection_service(uuid, uuid) TO service_role;

CREATE FUNCTION public.calendar_user_payload(
  p_user_id    uuid,
  p_alarm_mode text DEFAULT 'none'
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_person uuid;
  v_locale text;
  v_result jsonb;
BEGIN
  SELECT up.person_id, up.locale
  INTO v_person, v_locale
  FROM public.user_profile up
  WHERE up.user_id = p_user_id;

  WITH included_spaces AS (
    SELECT
      w.id, w.name, w.slug, w.timezone, w.trade,
      m.workspace_role,
      private.effective_calendar_scope(m.workspace_role, m.preset, m.view_scope, m.calendar_scope) AS scope
    FROM public.membership m
    JOIN public.workspace w ON w.id = m.workspace_id AND w.deleted_at IS NULL
    WHERE m.user_id = p_user_id
      AND m.level = 'workspace'
      AND m.accepted_at IS NOT NULL
      AND (m.expires_at IS NULL OR m.expires_at > now())
      AND private.effective_calendar_scope(m.workspace_role, m.preset, m.view_scope, m.calendar_scope) <> 'none'
  ),
  guest_targets AS (
    SELECT m.project_id, m.bolo_id, m.performance_id
    FROM public.membership m
    WHERE m.user_id = p_user_id
      AND m.level <> 'workspace'
      AND m.accepted_at IS NOT NULL
      AND (m.expires_at IS NULL OR m.expires_at > now())
  )
  SELECT jsonb_build_object(
    'alarm_mode', p_alarm_mode,
    'locale', v_locale,
    'performances', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id, 'slug', p.slug, 'performed_at', p.performed_at,
          'status', p.status, 'venue_name', p.venue_name, 'city', p.city,
          'country', p.country, 'updated_at', p.updated_at,
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
          'project', (SELECT jsonb_build_object('name', pr.name) FROM public.project pr WHERE pr.id = p.project_id),
          'venue', (
            SELECT jsonb_build_object('name', vn.name, 'city', vn.city, 'country', vn.country,
                                      'address', vn.address, 'timezone', vn.timezone)
            FROM public.venue vn WHERE vn.id = p.venue_id AND vn.deleted_at IS NULL
          )
        )
        || private.performance_timeslots(p.id)
        || jsonb_build_object('schedule', COALESCE((
             SELECT jsonb_agg(jsonb_build_object('kind', sl.kind, 'label', sl.label, 'at', sl.at, 'ends_at', sl.ends_at)
               ORDER BY sl.sort)
             FROM public.schedule_slot sl WHERE sl.performance_id = p.id), '[]'::jsonb))
        ORDER BY p.performed_at, p.id
      )
      FROM public.performance p
      JOIN included_spaces s ON s.id = p.workspace_id
      WHERE p.deleted_at IS NULL
        AND p.status IN ('hold', 'hold_1', 'hold_2', 'hold_3', 'confirmed', 'done', 'invoiced', 'paid')
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
          'id', d.id, 'kind', d.kind, 'status', d.status, 'title', d.title,
          'starts_at', d.starts_at, 'ends_at', d.ends_at, 'all_day', d.all_day,
          'venue_name', d.venue_name, 'city', d.city, 'updated_at', d.updated_at,
          'workspace', jsonb_build_object(
            'id', s.id, 'name', s.name, 'slug', s.slug, 'timezone', s.timezone, 'trade', s.trade
          ),
          'project', (SELECT jsonb_build_object('name', pr.name) FROM public.project pr WHERE pr.id = d.project_id),
          'stages', CASE WHEN d.kind = 'travel_day' THEN COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'mode', ts.mode, 'from_city', ts.from_city, 'from_place', ts.from_place,
                'to_city', ts.to_city, 'to_place', ts.to_place,
                'depart_at', ts.depart_at, 'arrive_at', ts.arrive_at,
                'depart_tz', ts.depart_tz, 'arrive_tz', ts.arrive_tz)
                ORDER BY ts.position)
              FROM public.travel_stage ts WHERE ts.date_id = d.id), '[]'::jsonb) ELSE '[]'::jsonb END
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

REVOKE ALL ON FUNCTION public.calendar_user_payload(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_user_payload(uuid, text) TO service_role;

CREATE FUNCTION public.calendar_connection_links(p_connection_id uuid)
 RETURNS SETOF public.calendar_event_link
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT * FROM public.calendar_event_link WHERE connection_id = p_connection_id;
$function$;

REVOKE ALL ON FUNCTION public.calendar_connection_links(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_connection_links(uuid) TO service_role;

CREATE FUNCTION public.calendar_upsert_event_link(
  p_connection_id uuid,
  p_uid           text,
  p_entity_kind   text,
  p_entity_id     uuid,
  p_remote_id     text,
  p_remote_etag   text,
  p_fingerprint   text,
  p_sequence      integer,
  p_last_start_at text,
  p_last_end_at   text,
  p_last_all_day  boolean
)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  INSERT INTO public.calendar_event_link (
    connection_id, uid, entity_kind, entity_id, remote_id, remote_etag,
    fingerprint, sequence, last_start_at, last_end_at, last_all_day
  )
  VALUES (
    p_connection_id, p_uid, p_entity_kind, p_entity_id, p_remote_id, p_remote_etag,
    p_fingerprint, p_sequence, p_last_start_at, p_last_end_at, p_last_all_day
  )
  ON CONFLICT (connection_id, uid) DO UPDATE SET
    remote_id     = EXCLUDED.remote_id,
    remote_etag   = EXCLUDED.remote_etag,
    fingerprint   = EXCLUDED.fingerprint,
    sequence      = EXCLUDED.sequence,
    last_start_at = EXCLUDED.last_start_at,
    last_end_at   = EXCLUDED.last_end_at,
    last_all_day  = EXCLUDED.last_all_day;
$function$;

REVOKE ALL ON FUNCTION public.calendar_upsert_event_link(uuid, text, text, uuid, text, text, text, integer, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_upsert_event_link(uuid, text, text, uuid, text, text, text, integer, text, text, boolean)
  TO service_role;

CREATE FUNCTION public.calendar_delete_event_link(p_connection_id uuid, p_uid text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  DELETE FROM public.calendar_event_link
  WHERE connection_id = p_connection_id AND uid = p_uid;
$function$;

REVOKE ALL ON FUNCTION public.calendar_delete_event_link(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_delete_event_link(uuid, text) TO service_role;

CREATE FUNCTION public.calendar_replace_busy(p_connection_id uuid, p_intervals jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id   uuid;
  v_person_id uuid;
  v_inserted  integer := 0;
BEGIN
  SELECT c.user_id INTO v_user_id FROM public.calendar_connection c WHERE c.id = p_connection_id;
  IF v_user_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT up.person_id INTO v_person_id FROM public.user_profile up WHERE up.user_id = v_user_id;

  DELETE FROM public.calendar_busy WHERE connection_id = p_connection_id;

  IF p_intervals IS NOT NULL AND jsonb_typeof(p_intervals) = 'array' AND jsonb_array_length(p_intervals) > 0 THEN
    INSERT INTO public.calendar_busy (connection_id, user_id, person_id, starts_at, ends_at, all_day, source_calendar_id)
    SELECT
      p_connection_id,
      v_user_id,
      v_person_id,
      (x->>'starts_at')::timestamptz,
      (x->>'ends_at')::timestamptz,
      COALESCE((x->>'all_day')::boolean, false),
      x->>'source_calendar_id'
    FROM jsonb_array_elements(p_intervals) x
    WHERE (x->>'ends_at')::timestamptz > (x->>'starts_at')::timestamptz;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  END IF;

  RETURN v_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.calendar_replace_busy(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_replace_busy(uuid, jsonb) TO service_role;

CREATE FUNCTION public.calendar_upsert_proposal(
  p_connection_id uuid,
  p_date_id       uuid,
  p_remote_etag   text,
  p_starts_at     timestamptz,
  p_ends_at       timestamptz,
  p_all_day       boolean
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_date    public.date;
BEGIN
  SELECT user_id INTO v_user_id FROM public.calendar_connection WHERE id = p_connection_id;
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_date FROM public.date WHERE id = p_date_id AND deleted_at IS NULL AND status <> 'cancelled';
  IF v_date.id IS NULL THEN
    RETURN false;
  END IF;

  -- Solo si el usuario tiene permiso de escritura sobre el espacio (owner/admin/member).
  IF NOT private.model_has_workspace_role(v_date.workspace_id, v_user_id, ARRAY['owner', 'admin', 'member']::public.membership_role[]) THEN
    RETURN false;
  END IF;

  INSERT INTO public.calendar_change_proposal (
    connection_id, user_id, date_id, remote_etag, proposed_starts_at, proposed_ends_at, proposed_all_day, status
  )
  VALUES (
    p_connection_id, v_user_id, p_date_id, p_remote_etag, p_starts_at, p_ends_at, p_all_day, 'pending'
  )
  ON CONFLICT (connection_id, date_id) WHERE status = 'pending' DO UPDATE SET
    remote_etag        = EXCLUDED.remote_etag,
    proposed_starts_at = EXCLUDED.proposed_starts_at,
    proposed_ends_at   = EXCLUDED.proposed_ends_at,
    proposed_all_day   = EXCLUDED.proposed_all_day;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.calendar_upsert_proposal(uuid, uuid, text, timestamptz, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_upsert_proposal(uuid, uuid, text, timestamptz, timestamptz, boolean)
  TO service_role;

CREATE FUNCTION public.calendar_sync_finish(
  p_connection_id       uuid,
  p_status              text,
  p_sync_cursor         text,
  p_hour_calendar_id    text,
  p_available_calendars jsonb,
  p_error               text,
  p_clear_dirty         boolean
)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  UPDATE public.calendar_connection
  SET
    status              = p_status,
    sync_cursor         = COALESCE(p_sync_cursor, sync_cursor),
    hour_calendar_id    = COALESCE(p_hour_calendar_id, hour_calendar_id),
    available_calendars = COALESCE(p_available_calendars, available_calendars),
    last_error          = p_error,
    last_synced_at      = CASE WHEN p_status = 'ok' AND p_error IS NULL THEN now() ELSE last_synced_at END,
    dirty               = CASE WHEN p_clear_dirty THEN false ELSE dirty END,
    leased_until        = NULL
  WHERE id = p_connection_id;
$function$;

REVOKE ALL ON FUNCTION public.calendar_sync_finish(uuid, text, text, text, jsonb, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_sync_finish(uuid, text, text, text, jsonb, text, boolean)
  TO service_role;

CREATE FUNCTION public.calendar_watch_save(
  p_connection_id uuid,
  p_channel_id    text,
  p_resource_id   text,
  p_token_hash    text,
  p_expires_at    timestamptz
)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  UPDATE public.calendar_connection
  SET
    watch_channel_id  = p_channel_id,
    watch_resource_id = p_resource_id,
    watch_token_hash  = p_token_hash,
    watch_expires_at  = p_expires_at
  WHERE id = p_connection_id;
$function$;

REVOKE ALL ON FUNCTION public.calendar_watch_save(uuid, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_watch_save(uuid, text, text, text, timestamptz)
  TO service_role;

CREATE FUNCTION public.calendar_mark_dirty_by_watch(
  p_channel_id text,
  p_token_hash text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  UPDATE public.calendar_connection
  SET dirty = true
  WHERE watch_channel_id = p_channel_id
    AND watch_token_hash = p_token_hash
    AND status = 'ok'
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.calendar_mark_dirty_by_watch(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_mark_dirty_by_watch(text, text) TO service_role;
