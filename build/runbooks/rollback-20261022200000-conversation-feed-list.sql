-- Rollback de 20261022200000_conversation_feed_list (plan de la lista, fase 3).
-- Devuelve `conversation_feed` a la de 20261021100000 (la de producción el
-- 2026-10-22, md5 de pg_get_functiondef 3b04ae42d785835bbd5f9d6b1ba715e3) y borra
-- la colación del orden por nombre. Sin datos: solo una función de lectura.
-- Desplegar ANTES el Worker anterior a la fase 3 (el que lee la lista con
-- `loadOverviewRows`): el de la fase 3 llama con `p_list` y, sin él, la lista de
-- la lente da 4xx/5xx. Todas (`/api/conversations/feed`) sigue valiendo con los
-- dos: solo usa los cinco parámetros de siempre.
-- Probado ida y vuelta en local el 2026-10-22 (migración, rollback, migración,
-- dentro de una transacción con ROLLBACK; tras el rollback el md5 coincide).

BEGIN;

DROP FUNCTION public.conversation_feed(uuid[], uuid[], text, text, int, boolean, int, text, text, text, text, boolean, uuid[], text, text, uuid, text, boolean);
DROP COLLATION private.list_name;

CREATE FUNCTION public.conversation_feed(
  p_workspace_ids uuid[] DEFAULT NULL,
  p_project_ids   uuid[] DEFAULT NULL,
  p_tag           text   DEFAULT NULL,
  p_q             text   DEFAULT NULL,
  p_limit         int    DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_all     boolean := coalesce(cardinality(p_workspace_ids), 0) = 0
                   AND coalesce(cardinality(p_project_ids), 0) = 0;
  v_tag     text := nullif(btrim(coalesce(p_tag, '')), '');
  v_q       text := lower(nullif(btrim(coalesce(p_q, '')), ''));
  v_limit   int  := greatest(1, least(coalesce(p_limit, 100), 500));
  v_convs   boolean;
  v_threads boolean;
  v_items   jsonb := '[]'::jsonb;
  v_n       int := 0;
  v_more    boolean := false;
  v_extra   jsonb;
  rec       record;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_tag = 'all' THEN
    v_tag := NULL;
  END IF;
  IF v_tag IS NOT NULL AND v_tag <> 'team' AND v_tag !~ '^[a-z][a-z0-9_]{1,31}$' THEN
    RAISE EXCEPTION 'invalid tag %', v_tag USING ERRCODE = '22023';
  END IF;
  v_convs   := v_tag IS DISTINCT FROM 'team';
  v_threads := v_tag IS NULL OR v_tag = 'team';

  -- Las candidatas, ya en su orden: el corte por espacio, el alcance, la
  -- etiqueta y la búsqueda, con lo que ordena (no leídos, te toca, lo último).
  -- La regla de lectura NO va aquí: corre abajo, fila a fila y en este orden,
  -- hasta llenar la página. Así cuesta lo que la página, no lo que el espacio
  -- (con 20.000 hilos, evaluarla en todos eran ~5 s; ver el runbook).
  FOR rec IN
    WITH ws AS MATERIALIZED (
      -- Toda lectura de conversaciones e hilos exige ser miembro aceptado del
      -- espacio (`model_has_permission`, `thread_feed`).
      SELECT m.workspace_id
      FROM public.membership m
      WHERE m.level = 'workspace' AND m.user_id = v_caller AND m.accepted_at IS NOT NULL
    ),
    conv_cand AS (
      SELECT c.id, c.workspace_id, c.project_id, c.line_id, c.created_at,
             c.last_contacted_at, c.next_action_at, c.next_action_note, c.reply_settled_at,
             c.not_now_at, c.not_now_until
      FROM public.conversation c
      JOIN ws ON ws.workspace_id = c.workspace_id
      WHERE v_convs
        AND c.deleted_at IS NULL
        AND (v_all
             OR c.workspace_id = ANY (coalesce(p_workspace_ids, '{}'))
             OR c.project_id = ANY (coalesce(p_project_ids, '{}')))
        -- La etiqueta acota; nunca abre (la regla va después, con AND).
        AND (v_tag IS NULL
             OR EXISTS (
                  SELECT 1 FROM public.conversation_tagging g
                  JOIN public.conversation_tag t ON t.id = g.tag_id
                  WHERE g.conversation_id = c.id AND t.key = v_tag)
             OR (v_tag = 'sales'
                 AND NOT EXISTS (SELECT 1 FROM public.conversation_tagging g WHERE g.conversation_id = c.id)))
        AND (v_q IS NULL
             OR EXISTS (
                  SELECT 1 FROM public.workspace_organization o
                  WHERE o.workspace_id = c.workspace_id AND o.id = c.organization_id
                    AND strpos(lower(o.name), v_q) > 0)
             OR EXISTS (
                  SELECT 1
                  FROM public.conversation_contact cc
                  JOIN public.workspace_person wp
                    ON wp.workspace_id = cc.workspace_id AND wp.person_id = cc.person_id
                   AND wp.deleted_at IS NULL
                  WHERE cc.conversation_id = c.id
                    AND (strpos(lower(wp.full_name), v_q) > 0
                         OR strpos(lower(coalesce(wp.email::text, '')), v_q) > 0))
             OR EXISTS (
                  SELECT 1 FROM public.project p
                  WHERE p.id = c.project_id AND strpos(lower(coalesce(p.name, p.slug)), v_q) > 0)
             OR EXISTS (
                  SELECT 1 FROM public.line l
                  WHERE l.id = c.line_id AND strpos(lower(l.name), v_q) > 0))
    ),
    conv_rows AS (
      SELECT c.*,
             lt.direction AS last_direction, lt.occurred_at AS last_occurred_at, lt.kind AS last_kind,
             lt.subject AS last_subject,
             li.occurred_at AS last_in_at,
             coalesce(ev.unread, 0) AS event_unread,
             th.id AS thread_id, th.last_message_at AS thread_last_at, coalesce(th.unread, 0) AS thread_unread,
             -- «No esta vez» en vigor (`notNowInForce`): no ha llegado su día y no han vuelto a escribir.
             (c.not_now_at IS NOT NULL
              AND (c.not_now_until IS NULL OR c.not_now_until > current_date)
              AND (li.occurred_at IS NULL OR li.occurred_at <= c.not_now_at)) AS not_now
      FROM conv_cand c
      LEFT JOIN public.conversation_read cr ON cr.conversation_id = c.id AND cr.user_id = v_caller
      -- El último correo, mensaje o llamada con dirección, no automático: el turno.
      LEFT JOIN LATERAL (
        SELECT e.direction::text AS direction, e.occurred_at, e.kind::text AS kind, e.metadata->>'subject' AS subject
        FROM public.conversation_event e
        WHERE e.conversation_id = c.id
          AND e.direction IS NOT NULL
          AND e.kind::text IN ('email', 'message', 'call')
          AND e.metadata->>'auto' IS NULL
        ORDER BY e.occurred_at DESC, e.recorded_at DESC
        LIMIT 1
      ) lt ON true
      -- El último que vino de fuera: si han contestado, y si «no esta vez» caducó.
      LEFT JOIN LATERAL (
        SELECT e.occurred_at
        FROM public.conversation_event e
        WHERE e.conversation_id = c.id
          AND e.direction = 'inbound'
          AND e.kind::text IN ('email', 'message', 'call')
          AND e.metadata->>'auto' IS NULL
        ORDER BY e.occurred_at DESC, e.recorded_at DESC
        LIMIT 1
      ) li ON true
      -- No leídos del registro.
      LEFT JOIN LATERAL (
        SELECT count(*) AS unread
        FROM public.conversation_event e
        WHERE e.conversation_id = c.id
          AND e.direction = 'inbound'
          AND e.metadata->>'auto' IS NULL
          AND NOT (e.source = 'manual' AND e.created_by IS NOT DISTINCT FROM v_caller)
          AND e.recorded_at > coalesce(cr.last_read_at, c.created_at)
      ) ev ON true
      -- Su hilo del equipo: el General de la conversación, que se lee como ella
      -- (`thread_readable`), con mensajes vivos.
      LEFT JOIN LATERAL (
        SELECT t.id, t.last_message_at, cnt.unread
        FROM public.thread t
        LEFT JOIN public.thread_read tr ON tr.thread_id = t.id AND tr.user_id = v_caller
        CROSS JOIN LATERAL (
          SELECT count(*) AS total,
                 count(*) FILTER (
                   WHERE msg.author_id IS DISTINCT FROM v_caller
                     AND (tr.last_read_at IS NULL OR msg.created_at > tr.last_read_at)
                 ) AS unread
          FROM public.message msg
          WHERE msg.thread_id = t.id AND msg.deleted_at IS NULL
        ) cnt
        WHERE t.conversation_id = c.id AND t.facet_id IS NULL AND cnt.total > 0
        LIMIT 1
      ) th ON true
    ),
    conv_feed AS (
      SELECT 'conversation'::text AS kind, r.id, r.id AS conversation_id, NULL::uuid AS bolo_id, NULL::uuid AS facet_id,
             (r.event_unread + r.thread_unread) AS unread,
             -- `dueReason`: una respuesta pendiente (no atendida) o un seguimiento
             -- vencido, fuera de «no esta vez». Nunca NULL: un NULL va primero en DESC.
             coalesce(NOT r.not_now
               AND ((r.last_direction = 'inbound'
                     AND (r.reply_settled_at IS NULL OR r.last_occurred_at > r.reply_settled_at))
                    OR (r.next_action_at IS NOT NULL AND r.next_action_at::date <= current_date)), false) AS due,
             coalesce(greatest(r.last_occurred_at, r.last_in_at, r.thread_last_at, r.last_contacted_at),
                      r.created_at) AS sort_at,
             greatest(r.last_occurred_at, r.last_in_at, r.thread_last_at, r.last_contacted_at) AS last_at,
             jsonb_build_object(
               'kind', 'conversation',
               'id', r.id,
               'workspace_id', r.workspace_id,
               'project_id', r.project_id,
               'line_id', r.line_id,
               'created_at', r.created_at,
               'unread_count', r.event_unread + r.thread_unread,
               'event_unread', r.event_unread,
               'thread_unread', r.thread_unread,
               'thread_id', r.thread_id,
               'last', CASE WHEN r.last_occurred_at IS NULL THEN NULL ELSE jsonb_build_object(
                         'direction', r.last_direction,
                         'occurred_at', r.last_occurred_at,
                         'kind', r.last_kind,
                         'subject', r.last_subject) END,
               'last_in', CASE WHEN r.last_in_at IS NULL THEN NULL
                               ELSE jsonb_build_object('occurred_at', r.last_in_at) END,
               'last_at', greatest(r.last_occurred_at, r.last_in_at, r.thread_last_at, r.last_contacted_at),
               'last_contacted_at', r.last_contacted_at,
               'reply_settled_at', r.reply_settled_at,
               'next_action_at', r.next_action_at,
               'next_action_note', r.next_action_note,
               'not_now_at', r.not_now_at,
               'not_now_until', r.not_now_until) AS d
      FROM conv_rows r
    ),
    thread_cand AS (
      -- El prefiltro de `thread_feed`: espacio, con mensajes, ancla de bolo o de
      -- conversación viva, alcance. Con conversaciones en la lista, el hilo de
      -- una conversación va dentro de su fila y no sale aparte.
      SELECT t.id, t.workspace_id, t.bolo_id, t.conversation_id, t.facet_id, t.last_message_at,
             coalesce(b.project_id, c.project_id) AS project_id
      FROM public.thread t
      JOIN ws ON ws.workspace_id = t.workspace_id
      LEFT JOIN public.bolo b ON b.id = t.bolo_id AND b.deleted_at IS NULL
      LEFT JOIN public.conversation c ON c.id = t.conversation_id AND c.deleted_at IS NULL
      WHERE v_threads
        AND t.last_message_at IS NOT NULL
        AND (b.id IS NOT NULL OR (c.id IS NOT NULL AND NOT v_convs))
        AND (v_all
             OR t.workspace_id = ANY (coalesce(p_workspace_ids, '{}'))
             OR coalesce(b.project_id, c.project_id) = ANY (coalesce(p_project_ids, '{}')))
        AND (v_q IS NULL
             OR strpos(lower(coalesce(b.venue_name, '')), v_q) > 0
             OR strpos(lower(coalesce(b.city, '')), v_q) > 0
             OR EXISTS (
                  SELECT 1 FROM public.project p
                  WHERE p.id = coalesce(b.project_id, c.project_id)
                    AND strpos(lower(coalesce(p.name, p.slug)), v_q) > 0)
             OR EXISTS (
                  SELECT 1 FROM public.workspace_organization o
                  WHERE o.workspace_id = c.workspace_id AND o.id = c.organization_id
                    AND strpos(lower(o.name), v_q) > 0))
    ),
    thread_feed_rows AS (
      SELECT 'thread'::text AS kind, x.id, x.conversation_id, x.bolo_id, x.facet_id,
             cnt.unread, false AS due, x.last_message_at AS sort_at, x.last_message_at AS last_at,
             jsonb_build_object(
               'kind', 'thread',
               'thread_id', x.id,
               'workspace_id', x.workspace_id,
               'project_id', x.project_id,
               'anchor_kind', CASE WHEN x.bolo_id IS NOT NULL THEN 'bolo' ELSE 'conversation' END,
               'anchor_id', coalesce(x.bolo_id, x.conversation_id),
               'facet_id', x.facet_id,
               'message_count', cnt.total,
               'unread_count', cnt.unread,
               'last_message_at', x.last_message_at) AS d
      FROM thread_cand x
      LEFT JOIN public.thread_read tr ON tr.thread_id = x.id AND tr.user_id = v_caller
      CROSS JOIN LATERAL (
        SELECT count(*) AS total,
               count(*) FILTER (
                 WHERE msg.author_id IS DISTINCT FROM v_caller
                   AND (tr.last_read_at IS NULL OR msg.created_at > tr.last_read_at)
               ) AS unread
        FROM public.message msg
        WHERE msg.thread_id = x.id AND msg.deleted_at IS NULL
      ) cnt
      WHERE cnt.total > 0
    )
    SELECT f.*
    FROM (SELECT * FROM conv_feed UNION ALL SELECT * FROM thread_feed_rows) f
    ORDER BY (f.unread > 0) DESC, f.due DESC, f.sort_at DESC, f.id
  LOOP
    -- La regla de cada fila, la de su política: `conversation_select` o
    -- `thread_select`. Lo que no pasa no sale, ni sus no leídos ni su nombre.
    CONTINUE WHEN NOT CASE rec.kind
      WHEN 'conversation' THEN private.can_read_conversation(rec.id, v_caller)
      ELSE private.thread_readable(rec.conversation_id, NULL, NULL, rec.bolo_id, rec.facet_id, v_caller)
    END;

    IF v_n = v_limit THEN
      v_more := true;
      EXIT;
    END IF;
    v_n := v_n + 1;

    IF rec.kind = 'conversation' THEN
      -- Con quién (la organización o el contacto principal) y sus etiquetas.
      SELECT jsonb_build_object(
               'title', ct.title,
               'person', CASE WHEN ct.person IS DISTINCT FROM ct.title THEN ct.person END,
               'tags', coalesce(tg.keys, '[]'::jsonb),
               'due', rec.due)
      INTO v_extra
      FROM (
        SELECT coalesce(o.name, wp.full_name, pe.full_name, pe.organization_name) AS title,
               coalesce(wp.full_name, pe.full_name) AS person
        FROM public.conversation c
        LEFT JOIN public.workspace_organization o ON o.id = c.organization_id AND o.deleted_at IS NULL
        LEFT JOIN public.conversation_contact cc ON cc.conversation_id = c.id AND cc.is_primary
        LEFT JOIN public.person pe ON pe.id = cc.person_id
        LEFT JOIN public.workspace_person wp ON wp.workspace_id = c.workspace_id AND wp.person_id = cc.person_id
        WHERE c.id = rec.id
        LIMIT 1
      ) ct
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(DISTINCT t.key) AS keys
        FROM public.conversation_tagging g
        JOIN public.conversation_tag t ON t.id = g.tag_id
        WHERE g.conversation_id = rec.id
      ) tg ON true;
    ELSE
      -- La forma de `thread_feed`, sin dinero (ADR-106 § 1).
      SELECT jsonb_build_object(
               'facet_key', f.key,
               'label', coalesce(fs.label, f.label),
               'labels', CASE WHEN f.id IS NULL THEN '{}'::jsonb
                              ELSE f.labels || coalesce(fs.labels, '{}'::jsonb) END,
               'last_message', jsonb_build_object(
                 'author_id', lm.author_id,
                 'body', left(lm.body, 280),
                 'created_at', lm.created_at),
               'bolo', CASE WHEN rec.bolo_id IS NULL THEN NULL ELSE jsonb_build_object(
                 'venue_name', b.venue_name,
                 'city', b.city,
                 'first_day', pd.first_day,
                 'last_day', pd.last_day,
                 'performance_slug', pt.slug,
                 'performance_id', pt.id) END,
               'conversation', CASE WHEN rec.conversation_id IS NULL THEN NULL ELSE jsonb_build_object(
                 'title', ct.title) END)
      INTO v_extra
      FROM (SELECT 1) one
      LEFT JOIN public.facet f ON f.id = rec.facet_id
      LEFT JOIN public.workspace_facet_setting fs
        ON fs.workspace_id = (rec.d->>'workspace_id')::uuid AND fs.facet_id = rec.facet_id
      LEFT JOIN public.bolo b ON b.id = rec.bolo_id
      LEFT JOIN LATERAL (
        SELECT msg.author_id, msg.body, msg.created_at
        FROM public.message msg
        WHERE msg.thread_id = rec.id AND msg.deleted_at IS NULL
        ORDER BY msg.created_at DESC, msg.id DESC
        LIMIT 1
      ) lm ON true
      LEFT JOIN LATERAL (
        SELECT min(pf.performed_at) AS first_day, max(pf.performed_at) AS last_day
        FROM public.performance pf
        WHERE pf.bolo_id = rec.bolo_id AND pf.deleted_at IS NULL
      ) pd ON rec.bolo_id IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT pf.id, pf.slug
        FROM public.performance pf
        WHERE pf.bolo_id = rec.bolo_id AND pf.deleted_at IS NULL
        ORDER BY pf.performed_at < current_date,
                 CASE WHEN pf.performed_at >= current_date THEN pf.performed_at END,
                 pf.performed_at DESC, pf.id
        LIMIT 1
      ) pt ON rec.bolo_id IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT coalesce(o.name, wp.full_name, pe.full_name, pe.organization_name) AS title
        FROM public.conversation c
        LEFT JOIN public.workspace_organization o ON o.id = c.organization_id AND o.deleted_at IS NULL
        LEFT JOIN public.conversation_contact cc ON cc.conversation_id = c.id AND cc.is_primary
        LEFT JOIN public.person pe ON pe.id = cc.person_id
        LEFT JOIN public.workspace_person wp ON wp.workspace_id = c.workspace_id AND wp.person_id = cc.person_id
        WHERE c.id = rec.conversation_id
        LIMIT 1
      ) ct ON rec.conversation_id IS NOT NULL;
    END IF;

    v_items := v_items || jsonb_build_array(rec.d || v_extra);
  END LOOP;

  RETURN jsonb_build_object('items', v_items, 'more', v_more);
END;
$$;

COMMENT ON FUNCTION public.conversation_feed(uuid[], uuid[], text, text, int) IS
  'ADR-138 fase 3: la lectura común de Conversaciones. Conversaciones (private.can_read_conversation, la regla de conversation_select) e hilos de bolo o de conversación con mensajes (private.thread_readable, la de thread_select) en una sola lista: no leídos arriba, después te toca, después lo último. Alcance, etiqueta (acota, nunca abre) y búsqueda en las dos fuentes. Sin dinero. SECURITY DEFINER: corte por espacio primero y la regla fila a fila hasta llenar la página.';

REVOKE ALL ON FUNCTION public.conversation_feed(uuid[], uuid[], text, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conversation_feed(uuid[], uuid[], text, text, int) TO authenticated, service_role;

COMMIT;
