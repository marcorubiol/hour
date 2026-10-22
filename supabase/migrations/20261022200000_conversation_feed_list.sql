-- La lista de Conversaciones lee una sola fuente (plan
-- `build/plans/2026-10-22-conversations-list.md` § 8 y § 9, fase 3).
--
-- Hasta aquí la lista mezclaba dos lecturas: `conversation_feed` daba el orden
-- y los no leídos (cortado a 500) y el Worker leía el alcance entero por
-- PostgREST (`loadOverviewRows`) para la relación, la temporada, el turno y la
-- temperatura, o cuando el feed se pasaba de 500. Ahora `conversation_feed`
-- acepta esos filtros, ordena con los cuatro órdenes del menú (y los filtros de
-- bloque en el orden de su bloque, ADR-118 § 7), cuenta el total y pagina. La
-- lectura derivada del Worker queda para el panel (`/api/conversations/overview`).
--
-- Firma y cuerpo copiados de la base viva (`pg_get_functiondef` en
-- `lqlyorlccnniybezugme`, 2026-10-22; md5 3b04ae42d785835bbd5f9d6b1ba715e3, igual
-- que `20261021100000`), no de la migración. La entrada crece (parámetros nuevos,
-- todos con valor por defecto): `CREATE OR REPLACE` con otra lista de argumentos
-- crearía una sobrecarga y PostgREST respondería 300, así que DROP y CREATE en la
-- misma transacción, con los grants explícitos. Quien llama con los cinco de
-- antes (`/api/conversations/feed`, Todas) recibe lo mismo que antes, más tres
-- claves por conversación: `relation`, `contact_role` y `city`.
--
-- Modo lista (`p_list = true`): solo conversaciones (con `p_tag = 'team'` es
-- 22023), los filtros y el orden de abajo, `p_offset`, y la regla de lectura
-- en TODAS las candidatas que pasan los filtros, para contar `total` (la página
-- se arma solo con las de la ventana). Devuelve `{ items, more, total }`; con
-- `p_ids_only`, `items` son `{ id, project_id }`, hasta 1.000 (`MATCHING_MAX`,
-- «seleccionar las N que coinciden»). Fuera del modo lista, los parámetros
-- nuevos son 22023: el feed de Todas no cambia.
--
-- Las reglas son las de `$lib/conversation-overview` y
-- `$lib/conversation-relation`, escritas en SQL; cambian juntas (el test RLS
-- `conversation-feed-list.test.ts` compara cada filtro con la lectura del panel).
-- Días de calendario en UTC (`current_date`), como `relation_of`:
--   · relación: `private.relation_of` con los hechos de la fila (la misma que
--     `conversation_relation_for`);
--   · te toca (`p_turn = 'nuestro'`): respuesta pendiente (lo último con
--     dirección es de fuera y no está atendido) o seguimiento de hoy o vencido,
--     fuera de «no esta vez». Les toca (`suyo`): lo último es nuestro;
--   · caliente: nos escribieron en 14 días, o han contestado alguna vez y hay
--     movimiento en 14; se enfría: les toca hace 21 días o más (o, sin
--     historial y sin respuesta, el sello de contacto tiene 21), o han
--     contestado y llevan 30 parados; `ronda` las que nunca contestaron,
--     `parada` las que sí; sin fecha: hablada, sin ningún evento, sello ni
--     seguimiento;
--   · temporada: de septiembre a agosto; una conversación sin funciones vivas
--     (directas, no canceladas, que quien llama lee: `performance_select`) es de
--     la temporada; con `p_season_line_ids`, solo esas líneas;
--   · línea: un uuid, o 'sin' para las que no tienen;
--   · envío: las destinatarias de un envío que quien llama lee
--     (`private.mailout_for_caller`, la puerta de `mailout_preview`): todas a las
--     que salió, las que contestaron después, las que no, las que rebotaron.
--
-- Orden (`p_order`): `pide` (no leídos, te toca con las respuestas primero, la
-- más reciente arriba, y después los seguimientos, el más vencido primero,
-- después lo último), `movimiento`, `paso` (próximo paso, el más cercano
-- primero), `nombre` (colación ICU de nivel 1 con números, la de `Intl.Collator`
-- con `sensitivity: 'base', numeric: true`). Con te toca, les toca, caliente o
-- se enfría, el orden es el de su bloque. A igualdad, por id.
--
-- Funciones existentes que se llaman, sin redefinir (firmas de producción):
-- `private.can_read_conversation(uuid, uuid)`, `private.thread_readable(uuid,
-- uuid, uuid, uuid, uuid, uuid)`, `private.relation_of(timestamptz, date,
-- timestamptz, timestamptz, boolean, boolean, boolean, date)`,
-- `private.organization_is_regular(uuid, uuid, date)`,
-- `private.mailout_for_caller(uuid, boolean)`,
-- `private.performance_readable_through_chain_by_caller(uuid)`,
-- `public.has_permission(uuid, text)`.
--
-- ADITIVA según § 34: una función de lectura redefinida y una colación nueva;
-- ninguna tabla ni política. El Worker de la fase 3 llama con los parámetros
-- nuevos: la migración va antes del deploy (el Worker de hoy sigue valiendo con
-- ella: solo usa los cinco de antes).
-- Rollback: build/runbooks/rollback-20261022200000-conversation-feed-list.sql.

CREATE COLLATION private.list_name (provider = icu, locale = 'und-u-ks-level1-kn-true', deterministic = false);

COMMENT ON COLLATION private.list_name IS
  'Plan de la lista § 4: el orden por nombre, sin mayúsculas ni acentos y con números (Intl.Collator sensitivity base, numeric).';

DROP FUNCTION public.conversation_feed(uuid[], uuid[], text, text, int);

CREATE FUNCTION public.conversation_feed(
  p_workspace_ids   uuid[]  DEFAULT NULL,
  p_project_ids     uuid[]  DEFAULT NULL,
  p_tag             text    DEFAULT NULL,
  p_q               text    DEFAULT NULL,
  p_limit           int     DEFAULT 100,
  p_list            boolean DEFAULT false,
  p_offset          int     DEFAULT 0,
  p_order           text    DEFAULT NULL,
  p_status          text    DEFAULT NULL,
  p_relation        text    DEFAULT NULL,
  p_line            text    DEFAULT NULL,
  p_season          boolean DEFAULT false,
  p_season_line_ids uuid[]  DEFAULT NULL,
  p_turn            text    DEFAULT NULL,
  p_temp            text    DEFAULT NULL,
  p_mailout_id      uuid    DEFAULT NULL,
  p_mailout_pick    text    DEFAULT NULL,
  p_ids_only        boolean DEFAULT false
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
  v_list    boolean := coalesce(p_list, false);
  v_offset  int  := greatest(0, coalesce(p_offset, 0));
  v_ids     boolean := coalesce(p_ids_only, false);
  v_season  boolean := coalesce(p_season, false);
  v_sort    text;
  v_line_id uuid;
  v_s_start date;
  v_s_end   date;
  v_mailout public.mailout;
  v_pick    text;
  v_total   int := 0;
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

  -- Lo de la lista solo va con la lista: el feed de Todas no cambia.
  IF NOT v_list AND (v_offset <> 0 OR p_order IS NOT NULL OR p_status IS NOT NULL OR p_relation IS NOT NULL
                     OR p_line IS NOT NULL OR v_season OR p_season_line_ids IS NOT NULL OR p_turn IS NOT NULL
                     OR p_temp IS NOT NULL OR p_mailout_id IS NOT NULL OR p_mailout_pick IS NOT NULL OR v_ids) THEN
    RAISE EXCEPTION 'list filters need p_list' USING ERRCODE = '22023';
  END IF;
  IF v_list AND v_tag = 'team' THEN
    RAISE EXCEPTION 'the list has no team threads' USING ERRCODE = '22023';
  END IF;
  IF p_order IS NOT NULL AND p_order NOT IN ('pide', 'movimiento', 'paso', 'nombre') THEN
    RAISE EXCEPTION 'invalid order %', p_order USING ERRCODE = '22023';
  END IF;
  IF p_relation IS NOT NULL AND p_relation NOT IN ('never', 'contacted', 'talking', 'regular', 'dormant', 'not_now') THEN
    RAISE EXCEPTION 'invalid relation %', p_relation USING ERRCODE = '22023';
  END IF;
  IF p_turn IS NOT NULL AND p_turn NOT IN ('nuestro', 'suyo') THEN
    RAISE EXCEPTION 'invalid turn %', p_turn USING ERRCODE = '22023';
  END IF;
  IF p_temp IS NOT NULL AND p_temp NOT IN ('caliente', 'fria', 'ronda', 'parada', 'sin-fecha') THEN
    RAISE EXCEPTION 'invalid temperature %', p_temp USING ERRCODE = '22023';
  END IF;
  IF p_mailout_pick IS NOT NULL AND (p_mailout_id IS NULL
       OR p_mailout_pick NOT IN ('todos', 'respuestas', 'sin-respuesta', 'rebotes')) THEN
    RAISE EXCEPTION 'invalid mailout pick %', p_mailout_pick USING ERRCODE = '22023';
  END IF;
  IF p_line IS NOT NULL THEN
    IF p_line ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      v_line_id := p_line::uuid;
    ELSIF p_line <> 'sin' THEN
      RAISE EXCEPTION 'invalid line %', p_line USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_status IS NOT NULL
     AND NOT p_status = ANY (enum_range(NULL::public.conversation_status)::text[]) THEN
    RAISE EXCEPTION 'invalid status %', p_status USING ERRCODE = '22023';
  END IF;

  IF p_mailout_id IS NOT NULL THEN
    -- La puerta de `mailout_preview`: un envío que no lees es 42501.
    v_mailout := private.mailout_for_caller(p_mailout_id, false);
    v_pick := coalesce(p_mailout_pick, 'todos');
  END IF;

  v_s_start := make_date(extract(year FROM current_date)::int - (extract(month FROM current_date) < 9)::int, 9, 1);
  v_s_end := (v_s_start + interval '1 year' - interval '1 day')::date;

  -- El orden: el feed de Todas el de siempre; la lista el del menú, o el de su
  -- bloque (applyListFilter: la temperatura manda sobre el turno; «sin fecha»
  -- no ordena).
  v_sort := CASE
    WHEN NOT v_list THEN 'feed'
    WHEN p_temp = 'caliente' THEN 'hot'
    WHEN p_temp IN ('fria', 'ronda', 'parada') THEN 'cold'
    WHEN p_turn = 'nuestro' THEN 'due'
    WHEN p_turn = 'suyo' THEN 'theirs'
    WHEN p_temp = 'sin-fecha' THEN 'id'
    ELSE coalesce(p_order, 'pide')
  END;

  v_convs   := v_tag IS DISTINCT FROM 'team';
  v_threads := NOT v_list AND (v_tag IS NULL OR v_tag = 'team');

  -- Las candidatas, ya en su orden: el corte por espacio, el alcance, la
  -- etiqueta, la búsqueda y los filtros, con lo que ordena. La regla de lectura
  -- NO va aquí: corre abajo, fila a fila y en este orden (en el feed, hasta
  -- llenar la página; en la lista, en todas, para contar el total).
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
             c.not_now_at, c.not_now_until,
             c.organization_id, c.first_contacted_at, c.contacted_undated,
             c.custom_fields->>'legacy_status' AS legacy_status
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
        -- Los filtros de la lista que no leen el historial.
        AND (p_status IS NULL OR c.status::text = p_status)
        AND (p_line IS NULL
             OR (v_line_id IS NULL AND c.line_id IS NULL)
             OR c.line_id = v_line_id)
        AND (NOT v_season
             OR coalesce(cardinality(p_season_line_ids), 0) = 0
             OR c.line_id = ANY (p_season_line_ids))
        -- La temporada: sin funciones que quien llama lea, o con una en ella.
        AND (NOT v_season
             OR NOT EXISTS (
                  SELECT 1 FROM public.performance pf
                  WHERE pf.conversation_id = c.id AND pf.deleted_at IS NULL AND pf.status <> 'cancelled'
                    AND (public.has_permission(pf.project_id, 'read:performance')
                         OR private.performance_readable_through_chain_by_caller(pf.id)))
             OR EXISTS (
                  SELECT 1 FROM public.performance pf
                  WHERE pf.conversation_id = c.id AND pf.deleted_at IS NULL AND pf.status <> 'cancelled'
                    AND pf.performed_at BETWEEN v_s_start AND v_s_end
                    AND (public.has_permission(pf.project_id, 'read:performance')
                         OR private.performance_readable_through_chain_by_caller(pf.id))))
        -- El envío: solo quien lo recibió (la tanda exacta, abajo).
        AND (p_mailout_id IS NULL
             OR EXISTS (SELECT 1 FROM public.mailout_recipient mr
                        WHERE mr.mailout_id = v_mailout.id AND mr.conversation_id = c.id))
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
              AND (li.occurred_at IS NULL OR li.occurred_at <= c.not_now_at)) AS not_now,
             -- Los hechos de la relación (`relationOf`): lo último que se movió,
             -- si han contestado y si se les escribió.
             greatest(lt.occurred_at, li.occurred_at, c.last_contacted_at) AS activity,
             (li.occurred_at IS NOT NULL
              OR coalesce(c.legacy_status IN ('in_conversation', 'hold', 'confirmed'), false)) AS answered,
             (lt.direction = 'outbound' OR c.first_contacted_at IS NOT NULL OR c.contacted_undated) IS TRUE AS wrote
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
    conv_derived AS (
      SELECT r.*,
             -- `dueReason`: una respuesta pendiente (no atendida) o un seguimiento
             -- vencido, fuera de «no esta vez».
             CASE
               WHEN r.not_now THEN NULL
               WHEN r.last_direction = 'inbound'
                    AND (r.reply_settled_at IS NULL OR r.last_occurred_at > r.reply_settled_at) THEN 'reply'
               WHEN r.next_action_at IS NOT NULL AND r.next_action_at::date <= current_date THEN 'follow_up'
             END AS due_reason,
             -- `turnOf`: de quien no escribió lo último (lo atendido no tiene turno).
             CASE
               WHEN r.last_direction IS NULL OR r.not_now THEN NULL
               WHEN r.last_direction = 'inbound'
                    AND r.reply_settled_at IS NOT NULL AND r.last_occurred_at <= r.reply_settled_at THEN NULL
               WHEN r.last_direction = 'inbound' THEN 'ours'
               ELSE 'theirs'
             END AS turn_side,
             -- La relación solo para filtrar; la de la página se calcula al armarla.
             CASE WHEN p_relation IS NOT NULL THEN
               private.relation_of(r.not_now_at, r.not_now_until, r.last_in_at, r.activity, r.wrote, r.answered,
                                   private.organization_is_regular(r.workspace_id, r.organization_id, current_date),
                                   current_date)
             END AS relation,
             -- Para el orden por nombre: con quién (la organización o el contacto principal).
             CASE WHEN v_sort = 'nombre' THEN coalesce((
               SELECT coalesce(o.name, wp.full_name, pe.full_name, pe.organization_name)
               FROM public.conversation x
               LEFT JOIN public.workspace_organization o ON o.id = x.organization_id AND o.deleted_at IS NULL
               LEFT JOIN public.conversation_contact cc ON cc.conversation_id = x.id AND cc.is_primary
               LEFT JOIN public.person pe ON pe.id = cc.person_id
               LEFT JOIN public.workspace_person wp ON wp.workspace_id = x.workspace_id AND wp.person_id = cc.person_id
               WHERE x.id = r.id
               LIMIT 1), '') END AS title
      FROM conv_rows r
    ),
    conv_temp AS (
      SELECT d.*,
             -- `isHot`
             (NOT d.not_now
              AND ((d.last_in_at IS NOT NULL AND current_date - d.last_in_at::date <= 14)
                   OR (d.answered AND d.activity IS NOT NULL AND current_date - d.activity::date <= 14))) AS hot,
             -- `coolingOf`: los días (NULL = no se enfría) y el grupo.
             CASE
               WHEN d.not_now OR d.due_reason IS NOT NULL THEN NULL
               WHEN d.turn_side = 'theirs' AND current_date - d.last_occurred_at::date >= 21
                 THEN current_date - d.last_occurred_at::date
               WHEN d.last_direction IS NULL AND NOT d.answered AND d.last_contacted_at IS NOT NULL
                    AND current_date - d.last_contacted_at::date >= 21
                 THEN current_date - d.last_contacted_at::date
               WHEN d.answered AND d.activity IS NOT NULL AND current_date - d.activity::date >= 30
                 THEN current_date - d.activity::date
             END AS cool_days,
             -- `isUndated`
             (NOT d.not_now AND (d.contacted_undated OR d.answered)
              AND d.last_direction IS NULL AND d.activity IS NULL AND d.next_action_at IS NULL) AS undated
      FROM conv_derived d
    ),
    conv_feed AS (
      SELECT 'conversation'::text AS kind, r.id, r.id AS conversation_id, NULL::uuid AS bolo_id, NULL::uuid AS facet_id,
             (r.event_unread + r.thread_unread) AS unread,
             -- Nunca NULL: un NULL va primero en DESC.
             (r.due_reason IS NOT NULL) AS due,
             coalesce(greatest(r.last_occurred_at, r.last_in_at, r.thread_last_at, r.last_contacted_at),
                      r.created_at) AS sort_at,
             greatest(r.last_occurred_at, r.last_in_at, r.thread_last_at, r.last_contacted_at) AS last_at,
             r.due_reason, r.last_occurred_at, r.next_action_at, r.title, r.activity,
             CASE WHEN r.cool_days IS NOT NULL THEN CASE WHEN r.answered THEN 'stalled' ELSE 'round' END END AS cool_group,
             r.cool_days,
             r.relation, r.workspace_id AS ws_id, r.organization_id AS org_id, r.not_now_at, r.not_now_until,
             r.last_in_at, r.wrote, r.answered,
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
      FROM conv_temp r
      WHERE (p_relation IS NULL OR r.relation = p_relation)
        AND (p_turn IS NULL
             OR (p_turn = 'nuestro' AND r.due_reason IS NOT NULL)
             OR (p_turn = 'suyo' AND r.turn_side = 'theirs'))
        AND (p_temp IS NULL
             OR (p_temp = 'caliente' AND r.hot)
             OR (p_temp = 'fria' AND r.cool_days IS NOT NULL)
             OR (p_temp = 'ronda' AND r.cool_days IS NOT NULL AND NOT r.answered)
             OR (p_temp = 'parada' AND r.cool_days IS NOT NULL AND r.answered)
             OR (p_temp = 'sin-fecha' AND r.undated))
        -- La tanda del envío (`mailoutPicks`): contestó = le salió y su último
        -- correo de fuera es posterior a la salida.
        AND (p_mailout_id IS NULL
             OR EXISTS (
                  SELECT 1 FROM public.mailout_recipient mr
                  CROSS JOIN LATERAL (
                    SELECT mr.status::text IN ('sent', 'delivered', 'bounced', 'complained') AS left_,
                           (mr.status::text IN ('sent', 'delivered', 'bounced', 'complained')
                            AND coalesce(mr.sent_at, v_mailout.queued_at) IS NOT NULL
                            AND r.last_in_at IS NOT NULL
                            AND r.last_in_at > coalesce(mr.sent_at, v_mailout.queued_at)) AS replied
                  ) x
                  WHERE mr.mailout_id = v_mailout.id AND mr.conversation_id = r.id
                    AND CASE v_pick
                          WHEN 'rebotes' THEN mr.status::text = 'bounced'
                          WHEN 'todos' THEN x.left_
                          WHEN 'respuestas' THEN x.replied
                          ELSE x.left_ AND mr.status::text <> 'bounced' AND NOT x.replied
                        END))
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
             NULL::text AS due_reason, NULL::timestamptz AS last_occurred_at, NULL::timestamptz AS next_action_at,
             NULL::text AS title, NULL::timestamptz AS activity, NULL::text AS cool_group, NULL::int AS cool_days,
             NULL::text AS relation, NULL::uuid AS ws_id, NULL::uuid AS org_id, NULL::timestamptz AS not_now_at,
             NULL::date AS not_now_until, NULL::timestamptz AS last_in_at, NULL::boolean AS wrote,
             NULL::boolean AS answered,
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
    -- Un CASE por clave: la que no es de este orden vale NULL en todas las filas.
    ORDER BY
      CASE WHEN v_sort IN ('feed', 'pide') THEN f.unread > 0 END DESC NULLS LAST,
      CASE WHEN v_sort IN ('feed', 'pide') THEN f.due END DESC NULLS LAST,
      CASE WHEN v_sort IN ('pide', 'due') THEN CASE f.due_reason WHEN 'reply' THEN 0 WHEN 'follow_up' THEN 1 END END ASC NULLS LAST,
      CASE WHEN v_sort IN ('pide', 'due') AND f.due_reason = 'reply' THEN f.last_occurred_at END DESC NULLS LAST,
      CASE WHEN v_sort IN ('pide', 'due') AND f.due_reason = 'follow_up' THEN f.next_action_at END ASC NULLS LAST,
      CASE WHEN v_sort = 'paso' THEN f.next_action_at END ASC NULLS LAST,
      CASE WHEN v_sort = 'nombre' THEN f.title COLLATE private.list_name END ASC NULLS LAST,
      CASE WHEN v_sort = 'theirs' THEN f.last_occurred_at END ASC NULLS LAST,
      CASE WHEN v_sort = 'hot' THEN f.activity END DESC NULLS LAST,
      CASE WHEN v_sort = 'cold' THEN f.cool_group = 'stalled' END DESC NULLS LAST,
      CASE WHEN v_sort = 'cold' THEN f.cool_days END DESC NULLS LAST,
      CASE WHEN v_sort IN ('feed', 'pide', 'movimiento', 'paso') THEN f.sort_at END DESC NULLS LAST,
      f.id
  LOOP
    -- La regla de cada fila, la de su política: `conversation_select` o
    -- `thread_select`. Lo que no pasa no sale, ni sus no leídos ni su nombre,
    -- ni cuenta en el total.
    CONTINUE WHEN NOT CASE rec.kind
      WHEN 'conversation' THEN private.can_read_conversation(rec.id, v_caller)
      ELSE private.thread_readable(rec.conversation_id, NULL, NULL, rec.bolo_id, rec.facet_id, v_caller)
    END;

    IF v_list THEN
      v_total := v_total + 1;
      IF v_ids THEN
        IF v_total <= 1000 THEN
          v_items := v_items || jsonb_build_array(jsonb_build_object('id', rec.id, 'project_id', rec.d->'project_id'));
        END IF;
        CONTINUE;
      END IF;
      CONTINUE WHEN v_total <= v_offset OR v_total > v_offset + v_limit;
    ELSE
      IF v_n = v_limit THEN
        v_more := true;
        EXIT;
      END IF;
      v_n := v_n + 1;
    END IF;

    IF rec.kind = 'conversation' THEN
      -- Con quién (la organización o el contacto principal, con su papel), la
      -- ciudad (la del contacto, si no la de la organización), sus etiquetas y
      -- su relación.
      SELECT jsonb_build_object(
               'title', ct.title,
               'person', CASE WHEN ct.person IS DISTINCT FROM ct.title THEN ct.person END,
               'contact_role', ct.role,
               'city', ct.city,
               'tags', coalesce(tg.keys, '[]'::jsonb),
               'due', rec.due,
               'relation', coalesce(rec.relation, private.relation_of(
                             rec.not_now_at, rec.not_now_until, rec.last_in_at, rec.activity, rec.wrote, rec.answered,
                             private.organization_is_regular(rec.ws_id, rec.org_id, current_date), current_date)))
      INTO v_extra
      FROM (
        SELECT coalesce(o.name, wp.full_name, pe.full_name, pe.organization_name) AS title,
               coalesce(wp.full_name, pe.full_name) AS person,
               cc.role,
               coalesce(nullif(wp.city, ''), nullif(o.city, '')) AS city
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

  IF v_list THEN
    RETURN jsonb_build_object(
      'items', v_items,
      'more', CASE WHEN v_ids THEN v_total > 1000 ELSE v_total > v_offset + v_limit END,
      'total', v_total);
  END IF;
  RETURN jsonb_build_object('items', v_items, 'more', v_more);
END;
$$;

COMMENT ON FUNCTION public.conversation_feed(uuid[], uuid[], text, text, int, boolean, int, text, text, text, text, boolean, uuid[], text, text, uuid, text, boolean) IS
  'ADR-138 fase 3 y plan de la lista fase 3: la lectura común de Conversaciones y la única fuente de la lista. Conversaciones (private.can_read_conversation, la regla de conversation_select) e hilos de bolo o de conversación con mensajes (private.thread_readable, la de thread_select). Feed (Todas): no leídos arriba, después te toca, después lo último, hasta p_limit. Lista (p_list): solo conversaciones, con los filtros de relación, línea, temporada, turno, temperatura y envío, cuatro órdenes (o el del bloque), total y offset. Sin dinero. SECURITY DEFINER: corte por espacio primero y la regla fila a fila.';

REVOKE ALL ON FUNCTION public.conversation_feed(uuid[], uuid[], text, text, int, boolean, int, text, text, text, text, boolean, uuid[], text, text, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conversation_feed(uuid[], uuid[], text, text, int, boolean, int, text, text, text, text, boolean, uuid[], text, text, uuid, text, boolean) TO authenticated, service_role;
