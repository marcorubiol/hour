-- ADR-138 § 3: una conversación en «no esta vez» vigente no recibe un envío en
-- bloque. Hasta aquí solo salía de «se enfría» y de «Escribir a estas» en el
-- cliente; quien la elegía a mano en la lista la metía en el envío.
--
--   · `private.conversation_not_now`: el «no esta vez» vigente de una
--     conversación, con la misma regla que la relación derivada
--     (`private.relation_of`, su primer caso): puesto, sin fecha o con la
--     fecha aún por llegar, y sin un correo, mensaje o llamada suyos después.
--   · `queue_mailout`: el destinatario queda `skipped (not_now)` antes de
--     mirar el modo simulador, la exclusión y la base.
--   · `mailout_claim`: lo vuelve a mirar al tomar la cola, como la exclusión:
--     marcarla después de poner el envío en cola también la saca.
--   · `mailout_preview`: en un borrador, el pendiente en «no esta vez» sale
--     con `skip_reason = 'not_now'` y `ready = false` (lo que pasará al poner
--     en cola); su estado sigue `pending`.
-- Los cuerpos son los de 20261015100000 con solo esas líneas.

CREATE FUNCTION private.conversation_not_now(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce((
    SELECT private.relation_of(
             x.not_now_at,
             x.not_now_until,
             (SELECT max(e.occurred_at)
              FROM public.conversation_event e
              WHERE e.conversation_id = x.id
                AND e.direction = 'inbound'
                AND e.kind IN ('email', 'message', 'call')
                AND e.metadata->>'auto' IS NULL),
             NULL, false, false, false,
             current_date
           ) = 'not_now'
    FROM public.conversation x
    WHERE x.id = p_conversation_id AND x.not_now_at IS NOT NULL
  ), false);
$$;

COMMENT ON FUNCTION private.conversation_not_now(uuid) IS
  'ADR-138 § 3: «not this time» in force (the first case of private.relation_of). Mailouts skip it. No read check: only called from mailout functions that already did theirs.';

ALTER FUNCTION private.conversation_not_now(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.conversation_not_now(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mailout_preview(p_id uuid)
RETURNS TABLE (
  recipient_id      uuid,
  conversation_id   uuid,
  address           text,
  display_name      text,
  address_kind      public.mailout_address_kind,
  status            public.mailout_recipient_status,
  skip_reason       public.mailout_skip_reason,
  basis_kind        public.mail_basis_kind,
  basis_withdrawn_at timestamptz,
  suppressed_reason public.mail_suppression_reason,
  suppressed_at     timestamptz,
  ready             boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_m public.mailout := private.mailout_for_caller(p_id, false);
BEGIN
  RETURN QUERY
  SELECT r.id, r.conversation_id, r.address::text, r.display_name, r.address_kind, r.status,
         coalesce(r.skip_reason, CASE WHEN nn.held THEN 'not_now' END::public.mailout_skip_reason),
         coalesce(r.basis_kind, b.kind), b.withdrawn_at, s.reason, s.created_at,
         (r.status = 'pending' AND NOT nn.held AND s.address IS NULL AND b.kind IS NOT NULL AND b.withdrawn_at IS NULL)
  FROM public.mailout_recipient r
  JOIN public.conversation c
    ON c.id = r.conversation_id AND c.deleted_at IS NULL
   AND (c.private_to IS NULL OR c.private_to = auth.uid())
  LEFT JOIN public.mail_basis b ON b.workspace_id = r.workspace_id AND b.address = r.address
  LEFT JOIN public.mail_suppression s ON s.workspace_id = r.workspace_id AND s.address = r.address
  CROSS JOIN LATERAL (
    SELECT r.status = 'pending' AND private.conversation_not_now(r.conversation_id) AS held
  ) nn
  WHERE r.mailout_id = v_m.id
  ORDER BY r.created_at, r.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_mailout(p_id uuid)
RETURNS public.mailout
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_m        public.mailout := private.mailout_for_caller(p_id, true);
  v_ws       public.workspace;
  v_domain   public.mail_domain;
  v_reply    public.mail_account;
  v_from     extensions.citext;
  v_ready    integer;
  v_row      public.mailout;
BEGIN
  SELECT * INTO v_m FROM public.mailout WHERE id = v_m.id FOR UPDATE;
  IF v_m.status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft can be queued' USING ERRCODE = '22023';
  END IF;
  IF v_m.subject IS NULL OR v_m.body IS NULL THEN
    RAISE EXCEPTION 'subject and body are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_domain FROM public.mail_domain
  WHERE id = v_m.mail_domain_id AND workspace_id = v_m.workspace_id;
  IF v_domain.id IS NULL OR v_domain.verified_at IS NULL THEN
    RAISE EXCEPTION 'the sending domain is not verified' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_ws FROM public.workspace WHERE id = v_m.workspace_id;

  -- Quien pone en cola tiene que ver cada conversación que recibe: la que se
  -- borró después, o la privada de otra persona que la puso en la lista,
  -- queda fuera (`unavailable`).
  UPDATE public.mailout_recipient r
  SET status = 'skipped', skip_reason = 'unavailable'
  WHERE r.mailout_id = v_m.id AND r.status = 'pending'
    AND NOT EXISTS (
      SELECT 1 FROM public.conversation c
      WHERE c.id = r.conversation_id AND c.deleted_at IS NULL
        AND (c.private_to IS NULL OR c.private_to = auth.uid())
    );

  -- «No esta vez» vigente (ADR-138 § 3): mientras dura, no recibe envíos.
  UPDATE public.mailout_recipient r
  SET status = 'skipped', skip_reason = 'not_now'
  WHERE r.mailout_id = v_m.id AND r.status = 'pending'
    AND private.conversation_not_now(r.conversation_id);

  IF v_ws.mailout_simulator_only AND EXISTS (
    SELECT 1 FROM public.mailout_recipient r
    WHERE r.mailout_id = v_m.id AND r.status = 'pending'
      AND r.address::text !~* '@simulator\.amazonses\.com$'
  ) THEN
    RAISE EXCEPTION 'this workspace only sends to the mail simulator' USING ERRCODE = '42501';
  END IF;

  UPDATE public.mailout_recipient r
  SET status = 'skipped', skip_reason = 'suppressed'
  WHERE r.mailout_id = v_m.id AND r.status = 'pending'
    AND EXISTS (SELECT 1 FROM public.mail_suppression s
                WHERE s.workspace_id = r.workspace_id AND s.address = r.address);

  UPDATE public.mailout_recipient r
  SET status = 'skipped', skip_reason = 'no_basis'
  WHERE r.mailout_id = v_m.id AND r.status = 'pending'
    AND NOT EXISTS (SELECT 1 FROM public.mail_basis b
                    WHERE b.workspace_id = r.workspace_id AND b.address = r.address
                      AND b.withdrawn_at IS NULL);

  UPDATE public.mailout_recipient r
  SET status = 'queued', next_attempt_at = now(),
      basis_kind = (SELECT b.kind FROM public.mail_basis b
                    WHERE b.workspace_id = r.workspace_id AND b.address = r.address)
  WHERE r.mailout_id = v_m.id AND r.status = 'pending';
  GET DIAGNOSTICS v_ready = ROW_COUNT;
  IF v_ready = 0 THEN
    RAISE EXCEPTION 'no recipient can receive this mailout' USING ERRCODE = '22023';
  END IF;

  -- Respuestas: el buzón elegido si sigue activo; si no, el común del
  -- espacio; si no, el personal de quien envía; si no, el remitente.
  SELECT * INTO v_reply FROM public.mail_account a
  WHERE a.workspace_id = v_m.workspace_id AND a.status = 'active'
    AND (a.scope = 'workspace' OR a.owner_user_id = auth.uid())
  ORDER BY (a.id = v_m.reply_to_mail_account_id) DESC NULLS LAST, (a.scope = 'workspace') DESC, a.created_at
  LIMIT 1;
  v_from := (v_m.from_local_part || '@' || v_domain.domain::text)::extensions.citext;

  UPDATE public.mailout
  SET status = CASE
        WHEN v_domain.provider = 'ses' AND NOT v_ws.mailout_simulator_only AND v_ws.mailout_reviewed_at IS NULL
        THEN 'review' ELSE 'queued' END::public.mailout_status,
      from_address = v_from,
      reply_to_mail_account_id = v_reply.id,
      reply_to_address = coalesce(v_reply.address, v_from),
      queued_by = auth.uid(),
      queued_at = now()
  WHERE id = v_m.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.mailout_claim(p_limit integer DEFAULT 50, p_mailout_id uuid DEFAULT NULL)
RETURNS TABLE (
  recipient_id       uuid,
  mailout_id         uuid,
  workspace_id       uuid,
  conversation_id    uuid,
  address            text,
  display_name       text,
  address_kind       public.mailout_address_kind,
  basis_kind         public.mail_basis_kind,
  unsubscribe_token  text,
  attempts           integer,
  provider           public.mail_sending_provider,
  tenant_name        text,
  configuration_set  text,
  from_address       text,
  from_name          text,
  reply_to_address   text,
  language           text,
  subject            text,
  body               text
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
#variable_conflict use_column
BEGIN
  -- Una pasada a la vez: el tope diario se cuenta sin carreras.
  PERFORM pg_advisory_xact_lock(hashtext('public.mailout_claim'));

  UPDATE public.mailout_recipient
  SET status = 'queued', claimed_at = NULL, next_attempt_at = now()
  WHERE status = 'sending' AND claimed_at < now() - interval '15 minutes';

  UPDATE public.mailout_recipient r
  SET status = 'skipped', skip_reason = 'not_now'
  WHERE r.status = 'queued'
    AND private.conversation_not_now(r.conversation_id);
  UPDATE public.mailout_recipient r
  SET status = 'skipped', skip_reason = 'suppressed'
  WHERE r.status = 'queued'
    AND EXISTS (SELECT 1 FROM public.mail_suppression s
                WHERE s.workspace_id = r.workspace_id AND s.address = r.address);
  UPDATE public.mailout_recipient r
  SET status = 'skipped', skip_reason = 'no_basis'
  WHERE r.status = 'queued'
    AND NOT EXISTS (SELECT 1 FROM public.mail_basis b
                    WHERE b.workspace_id = r.workspace_id AND b.address = r.address
                      AND b.withdrawn_at IS NULL);

  RETURN QUERY
  WITH cand AS (
    SELECT r.id, r.workspace_id,
           row_number() OVER (PARTITION BY r.workspace_id ORDER BY r.next_attempt_at, r.id) AS rn
    FROM public.mailout_recipient r
    JOIN public.mailout m ON m.id = r.mailout_id AND m.status IN ('queued', 'sending')
    JOIN public.mail_domain d ON d.id = m.mail_domain_id AND d.verified_at IS NOT NULL
    WHERE r.status = 'queued' AND r.next_attempt_at <= now()
      AND (p_mailout_id IS NULL OR r.mailout_id = p_mailout_id)
  ),
  budget AS (
    SELECT w.id,
           greatest(w.mailout_daily_cap - (
             SELECT count(*) FROM public.mailout_recipient x
             WHERE x.workspace_id = w.id
               AND (x.status = 'sending' OR x.sent_at > now() - interval '24 hours')
           ), 0) AS remaining
    FROM public.workspace w
    WHERE w.id IN (SELECT c.workspace_id FROM cand c)
  ),
  pick AS (
    SELECT c.id FROM cand c JOIN budget b ON b.id = c.workspace_id
    WHERE c.rn <= b.remaining
    ORDER BY c.rn, c.id
    LIMIT greatest(1, least(coalesce(p_limit, 50), 500))
  ),
  locked AS (
    SELECT r.id FROM public.mailout_recipient r
    WHERE r.id IN (SELECT id FROM pick)
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.mailout_recipient r
    SET status = 'sending', claimed_at = now(), attempts = r.attempts + 1
    WHERE r.id IN (SELECT id FROM locked)
    RETURNING r.*
  ),
  started AS (
    UPDATE public.mailout m SET status = 'sending'
    WHERE m.status = 'queued' AND m.id IN (SELECT mailout_id FROM claimed)
    RETURNING m.id
  )
  SELECT c.id, c.mailout_id, c.workspace_id, c.conversation_id, c.address::text, c.display_name,
         c.address_kind, c.basis_kind, c.unsubscribe_token, c.attempts,
         d.provider, d.tenant_name, d.configuration_set,
         m.from_address::text, m.from_name, m.reply_to_address::text, m.language, m.subject, m.body
  FROM claimed c
  JOIN public.mailout m ON m.id = c.mailout_id
  JOIN public.mail_domain d ON d.id = m.mail_domain_id;
END;
$$;
