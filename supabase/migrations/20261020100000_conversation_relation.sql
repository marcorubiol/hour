-- ADR-138 · fase E1: el estado de la relación se deriva, el trato vive en el
-- bolo (plan `build/plans/2026-10-19-conversations-tags.md` § 8.1, 8.2, 8.5).
--
-- Expand, aditiva. `conversation.status` y su enum siguen ahí (el contract es
-- E4); dejan de leerse para la relación.
--
--   1 · `not_now_at`, `not_now_until`: «no esta vez», lo único que se guarda a
--       mano. Escribibles por el grant de UPDATE por columnas (la política de
--       siempre, `edit:conversation`). `contacted_undated`: «contactada, sin
--       fecha» (pregunta 9), solo lo pone esta migración.
--   2 · Datos: el estado viejo a `custom_fields.legacy_status` en las filas que
--       no están en `contacted`; las `declined` pasan a «no esta vez»; las
--       `contacted` sin evento con dirección ni `first_contacted_at`, a
--       «contactada, sin fecha». El estado de un bolo no se toca.
--   3 · La relación derivada: `private.relation_of` (la precedencia, pura) y
--       los campos calculados `conversation_relation` y `conversation_regular`
--       sobre la fila, para PostgREST. El espejo en TS es `relationOf` en
--       `$lib/conversation-relation.ts`: los dos cambian juntos.
--   4 · `conversation_bolos(p_conversation_id)` y `conversations_bolos(ids)`:
--       los bolos de una conversación, sin caché ni pagador, para quien lee la
--       conversación y tiene `read:performance` en el proyecto (enmienda
--       ADR-106 § 1, pregunta 8).
--
-- Rollback: build/runbooks/rollback-20261020-conversation-relation.sql.

-- ── 1 · columnas ──────────────────────────────────────────────────────────
ALTER TABLE public.conversation
  ADD COLUMN not_now_at timestamptz,
  ADD COLUMN not_now_until date,
  ADD COLUMN contacted_undated boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT conversation_not_now_until_check
    CHECK (not_now_until IS NULL OR not_now_at IS NOT NULL);

COMMENT ON COLUMN public.conversation.not_now_at IS
  'ADR-138: when they said «not this time». In force until not_now_until, or until a later inbound email, message or call. NULL = not set.';
COMMENT ON COLUMN public.conversation.not_now_until IS
  'ADR-138: the day to write again; «not this time» ends that day. NULL = no date. Requires not_now_at.';
COMMENT ON COLUMN public.conversation.contacted_undated IS
  'ADR-138 (question 9): contacted before Hour kept a history, with no date. Counts as contacted; set only by 20261020100000.';

-- La lectura es de tabla; la escritura, por columnas (20261011800000).
GRANT UPDATE (not_now_at, not_now_until) ON TABLE public.conversation TO authenticated;

-- ── 2 · datos ─────────────────────────────────────────────────────────────
-- Antes de tocar `not_now_*`, para que `legacy_status` guarde lo que había.
UPDATE public.conversation
SET custom_fields = custom_fields || jsonb_build_object('legacy_status', status::text)
WHERE status <> 'contacted'
  AND NOT (custom_fields ? 'legacy_status');

-- «Rechazada» sobrevive como «no esta vez», desde su último movimiento.
UPDATE public.conversation c
SET not_now_at = coalesce(
  greatest(
    c.last_contacted_at,
    (SELECT max(e.occurred_at) FROM public.conversation_event e
     WHERE e.conversation_id = c.id AND e.direction = 'inbound')
  ),
  c.updated_at
)
WHERE c.status = 'declined'
  AND c.not_now_at IS NULL;

UPDATE public.conversation c
SET contacted_undated = true
WHERE c.status = 'contacted'
  AND c.first_contacted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.conversation_event e
    WHERE e.conversation_id = c.id AND e.direction IS NOT NULL
  );

-- ── 3 · la relación derivada ──────────────────────────────────────────────
-- La precedencia (§ 8.2): «no esta vez» vigente > habitual > en conversación
-- > dormida > contactada > nunca contactada. Sin lecturas: todo entra.
--   p_last_in        su último correo, mensaje o llamada (no automático)
--   p_last_activity  el último movimiento: evento con dirección o sello
--   p_wrote          les hemos escrito: evento nuestro, sello o «sin fecha»
--   p_answered       han contestado: un evento suyo, o su estado viejo lo dice
CREATE FUNCTION private.relation_of(
  p_not_now_at    timestamptz,
  p_not_now_until date,
  p_last_in       timestamptz,
  p_last_activity timestamptz,
  p_wrote         boolean,
  p_answered      boolean,
  p_regular       boolean,
  p_today         date
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_temp'
AS $$
  SELECT CASE
    WHEN p_not_now_at IS NOT NULL
         AND (p_not_now_until IS NULL OR p_not_now_until > p_today)
         AND (p_last_in IS NULL OR p_last_in <= p_not_now_at) THEN 'not_now'
    WHEN p_regular THEN 'regular'
    WHEN p_answered AND (p_last_activity IS NULL OR p_today - p_last_activity::date < 30) THEN 'talking'
    WHEN p_answered THEN 'dormant'
    WHEN p_wrote THEN 'contacted'
    ELSE 'never'
  END;
$$;

COMMENT ON FUNCTION private.relation_of(timestamptz, date, timestamptz, timestamptz, boolean, boolean, boolean, date) IS
  'ADR-138 § 4: the precedence of the derived relation. Mirror: relationOf in $lib/conversation-relation.ts; change both.';

-- Habitual: la organización tiene un bolo hecho en una temporada anterior
-- (septiembre a agosto, ADR-117 § 3), en cualquier proyecto del espacio. La
-- temporada de un bolo es la de su última función viva (ADR-131).
CREATE FUNCTION private.organization_is_regular(
  p_workspace_id    uuid,
  p_organization_id uuid,
  p_today           date
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bolo b
    JOIN public.conversation bc ON bc.id = b.conversation_id
    WHERE b.workspace_id = p_workspace_id
      AND bc.workspace_id = p_workspace_id
      AND bc.organization_id = p_organization_id
      AND b.deleted_at IS NULL
      AND b.status = 'done'
      AND (
        SELECT coalesce(
          max(pf.performed_at) FILTER (WHERE pf.status <> 'cancelled'),
          max(pf.performed_at)
        )
        FROM public.performance pf
        WHERE pf.bolo_id = b.id AND pf.deleted_at IS NULL
      ) < make_date(
        extract(year FROM p_today)::int - (extract(month FROM p_today) < 9)::int, 9, 1
      )
  );
$$;

-- Los hechos de una conversación legible, y su relación. Se relee la fila por
-- id: una fila inventada en una llamada directa no dice nada de otra.
CREATE FUNCTION private.conversation_relation_for(p_conversation_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT private.relation_of(
           x.not_now_at,
           x.not_now_until,
           ev.last_in,
           greatest(ev.last_turn, x.last_contacted_at),
           ev.wrote_out OR x.first_contacted_at IS NOT NULL OR x.contacted_undated,
           ev.last_in IS NOT NULL
             OR x.custom_fields->>'legacy_status' IN ('in_conversation', 'hold', 'confirmed'),
           private.organization_is_regular(x.workspace_id, x.organization_id, current_date),
           current_date
         )
  FROM public.conversation x
  CROSS JOIN LATERAL (
    SELECT max(e.occurred_at) FILTER (WHERE e.direction = 'inbound') AS last_in,
           max(e.occurred_at) AS last_turn,
           bool_or(e.direction = 'outbound') IS TRUE AS wrote_out
    FROM public.conversation_event e
    WHERE e.conversation_id = x.id
      AND e.direction IS NOT NULL
      AND e.kind IN ('email', 'message', 'call')
      AND e.metadata->>'auto' IS NULL
  ) ev
  WHERE x.id = p_conversation_id
    AND private.can_read_conversation(x.id, p_user_id);
$$;

REVOKE ALL ON FUNCTION private.relation_of(timestamptz, date, timestamptz, timestamptz, boolean, boolean, boolean, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.organization_is_regular(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.conversation_relation_for(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Campos calculados de PostgREST (`select=…,relation:conversation_relation`).
CREATE FUNCTION public.conversation_relation(c public.conversation)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT private.conversation_relation_for(c.id, auth.uid());
$$;

COMMENT ON FUNCTION public.conversation_relation(public.conversation) IS
  'ADR-138: the derived relation (never, contacted, talking, dormant, regular, not_now). NULL for a conversation the caller cannot read.';

-- El único hecho que el Worker no puede leer él mismo: los bolos hechos son
-- dinero (`bolo_select` pide `read:money`), «habitual» no.
CREATE FUNCTION public.conversation_regular(c public.conversation)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT private.organization_is_regular(x.workspace_id, x.organization_id, current_date)
  FROM public.conversation x
  WHERE x.id = c.id
    AND private.can_read_conversation(x.id, auth.uid());
$$;

COMMENT ON FUNCTION public.conversation_regular(public.conversation) IS
  'ADR-138: its organization has a done bolo in an earlier season, in any project of the workspace. NULL for a conversation the caller cannot read.';

REVOKE ALL ON FUNCTION public.conversation_relation(public.conversation) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.conversation_regular(public.conversation) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversation_relation(public.conversation) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conversation_regular(public.conversation) TO authenticated;

-- ── 4 · los bolos de una conversación ─────────────────────────────────────
-- Fecha (primera y última función viva), sala, ciudad y estado. Nunca caché
-- ni pagador. Una conversación que no se lee, o un proyecto sin
-- `read:performance`, no devuelve nada (ni error: «no existe»).
CREATE FUNCTION public.conversations_bolos(p_conversation_ids uuid[])
RETURNS TABLE (
  conversation_id    uuid,
  bolo_id            uuid,
  project_id         uuid,
  line_id            uuid,
  status             public.performance_status,
  venue_name         text,
  city               text,
  country            character(2),
  function_count     integer,
  first_performed_at date,
  last_performed_at  date,
  performance_slug   text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(p_conversation_ids), 0) > 2000 THEN
    RAISE EXCEPTION 'at most 2000 conversations' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT c.id,
         b.id,
         b.project_id,
         b.line_id,
         b.status,
         b.venue_name,
         b.city,
         b.country,
         fx.function_count::integer,
         fx.first_performed_at,
         fx.last_performed_at,
         fx.performance_slug
  FROM public.conversation c
  JOIN public.bolo b
    ON b.conversation_id = c.id
   AND b.workspace_id = c.workspace_id
   AND b.deleted_at IS NULL
  LEFT JOIN LATERAL (
    -- La regla de `list_money_bolos`: una función cancelada no es la fecha
    -- del bolo, salvo que lo estén todas.
    SELECT count(*) FILTER (WHERE pf.status <> 'cancelled') AS function_count,
           coalesce(min(pf.performed_at) FILTER (WHERE pf.status <> 'cancelled'), min(pf.performed_at)) AS first_performed_at,
           coalesce(max(pf.performed_at) FILTER (WHERE pf.status <> 'cancelled'), max(pf.performed_at)) AS last_performed_at,
           (array_agg(pf.slug ORDER BY (pf.status = 'cancelled'), pf.performed_at, pf.id))[1] AS performance_slug
    FROM public.performance pf
    WHERE pf.bolo_id = b.id AND pf.deleted_at IS NULL
  ) fx ON true
  WHERE c.id = ANY (p_conversation_ids)
    AND private.can_read_conversation(c.id, auth.uid())
    AND public.has_permission(c.project_id, 'read:performance')
    AND public.has_permission(b.project_id, 'read:performance')
  ORDER BY c.id, fx.first_performed_at ASC NULLS LAST, b.created_at ASC;
END;
$$;

COMMENT ON FUNCTION public.conversations_bolos(uuid[]) IS
  'ADR-138 § 3: the bolos of readable conversations, with date, venue, city and status. Never fee nor payer. Gate: can read the conversation and read:performance on the project.';

CREATE FUNCTION public.conversation_bolos(p_conversation_id uuid)
RETURNS TABLE (
  conversation_id    uuid,
  bolo_id            uuid,
  project_id         uuid,
  line_id            uuid,
  status             public.performance_status,
  venue_name         text,
  city               text,
  country            character(2),
  function_count     integer,
  first_performed_at date,
  last_performed_at  date,
  performance_slug   text
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT * FROM public.conversations_bolos(ARRAY[p_conversation_id]);
$$;

COMMENT ON FUNCTION public.conversation_bolos(uuid) IS
  'ADR-138 § 3: the bolos of one conversation (see conversations_bolos).';

REVOKE ALL ON FUNCTION public.conversations_bolos(uuid[]) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.conversation_bolos(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.conversations_bolos(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conversation_bolos(uuid) TO authenticated;
