-- ADR-116: «de qué se habla», la segunda proyección de Conversations (ADR-106,
-- fase 4 del plan `build/plans/2026-10-14-comms-threads.md`).
--
-- Aditiva: una RPC de lectura, ninguna tabla ni política nueva. Rollback:
-- `build/runbooks/rollback-20261017-thread-feed.sql`.
--
-- Por qué una RPC y no `thread` por PostgREST: la política `thread_select`
-- evalúa la regla de lectura (SECURITY DEFINER, ~0,3 ms) en CADA hilo de la
-- base antes de filtrar, porque una función opaca no deja al planificador
-- acotar por espacio. Aquí el corte va primero: solo los hilos con mensajes de
-- los espacios donde el que llama es miembro aceptado, materializados, y la
-- regla corre sobre esos. Es la misma regla (`private.thread_readable`), no
-- una copia.

CREATE FUNCTION public.thread_feed(
  p_workspace_ids uuid[] DEFAULT NULL,
  p_project_ids   uuid[] DEFAULT NULL,
  p_limit         int    DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_all    boolean := coalesce(cardinality(p_workspace_ids), 0) = 0
                  AND coalesce(cardinality(p_project_ids), 0) = 0;
  v_out    jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  WITH cand AS MATERIALIZED (
    -- El prefiltro: espacio del que llama, con mensajes, anclas de este corte
    -- (bolo y conversación) vivas, y el alcance de la barra lateral (proyectos
    -- ∪ espacios, como la lista de conversaciones; vacío = todo).
    SELECT t.id, t.workspace_id, t.bolo_id, t.conversation_id, t.facet_id, t.last_message_at,
           coalesce(b.project_id, c.project_id) AS project_id
    FROM public.thread t
    JOIN public.membership m
      ON m.level = 'workspace' AND m.workspace_id = t.workspace_id
     AND m.user_id = v_caller AND m.accepted_at IS NOT NULL
    LEFT JOIN public.bolo b ON b.id = t.bolo_id AND b.deleted_at IS NULL
    LEFT JOIN public.conversation c ON c.id = t.conversation_id AND c.deleted_at IS NULL
    WHERE t.last_message_at IS NOT NULL
      AND (b.id IS NOT NULL OR c.id IS NOT NULL)
      AND (v_all
           OR t.workspace_id = ANY (coalesce(p_workspace_ids, '{}'))
           OR coalesce(b.project_id, c.project_id) = ANY (coalesce(p_project_ids, '{}')))
  ),
  readable AS MATERIALIZED (
    SELECT cand.*
    FROM cand
    WHERE private.thread_readable(cand.conversation_id, NULL, NULL, cand.bolo_id, cand.facet_id, v_caller)
  ),
  counted AS (
    SELECT r.*, cnt.total, cnt.unread
    FROM readable r
    LEFT JOIN public.thread_read tr ON tr.thread_id = r.id AND tr.user_id = v_caller
    CROSS JOIN LATERAL (
      SELECT count(*) AS total,
             count(*) FILTER (
               WHERE msg.author_id IS DISTINCT FROM v_caller
                 AND (tr.last_read_at IS NULL OR msg.created_at > tr.last_read_at)
             ) AS unread
      FROM public.message msg
      WHERE msg.thread_id = r.id AND msg.deleted_at IS NULL
    ) cnt
    WHERE cnt.total > 0
    -- Los que tienen nuevos arriba; después, por el último mensaje.
    ORDER BY (cnt.unread > 0) DESC, r.last_message_at DESC, r.id
    LIMIT greatest(1, least(coalesce(p_limit, 100), 200))
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'thread_id', x.id,
           'workspace_id', x.workspace_id,
           'project_id', x.project_id,
           'anchor_kind', CASE WHEN x.bolo_id IS NOT NULL THEN 'bolo' ELSE 'conversation' END,
           'anchor_id', coalesce(x.bolo_id, x.conversation_id),
           'facet_id', x.facet_id,
           'facet_key', f.key,
           'label', coalesce(fs.label, f.label),
           'labels', CASE WHEN f.id IS NULL THEN '{}'::jsonb
                          ELSE f.labels || coalesce(fs.labels, '{}'::jsonb) END,
           'message_count', x.total,
           'unread_count', x.unread,
           'last_message_at', x.last_message_at,
           'last_message', jsonb_build_object(
             'author_id', lm.author_id,
             'body', left(lm.body, 280),
             'created_at', lm.created_at),
           -- Bolo: sin dinero (ADR-106 §1). Sala, ciudad, días y la función que
           -- abre su tablón (la próxima; si ya pasaron todas, la última).
           'bolo', CASE WHEN x.bolo_id IS NULL THEN NULL ELSE jsonb_build_object(
             'venue_name', b.venue_name,
             'city', b.city,
             'first_day', pd.first_day,
             'last_day', pd.last_day,
             'performance_slug', pt.slug,
             'performance_id', pt.id) END,
           -- Conversación: con quién (la organización o el contacto principal).
           'conversation', CASE WHEN x.conversation_id IS NULL THEN NULL ELSE jsonb_build_object(
             'title', ct.title) END)
         ORDER BY (x.unread > 0) DESC, x.last_message_at DESC, x.id), '[]'::jsonb)
  INTO v_out
  FROM counted x
  LEFT JOIN public.facet f ON f.id = x.facet_id
  LEFT JOIN public.workspace_facet_setting fs ON fs.workspace_id = x.workspace_id AND fs.facet_id = x.facet_id
  LEFT JOIN public.bolo b ON b.id = x.bolo_id
  LEFT JOIN LATERAL (
    SELECT msg.author_id, msg.body, msg.created_at
    FROM public.message msg
    WHERE msg.thread_id = x.id AND msg.deleted_at IS NULL
    ORDER BY msg.created_at DESC, msg.id DESC
    LIMIT 1
  ) lm ON true
  LEFT JOIN LATERAL (
    SELECT min(pf.performed_at) AS first_day, max(pf.performed_at) AS last_day
    FROM public.performance pf
    WHERE pf.bolo_id = x.bolo_id AND pf.deleted_at IS NULL
  ) pd ON x.bolo_id IS NOT NULL
  LEFT JOIN LATERAL (
    SELECT pf.id, pf.slug
    FROM public.performance pf
    WHERE pf.bolo_id = x.bolo_id AND pf.deleted_at IS NULL
    ORDER BY pf.performed_at < current_date,
             CASE WHEN pf.performed_at >= current_date THEN pf.performed_at END,
             pf.performed_at DESC, pf.id
    LIMIT 1
  ) pt ON x.bolo_id IS NOT NULL
  LEFT JOIN LATERAL (
    SELECT coalesce(o.name, wp.full_name, p.full_name, p.organization_name) AS title
    FROM public.conversation c
    LEFT JOIN public.workspace_organization o ON o.id = c.organization_id AND o.deleted_at IS NULL
    LEFT JOIN public.conversation_contact cc ON cc.conversation_id = c.id AND cc.is_primary
    LEFT JOIN public.person p ON p.id = cc.person_id
    LEFT JOIN public.workspace_person wp ON wp.workspace_id = c.workspace_id AND wp.person_id = cc.person_id
    WHERE c.id = x.conversation_id
    LIMIT 1
  ) ct ON x.conversation_id IS NOT NULL;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.thread_feed(uuid[], uuid[], int) IS
  'ADR-116: «de qué se habla» (ADR-106). Los hilos de bolo y de conversación con mensajes que el que llama lee (private.thread_readable), con nuevos arriba: recuento, no leídos, último mensaje, y la ficha que abre cada uno. Sin dinero. Prefiltra por los espacios del que llama antes de evaluar la regla.';

REVOKE ALL ON FUNCTION public.thread_feed(uuid[], uuid[], int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.thread_feed(uuid[], uuid[], int) TO authenticated;
