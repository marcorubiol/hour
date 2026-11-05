-- 121 B · «Llego tarde» en la hoja de ruta del técnico (ADR-183; Marco, 2026-11-05).
--
-- La hoja pública es anónima: el token es la capacidad (ADR-047). Hasta hoy
-- el enlace era por papel (`roadsheet_share.role`) y la hoja no sabía quién la
-- abría. Un aviso «llego tarde» sólo es creíble si el enlace es de alguien, así
-- que el enlace puede llevar una persona. El técnico avisa; nunca mueve horas.
--
--   1. `roadsheet_share.person_id` (nullable): un enlace personal es un enlace
--      de papel más una persona. Los de papel siguen igual.
--      `create_roadsheet_share_for_person(p_performance_id, p_person_id)`: el
--      papel lo pone la base, no el cliente: equipo técnico de la función,
--      `tech_manager`; reparto, `performer`; si no está en ninguno, 22023.
--      Misma puerta que `create_roadsheet_share` (`edit:performance`, 42501) y
--      misma caducidad (`private.roadsheet_share_default_expiry`). Nombre nuevo,
--      no una sobrecarga de `create_roadsheet_share` (PostgREST respondería 300).
--   2. `roadsheet_late_notice`: el aviso. Lo escribe SÓLO
--      `report_roadsheet_late(p_token, p_minutes, p_note)`, SECURITY DEFINER,
--      que resuelve token → enlace → persona → función en el servidor (el
--      cliente no manda ids) y rechaza (42501) un enlace inexistente, revocado,
--      caducado, de papel o de alguien que ya no está en la función; fuera del
--      día de la función en la zona de la sala (22023); más de 3 avisos por
--      enlace en una hora (53400, con la fila del enlace bloqueada: dos
--      llamadas a la vez se ponen en fila). Minutos 10, 20, 30, 45 («45+») o
--      null («No sé»); nota de 1 a 280 caracteres. Auditado por `write_audit`
--      con `source = 'roadsheet_link'`, sin actor (anónimo).
--      RLS forzada: anon nada; authenticated sólo SELECT con `read:performance`
--      sobre el proyecto de la función. Se escribe por RPC.
--   3. El grupo del bolo: `message.system` y `message.late_notice_id`. El aviso
--      deja una línea de sistema (sin autor) en el General del bolo si la
--      función cuelga de uno vivo; mover la hora deja otra con su autor. La
--      pantalla la dice en el idioma de quien lee; `body` es el respaldo.
--   4. Producción: `roadsheet_late_notices()` (los avisos de las últimas 24 h
--      sin «Visto», de las funciones que el que llama lee), `mark_roadsheet_late_seen`
--      (`read:performance`), `roadsheet_late_move_plan` y
--      `record_roadsheet_late_move` (`edit:performance`). La hora se mueve en el
--      Worker A TRAVÉS del documento de collab (ADR-090 P2: el documento
--      manda); la base sólo lo apunta, y sólo el movimiento que el aviso
--      propone (desde la hora del hito, sumando los minutos).
--   5. `get_public_roadsheet`: cuerpo vivo de `20261105120000` (comprobado con
--      `pg_get_functiondef`, md5 igual, 2026-11-05), misma firma `(text)`.
--      Añade `late_moves` (las horas movidas por un aviso, para «cambiado hoy
--      · antes HH:MM», a todos los papeles: la hora ya está en la hoja) y, sólo
--      en un enlace personal, `holder` (nombre y papel) y `late` (si hoy se
--      puede avisar, quién lo recibe y el último aviso con su «Visto»).
--
-- Producción, quién: las personas con membresía de espacio aceptada que pueden
-- editar la función (`has_permission_for_user(…, 'edit:performance', …)`).
-- Hour no tiene papel de «productor» por función ni por bolo.
--
-- ADITIVA según § 34: columnas nullable, tabla y funciones nuevas; el único
-- CREATE OR REPLACE es `get_public_roadsheet`, con las mismas claves de antes
-- más tres. El Worker desplegado ignora las nuevas.
-- Rollback: build/runbooks/rollback-20261106-roadsheet-late-notice.sql.

-- ── 1 · el enlace personal ───────────────────────────────────────────────────
ALTER TABLE public.roadsheet_share
  ADD COLUMN person_id uuid REFERENCES public.person (id) ON DELETE SET NULL;
CREATE INDEX roadsheet_share_person_idx ON public.roadsheet_share (person_id) WHERE person_id IS NOT NULL;
COMMENT ON COLUMN public.roadsheet_share.person_id IS
  'ADR-183: the person whose link this is (a role link plus a person). NULL = a role link. Only a personal link can send «llego tarde».';

-- El papel de una persona en la función: equipo técnico, `tech_manager`;
-- reparto (el del proyecto menos a quien sustituye un cast_override de esta
-- función, más los cast_override), `performer`; si no, NULL.
CREATE FUNCTION private.roadsheet_person_role(p_performance_id uuid, p_person_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.crew_assignment ca
      WHERE ca.performance_id = p_performance_id AND ca.person_id = p_person_id AND ca.deleted_at IS NULL)
      THEN 'tech_manager'
    WHEN EXISTS (
      SELECT 1 FROM public.cast_override co
      WHERE co.performance_id = p_performance_id AND co.person_id = p_person_id AND co.deleted_at IS NULL)
      OR EXISTS (
      SELECT 1
      FROM public.performance pf
      JOIN public.cast_member cm ON cm.project_id = pf.project_id AND cm.deleted_at IS NULL
      WHERE pf.id = p_performance_id AND cm.person_id = p_person_id
        AND NOT EXISTS (
          SELECT 1 FROM public.cast_override co
          WHERE co.performance_id = pf.id AND co.deleted_at IS NULL AND co.replaces_person_id = cm.person_id))
      THEN 'performer'
  END;
$$;
REVOKE ALL ON FUNCTION private.roadsheet_person_role(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Su papel en palabras de la compañía («luces»): el de su fila de equipo o de reparto.
CREATE FUNCTION private.roadsheet_person_role_word(p_performance_id uuid, p_person_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(
    (SELECT nullif(btrim(ca.role), '') FROM public.crew_assignment ca
     WHERE ca.performance_id = p_performance_id AND ca.person_id = p_person_id AND ca.deleted_at IS NULL
     ORDER BY ca.created_at LIMIT 1),
    (SELECT nullif(btrim(co.role), '') FROM public.cast_override co
     WHERE co.performance_id = p_performance_id AND co.person_id = p_person_id AND co.deleted_at IS NULL
     ORDER BY co.created_at LIMIT 1),
    (SELECT nullif(btrim(cm.role), '') FROM public.performance pf
     JOIN public.cast_member cm ON cm.project_id = pf.project_id AND cm.deleted_at IS NULL
     WHERE pf.id = p_performance_id AND cm.person_id = p_person_id
     ORDER BY cm.created_at LIMIT 1));
$$;
REVOKE ALL ON FUNCTION private.roadsheet_person_role_word(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- El nombre con que el espacio conoce a la persona (su ficha); el global, si no.
CREATE FUNCTION private.roadsheet_person_name(p_workspace_id uuid, p_person_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(
    (SELECT wp.full_name FROM public.workspace_person wp
     WHERE wp.workspace_id = p_workspace_id AND wp.person_id = p_person_id AND wp.deleted_at IS NULL
     LIMIT 1),
    (SELECT pe.full_name FROM public.person pe WHERE pe.id = p_person_id));
$$;
REVOKE ALL ON FUNCTION private.roadsheet_person_name(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- La zona del día de la función: la de la sala, si no la del espacio.
CREATE FUNCTION private.performance_timezone(p_performance_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(nullif(v.timezone, ''), nullif(w.timezone, ''), 'UTC')
  FROM public.performance pf
  JOIN public.workspace w ON w.id = pf.workspace_id
  LEFT JOIN public.venue v ON v.id = pf.venue_id AND v.deleted_at IS NULL
  WHERE pf.id = p_performance_id;
$$;
REVOKE ALL ON FUNCTION private.performance_timezone(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.create_roadsheet_share_for_person(p_performance_id uuid, p_person_id uuid)
RETURNS public.roadsheet_share
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_project uuid;
  v_ws      uuid;
  v_role    text;
  v_share   public.roadsheet_share;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT project_id, workspace_id INTO v_project, v_ws
  FROM public.performance WHERE id = p_performance_id AND deleted_at IS NULL;
  IF v_project IS NULL OR NOT public.has_permission(v_project, 'edit:performance') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  v_role := private.roadsheet_person_role(p_performance_id, p_person_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'the person is not in this performance''s team' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.roadsheet_share (token, workspace_id, performance_id, role, person_id, created_by, expires_at)
  VALUES (
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    v_ws, p_performance_id, v_role, p_person_id, v_caller,
    private.roadsheet_share_default_expiry(p_performance_id)
  )
  RETURNING * INTO v_share;
  RETURN v_share;
END;
$$;
COMMENT ON FUNCTION public.create_roadsheet_share_for_person(uuid, uuid) IS
  'ADR-183: a personal road sheet link. The role comes from the team (crew: tech_manager, cast: performer; neither: 22023). edit:performance (42501).';
REVOKE ALL ON FUNCTION public.create_roadsheet_share_for_person(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_roadsheet_share_for_person(uuid, uuid) TO authenticated;

-- ── 2 · el aviso ─────────────────────────────────────────────────────────────
CREATE TABLE public.roadsheet_late_notice (
  id                uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id      uuid NOT NULL REFERENCES public.workspace (id) ON DELETE CASCADE,
  -- Guardado para que la política no cruce a la función.
  project_id        uuid NOT NULL REFERENCES public.project (id) ON DELETE CASCADE,
  performance_id    uuid NOT NULL REFERENCES public.performance (id) ON DELETE CASCADE,
  share_id          uuid NOT NULL REFERENCES public.roadsheet_share (id) ON DELETE CASCADE,
  person_id         uuid REFERENCES public.person (id) ON DELETE SET NULL,
  -- Foto al avisar: lo que se dijo no cambia si después cambia la ficha.
  person_name       text NOT NULL,
  person_role       text,
  minutes           smallint,
  note              text,
  source            text NOT NULL DEFAULT 'roadsheet_link',
  -- El siguiente momento de la escaleta al avisar, y su hora entonces.
  milestone_slot_id uuid REFERENCES public.schedule_slot (id) ON DELETE SET NULL,
  milestone_kind    text,
  milestone_label   text,
  milestone_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  seen_at           timestamptz,
  seen_by           uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  moved_at          timestamptz,
  moved_by          uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  moved_from        timestamptz,
  moved_to          timestamptz,
  CONSTRAINT roadsheet_late_notice_minutes CHECK (minutes IS NULL OR minutes IN (10, 20, 30, 45)),
  CONSTRAINT roadsheet_late_notice_note CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 280),
  CONSTRAINT roadsheet_late_notice_source CHECK (source = 'roadsheet_link'),
  CONSTRAINT roadsheet_late_notice_moved CHECK (
    (moved_at IS NULL) = (moved_to IS NULL) AND (moved_at IS NULL) = (moved_from IS NULL)),
  CONSTRAINT roadsheet_late_notice_seen CHECK (seen_by IS NULL OR seen_at IS NOT NULL)
);
COMMENT ON TABLE public.roadsheet_late_notice IS
  'ADR-183: «llego tarde» from a personal road sheet link. Written only by report_roadsheet_late (anonymous, token-resolved); seen and moved by production through their RPCs. Never changes a time by itself.';

CREATE INDEX roadsheet_late_notice_share_idx ON public.roadsheet_late_notice (share_id, created_at DESC);
CREATE INDEX roadsheet_late_notice_performance_idx ON public.roadsheet_late_notice (performance_id, created_at DESC);
CREATE INDEX roadsheet_late_notice_workspace_idx ON public.roadsheet_late_notice (workspace_id, created_at DESC);
CREATE INDEX roadsheet_late_notice_project_idx ON public.roadsheet_late_notice (project_id);
CREATE INDEX roadsheet_late_notice_person_idx ON public.roadsheet_late_notice (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX roadsheet_late_notice_slot_idx ON public.roadsheet_late_notice (milestone_slot_id) WHERE milestone_slot_id IS NOT NULL;
CREATE INDEX roadsheet_late_notice_seen_by_idx ON public.roadsheet_late_notice (seen_by) WHERE seen_by IS NOT NULL;
CREATE INDEX roadsheet_late_notice_moved_by_idx ON public.roadsheet_late_notice (moved_by) WHERE moved_by IS NOT NULL;

ALTER TABLE public.roadsheet_late_notice ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadsheet_late_notice FORCE ROW LEVEL SECURITY;
ALTER TABLE public.roadsheet_late_notice OWNER TO postgres;
REVOKE ALL ON TABLE public.roadsheet_late_notice FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.roadsheet_late_notice TO authenticated;
GRANT ALL ON TABLE public.roadsheet_late_notice TO service_role;

CREATE POLICY roadsheet_late_notice_select ON public.roadsheet_late_notice
  FOR SELECT TO authenticated
  USING (public.has_permission(project_id, 'read:performance'));

CREATE TRIGGER roadsheet_late_notice_audit
AFTER INSERT OR DELETE OR UPDATE ON public.roadsheet_late_notice
FOR EACH ROW EXECUTE FUNCTION public.write_audit();

-- ── 3 · la línea en el grupo del bolo ────────────────────────────────────────
ALTER TABLE public.message
  ADD COLUMN system text,
  ADD COLUMN late_notice_id uuid REFERENCES public.roadsheet_late_notice (id) ON DELETE CASCADE;
ALTER TABLE public.message
  ADD CONSTRAINT message_system_kind CHECK (system IS NULL OR system IN ('late_notice', 'late_moved')),
  ADD CONSTRAINT message_system_notice CHECK ((system IS NULL) = (late_notice_id IS NULL));
CREATE INDEX message_late_notice_idx ON public.message (late_notice_id) WHERE late_notice_id IS NOT NULL;
COMMENT ON COLUMN public.message.system IS
  'ADR-183: a line the system writes in a bolo group (late_notice: no author; late_moved: whoever moved the time). The screen words it from late_notice_id; body is the fallback.';

-- Escribe una línea de sistema en el General del bolo de la función, si
-- cuelga de un bolo vivo. Crea el hilo si falta (como post_message).
CREATE FUNCTION private.post_late_line(
  p_notice_id uuid,
  p_system    text,
  p_author    uuid,
  p_body      text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_ws     uuid;
  v_perf   uuid;
  v_bolo   uuid;
  v_thread uuid;
  v_row    public.message;
BEGIN
  SELECT n.workspace_id, n.performance_id, pf.bolo_id INTO v_ws, v_perf, v_bolo
  FROM public.roadsheet_late_notice n
  JOIN public.performance pf ON pf.id = n.performance_id
  WHERE n.id = p_notice_id;
  IF v_bolo IS NULL OR private.thread_container_workspace('bolo', v_bolo) IS DISTINCT FROM v_ws THEN
    RETURN;
  END IF;

  INSERT INTO public.thread (workspace_id, bolo_id, facet_id, created_by)
  VALUES (v_ws, v_bolo, NULL, p_author)
  ON CONFLICT ON CONSTRAINT thread_anchor_key DO NOTHING;

  SELECT t.id INTO v_thread
  FROM public.thread t
  WHERE t.workspace_id = v_ws AND t.project_id IS NULL AND t.line_id IS NULL
    AND t.bolo_id = v_bolo AND t.conversation_id IS NULL AND t.facet_id IS NULL;

  INSERT INTO public.message (thread_id, workspace_id, author_id, performance_id, body, system, late_notice_id)
  VALUES (v_thread, v_ws, p_author, v_perf, left(p_body, 10000), p_system, p_notice_id)
  RETURNING * INTO v_row;

  UPDATE public.thread
  SET last_message_at = greatest(coalesce(last_message_at, v_row.created_at), v_row.created_at)
  WHERE id = v_thread;

  IF p_author IS NOT NULL THEN
    INSERT INTO public.thread_read (thread_id, user_id, last_read_at)
    VALUES (v_thread, p_author, v_row.created_at)
    ON CONFLICT (thread_id, user_id)
    DO UPDATE SET last_read_at = greatest(public.thread_read.last_read_at, excluded.last_read_at);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.post_late_line(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;

-- La palabra castellana de un momento, para el respaldo de la línea del grupo
-- (las de `desk.anchor_*` en es.json); la pantalla lo dice en su idioma.
CREATE FUNCTION private.moment_word_es(p_kind text, p_label text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_temp'
AS $$
  SELECT coalesce(nullif(btrim(p_label), ''), CASE p_kind
    WHEN 'load_in' THEN 'carga' WHEN 'soundcheck' THEN 'prueba de sonido'
    WHEN 'doors' THEN 'puertas' WHEN 'start' THEN 'función'
    WHEN 'loadout' THEN 'desmontaje' WHEN 'wrap' THEN 'fin'
    WHEN 'curfew' THEN 'toque de queda' ELSE p_kind END);
$$;
REVOKE ALL ON FUNCTION private.moment_word_es(text, text) FROM PUBLIC, anon, authenticated;

-- ── 4 · avisar (anónimo, con el token) ───────────────────────────────────────
CREATE FUNCTION public.report_roadsheet_late(p_token text, p_minutes integer DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_share  public.roadsheet_share;
  v_perf   public.performance;
  v_tz     text;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_role   text;
  v_slot   public.schedule_slot;
  v_notice public.roadsheet_late_notice;
  v_body   text;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{40,128}$' THEN
    RAISE EXCEPTION 'link not usable' USING ERRCODE = '42501';
  END IF;

  -- Bloqueada: dos avisos a la vez con el mismo enlace se ponen en fila, y el
  -- límite se cuenta sobre lo ya escrito.
  SELECT * INTO v_share
  FROM public.roadsheet_share
  WHERE token = p_token AND revoked_at IS NULL AND expires_at > now() AND person_id IS NOT NULL
  FOR UPDATE;
  IF v_share.id IS NULL THEN
    RAISE EXCEPTION 'link not usable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_perf FROM public.performance WHERE id = v_share.performance_id AND deleted_at IS NULL;
  IF v_perf.id IS NULL THEN
    RAISE EXCEPTION 'link not usable' USING ERRCODE = '42501';
  END IF;
  v_role := private.roadsheet_person_role(v_perf.id, v_share.person_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'link not usable' USING ERRCODE = '42501';
  END IF;

  v_tz := private.performance_timezone(v_perf.id);
  IF (now() AT TIME ZONE v_tz)::date <> v_perf.performed_at THEN
    RAISE EXCEPTION 'only on the day of the performance' USING ERRCODE = '22023';
  END IF;

  IF p_minutes IS NOT NULL AND p_minutes NOT IN (10, 20, 30, 45) THEN
    RAISE EXCEPTION 'minutes must be 10, 20, 30 or 45' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 280 THEN
    RAISE EXCEPTION 'the note is 280 characters at most' USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(*) FROM public.roadsheet_late_notice n
      WHERE n.share_id = v_share.id AND n.created_at > now() - interval '1 hour') >= 3 THEN
    RAISE EXCEPTION 'too many notices from this link' USING ERRCODE = '53400';
  END IF;

  -- El hito: el primer momento de la escaleta que aún no ha llegado.
  SELECT * INTO v_slot
  FROM public.schedule_slot s
  WHERE s.performance_id = v_perf.id AND s.at > now()
  ORDER BY s.at, s.sort
  LIMIT 1;

  INSERT INTO public.roadsheet_late_notice (
    workspace_id, project_id, performance_id, share_id, person_id, person_name, person_role,
    minutes, note, milestone_slot_id, milestone_kind, milestone_label, milestone_at)
  VALUES (
    v_perf.workspace_id, v_perf.project_id, v_perf.id, v_share.id, v_share.person_id,
    coalesce(private.roadsheet_person_name(v_perf.workspace_id, v_share.person_id), '?'),
    private.roadsheet_person_role_word(v_perf.id, v_share.person_id),
    p_minutes, v_note, v_slot.id, v_slot.kind, v_slot.label, v_slot.at)
  RETURNING * INTO v_notice;

  -- El respaldo en castellano; la pantalla lo dice en el idioma de quien lee.
  v_body := v_notice.person_name || ' llega tarde'
    || CASE WHEN p_minutes = 45 THEN ', 45 min o más'
            WHEN p_minutes IS NOT NULL THEN ', unos ' || p_minutes || ' min'
            ELSE '' END
    || CASE WHEN v_slot.id IS NOT NULL
            THEN ' · ' || private.moment_word_es(v_slot.kind, v_slot.label) || ' '
                 || to_char(v_slot.at AT TIME ZONE v_tz, 'HH24:MI')
            ELSE '' END
    || ' · desde su hoja'
    || CASE WHEN v_note IS NOT NULL THEN E'\n' || v_note ELSE '' END;
  PERFORM private.post_late_line(v_notice.id, 'late_notice', NULL, v_body);

  RETURN jsonb_build_object(
    'id', v_notice.id,
    'created_at', v_notice.created_at,
    'minutes', v_notice.minutes,
    'note', v_notice.note,
    'milestone', CASE WHEN v_slot.id IS NULL THEN NULL ELSE jsonb_build_object(
      'kind', v_slot.kind, 'label', v_slot.label, 'at', v_slot.at) END,
    'seen_at', NULL,
    'seen_by', NULL);
END;
$$;
COMMENT ON FUNCTION public.report_roadsheet_late(text, integer, text) IS
  'ADR-183: «llego tarde» from a personal road sheet link. Token-only: resolves share, person and performance server-side. 42501: no such live personal link (revoked, expired, role-only, person no longer in the team). 22023: not the performance day in the venue''s zone, or bad minutes/note. 53400: over 3 notices per link per hour.';
REVOKE ALL ON FUNCTION public.report_roadsheet_late(text, integer, text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.report_roadsheet_late(text, integer, text) TO anon, authenticated;

-- ── 5 · producción ──────────────────────────────────────────────────────────
-- Los avisos abiertos (sin «Visto», de las últimas 24 h) de las funciones que
-- el que llama lee, el más nuevo primero. `can_edit`: puede mover la hora.
CREATE FUNCTION public.roadsheet_late_notices()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_out    jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id,
           'created_at', n.created_at,
           'person_name', n.person_name,
           'person_role', n.person_role,
           'phone', coalesce(
             (SELECT nullif(btrim(wp.phone), '') FROM public.workspace_person wp
              WHERE wp.workspace_id = n.workspace_id AND wp.person_id = n.person_id AND wp.deleted_at IS NULL LIMIT 1),
             (SELECT nullif(btrim(pe.phone), '') FROM public.person pe WHERE pe.id = n.person_id)),
           'minutes', n.minutes,
           'note', n.note,
           'milestone', CASE WHEN n.milestone_at IS NULL THEN NULL ELSE jsonb_build_object(
             'kind', n.milestone_kind, 'label', n.milestone_label, 'at', n.milestone_at) END,
           'moved_to', n.moved_to,
           'timezone', private.performance_timezone(pf.id),
           'performance', jsonb_build_object(
             'id', pf.id, 'slug', pf.slug, 'performed_at', pf.performed_at,
             'venue_name', coalesce(v.name, pf.venue_name), 'city', coalesce(v.city, pf.city),
             'workspace_slug', w.slug),
           'can_edit', public.has_permission(n.project_id, 'edit:performance'))
         ORDER BY n.created_at DESC), '[]'::jsonb)
  INTO v_out
  FROM public.roadsheet_late_notice n
  JOIN public.performance pf ON pf.id = n.performance_id AND pf.deleted_at IS NULL
  JOIN public.workspace w ON w.id = n.workspace_id
  LEFT JOIN public.venue v ON v.id = pf.venue_id AND v.deleted_at IS NULL
  WHERE n.seen_at IS NULL
    AND n.created_at > now() - interval '24 hours'
    AND n.workspace_id IN (
      SELECT m.workspace_id FROM public.membership m
      WHERE m.user_id = v_caller AND m.accepted_at IS NOT NULL)
    AND public.has_permission(n.project_id, 'read:performance')
    -- Sólo el último aviso de cada persona en cada función.
    AND NOT EXISTS (
      SELECT 1 FROM public.roadsheet_late_notice later
      WHERE later.share_id = n.share_id
        AND (later.created_at, later.id) > (n.created_at, n.id));

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.roadsheet_late_notices() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.roadsheet_late_notices() TO authenticated;

-- «Visto»: el primero que lo marca queda; la hoja del técnico lo dice.
CREATE FUNCTION public.mark_roadsheet_late_seen(p_notice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_project uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT n.project_id INTO v_project FROM public.roadsheet_late_notice n WHERE n.id = p_notice_id;
  IF v_project IS NULL OR NOT public.has_permission(v_project, 'read:performance') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.roadsheet_late_notice
  SET seen_at = now(), seen_by = auth.uid()
  WHERE id = p_notice_id AND seen_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_roadsheet_late_seen(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mark_roadsheet_late_seen(uuid) TO authenticated;

-- Lo que «Mover <hito> a HH:MM» propone: el momento, su hora al avisar y la
-- nueva (la de entonces más los minutos). Sólo quien edita la función; sin
-- hito, sin minutos o ya movido, 22023.
CREATE FUNCTION public.roadsheet_late_move_plan(p_notice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_n public.roadsheet_late_notice;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_n FROM public.roadsheet_late_notice WHERE id = p_notice_id;
  IF v_n.id IS NULL OR NOT public.has_permission(v_n.project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_n.milestone_slot_id IS NULL OR v_n.minutes IS NULL OR v_n.moved_at IS NOT NULL THEN
    RAISE EXCEPTION 'nothing to move' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'performance_id', v_n.performance_id,
    'slot_id', v_n.milestone_slot_id,
    'from', v_n.milestone_at,
    'to', v_n.milestone_at + make_interval(mins => v_n.minutes));
END;
$$;
REVOKE ALL ON FUNCTION public.roadsheet_late_move_plan(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.roadsheet_late_move_plan(uuid) TO authenticated;

-- Apunta el movimiento ya hecho en el documento: sólo el que el plan propone,
-- una vez. Lo marca visto y deja la línea en el grupo con su autor.
CREATE FUNCTION public.record_roadsheet_late_move(p_notice_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_n      public.roadsheet_late_notice;
  v_tz     text;
  v_by     text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_n FROM public.roadsheet_late_notice WHERE id = p_notice_id FOR UPDATE;
  IF v_n.id IS NULL OR NOT public.has_permission(v_n.project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_n.milestone_slot_id IS NULL OR v_n.minutes IS NULL OR v_n.moved_at IS NOT NULL
     OR p_from IS DISTINCT FROM v_n.milestone_at
     OR p_to IS DISTINCT FROM v_n.milestone_at + make_interval(mins => v_n.minutes) THEN
    RAISE EXCEPTION 'not the proposed move' USING ERRCODE = '22023';
  END IF;

  UPDATE public.roadsheet_late_notice
  SET moved_at = now(), moved_by = v_caller, moved_from = p_from, moved_to = p_to,
      seen_at = coalesce(seen_at, now()), seen_by = coalesce(seen_by, v_caller)
  WHERE id = p_notice_id;

  v_tz := private.performance_timezone(v_n.performance_id);
  SELECT nullif(btrim(up.full_name), '') INTO v_by FROM public.user_profile up WHERE up.user_id = v_caller;
  PERFORM private.post_late_line(
    p_notice_id, 'late_moved', v_caller,
    coalesce(v_by, '?') || ' movió ' || coalesce(private.moment_word_es(v_n.milestone_kind, v_n.milestone_label), '?')
      || ' de ' || to_char(p_from AT TIME ZONE v_tz, 'HH24:MI')
      || ' a ' || to_char(p_to AT TIME ZONE v_tz, 'HH24:MI'));
END;
$$;
REVOKE ALL ON FUNCTION public.record_roadsheet_late_move(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_roadsheet_late_move(uuid, timestamptz, timestamptz) TO authenticated;

-- ── 6 · la hoja pública ──────────────────────────────────────────────────────
-- Cuerpo vivo de 20261105120000; cambia: v_tz y v_person_role en DECLARE, y el
-- `|| jsonb_build_object('late_moves', …) || CASE … holder/late …` del final.
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
  v_contacts := v_share.role = 'tech_manager';
  v_tz := private.performance_timezone(v_share.performance_id);
  IF v_share.person_id IS NOT NULL THEN
    v_person_role := private.roadsheet_person_role(v_share.performance_id, v_share.person_id);
  END IF;

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
