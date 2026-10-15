-- ADR-115 · Envío en bloque, fase 3: lo que hace falta para montar cada correo.
-- Plan: build/plans/2026-10-14-bulk-send.md (§ 3.4, § 7.1, § 10, § 11 fase 3).
--
-- Aditiva: solo funciones nuevas. Nada cambia en tablas ni en las RPC de la
-- fase 1 (20261015100000_mailout).
--   · `mailout_send_context` (service_role): por destinatario, los campos del
--     correo (`{nombre}`, `{sala}`, `{ciudad}`) y las piezas del pie (la
--     compañía, su firma, su política de privacidad). La cola la llama después
--     de `mailout_claim`, que no las devuelve.
--   · `mailout_compose_preview` (authenticated): lo mismo para la vista previa,
--     con la RLS de quien llama: solo los destinatarios de conversaciones que
--     ve. Las dos salen de una sola función privada: lo que se ve es lo que
--     sale.
--   · `mailout_unsubscribe_info` (anon, por token): lo que enseña la página de
--     baja (nombre de la compañía, idioma del envío y si ya está de baja).
--   · `mailout_record_sent` gana `p_subject`: el asunto de ese destinatario, con
--     sus campos ya puestos, es el que queda en el registro de la conversación
--     (sin él quedaba «Propuesta para {sala}»). Se rehace la función (DROP y
--     CREATE): ningún Worker desplegado la llama todavía. Sin `p_subject`, el
--     del envío, como antes. `private.mailout_record_conversation_event` pasa
--     a tener una variante con asunto; la de dos argumentos (la del evento
--     `send` del proveedor) llama a esa con NULL.
-- Rollback: build/runbooks/rollback-20261016-mailout-send.sql.

CREATE FUNCTION private.mailout_compose_rows(p_recipient_ids uuid[])
RETURNS TABLE (
  recipient_id        uuid,
  mailout_id          uuid,
  address_kind        public.mailout_address_kind,
  basis_kind          public.mail_basis_kind,
  contact_first_name  text,
  contact_name        text,
  organization_name   text,
  city                text,
  company_name        text,
  company_city        text,
  company_website     text,
  company_phone       text,
  company_signature   text,
  privacy_url         text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT r.id, r.mailout_id, r.address_kind,
         -- La base congelada al poner en cola; antes, la vigente.
         coalesce(r.basis_kind, b.kind),
         CASE WHEN r.address_kind = 'contact'
              THEN coalesce(nullif(btrim(wp.first_name), ''), nullif(split_part(btrim(wp.full_name), ' ', 1), '')) END,
         CASE WHEN r.address_kind = 'contact' THEN nullif(btrim(wp.full_name), '') END,
         nullif(btrim(o.name), ''),
         coalesce(nullif(btrim(o.city), ''), CASE WHEN r.address_kind = 'contact' THEN nullif(btrim(wp.city), '') END),
         w.name,
         nullif(btrim(w.city), ''),
         nullif(btrim(w.website), ''),
         nullif(btrim(w.phone), ''),
         nullif(btrim(w.mail_signature), ''),
         w.privacy_url
  FROM public.mailout_recipient r
  JOIN public.conversation c ON c.id = r.conversation_id
  JOIN public.workspace w ON w.id = r.workspace_id
  LEFT JOIN public.workspace_person wp
    ON wp.workspace_id = r.workspace_id AND wp.person_id = r.person_id AND wp.deleted_at IS NULL
  LEFT JOIN public.workspace_organization o
    ON o.workspace_id = c.workspace_id AND o.id = c.organization_id AND o.deleted_at IS NULL
  LEFT JOIN public.mail_basis b
    ON b.workspace_id = r.workspace_id AND b.address = r.address AND b.withdrawn_at IS NULL
  WHERE r.id = ANY (p_recipient_ids)
  ORDER BY r.created_at, r.id;
$$;

-- La cola, sin persona detrás: los destinatarios que acaba de tomar.
CREATE FUNCTION public.mailout_send_context(p_recipient_ids uuid[])
RETURNS TABLE (
  recipient_id        uuid,
  mailout_id          uuid,
  address_kind        public.mailout_address_kind,
  basis_kind          public.mail_basis_kind,
  contact_first_name  text,
  contact_name        text,
  organization_name   text,
  city                text,
  company_name        text,
  company_city        text,
  company_website     text,
  company_phone       text,
  company_signature   text,
  privacy_url         text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT * FROM private.mailout_compose_rows(coalesce(p_recipient_ids, '{}'));
$$;

-- La vista previa: los destinatarios del envío que quien llama ve (las
-- conversaciones privadas de otra persona no salen), con lo mismo que usará
-- la cola.
CREATE FUNCTION public.mailout_compose_preview(p_id uuid)
RETURNS TABLE (
  recipient_id        uuid,
  mailout_id          uuid,
  address_kind        public.mailout_address_kind,
  basis_kind          public.mail_basis_kind,
  contact_first_name  text,
  contact_name        text,
  organization_name   text,
  city                text,
  company_name        text,
  company_city        text,
  company_website     text,
  company_phone       text,
  company_signature   text,
  privacy_url         text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_m   public.mailout := private.mailout_for_caller(p_id, false);
  v_ids uuid[];
BEGIN
  SELECT coalesce(array_agg(r.id), '{}') INTO v_ids
  FROM public.mailout_recipient r
  JOIN public.conversation c
    ON c.id = r.conversation_id AND c.deleted_at IS NULL
   AND (c.private_to IS NULL OR c.private_to = auth.uid())
  WHERE r.mailout_id = v_m.id;
  RETURN QUERY SELECT * FROM private.mailout_compose_rows(v_ids);
END;
$$;

-- La página de baja: de quién son los envíos, en qué idioma, y si esa
-- dirección ya está de baja. Un token que no existe no devuelve nada.
CREATE FUNCTION public.mailout_unsubscribe_info(p_token text)
RETURNS TABLE (company_name text, language text, unsubscribed boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT w.name, m.language,
         EXISTS (SELECT 1 FROM public.mail_suppression s
                 WHERE s.workspace_id = r.workspace_id AND s.address = r.address
                   AND s.reason IN ('unsubscribe', 'complaint'))
  FROM public.mailout_recipient r
  JOIN public.mailout m ON m.id = r.mailout_id
  JOIN public.workspace w ON w.id = r.workspace_id
  WHERE r.unsubscribe_token = btrim(coalesce(p_token, '')) AND r.address IS NOT NULL;
$$;

-- ── El asunto de cada destinatario en el registro ─────────────────────────
CREATE FUNCTION private.mailout_record_conversation_event(
  p_recipient public.mailout_recipient,
  p_body      text,
  p_subject   text
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_m        public.mailout;
  v_provider public.mail_sending_provider;
  v_rfc      text := coalesce(p_recipient.rfc_message_id, p_recipient.provider_message_id, p_recipient.id::text);
  v_id       uuid;
  v_now      timestamptz := statement_timestamp();
BEGIN
  SELECT * INTO v_m FROM public.mailout WHERE id = p_recipient.mailout_id;
  SELECT d.provider INTO v_provider FROM public.mail_domain d WHERE d.id = v_m.mail_domain_id;
  INSERT INTO public.conversation_event (
    workspace_id, conversation_id, occurred_at, kind, source, direction,
    body, participants, provenance, external_ref, metadata, created_by
  ) VALUES (
    p_recipient.workspace_id, p_recipient.conversation_id, v_now, 'email', 'email', 'outbound',
    nullif(btrim(left(coalesce(p_body, ''), 20000)), ''),
    jsonb_build_array(jsonb_build_object('address', p_recipient.address::text)),
    jsonb_strip_nulls(jsonb_build_object(
      'connector', 'mailout', 'mailout_id', v_m.id, 'provider', v_provider)),
    'mail:' || v_rfc || '#' || p_recipient.conversation_id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'mailout_id', v_m.id,
      'mailout_recipient_id', p_recipient.id,
      'rfc_message_id', p_recipient.rfc_message_id,
      'provider_message_id', p_recipient.provider_message_id,
      'subject', coalesce(nullif(btrim(left(p_subject, 998)), ''), v_m.subject),
      'from', v_m.from_address::text,
      'to', jsonb_build_array(p_recipient.address::text)
    )),
    v_m.queued_by
  )
  ON CONFLICT (workspace_id, source, external_ref) WHERE external_ref IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.conversation_event
    WHERE workspace_id = p_recipient.workspace_id AND source = 'email'
      AND external_ref = 'mail:' || v_rfc || '#' || p_recipient.conversation_id::text;
    RETURN v_id;
  END IF;

  -- Como record_conversation_event; el estado de la conversación no cambia.
  UPDATE public.conversation
  SET last_contacted_at = greatest(coalesce(last_contacted_at, v_now), v_now),
      first_contacted_at = coalesce(first_contacted_at, v_now)
  WHERE id = p_recipient.conversation_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.mailout_record_conversation_event(
  p_recipient public.mailout_recipient,
  p_body text
) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT private.mailout_record_conversation_event(p_recipient, p_body, NULL::text);
$$;

DROP FUNCTION public.mailout_record_sent(uuid, text, text, text);

-- El proveedor aceptó el correo: `sent`, el evento en la conversación (con el
-- asunto de este destinatario) y last_contacted_at, en una transacción.
-- Idempotente.
CREATE FUNCTION public.mailout_record_sent(
  p_recipient_id        uuid,
  p_provider_message_id text,
  p_rfc_message_id      text,
  p_body                text,
  p_subject             text DEFAULT NULL
) RETURNS public.mailout_recipient
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_r public.mailout_recipient;
BEGIN
  SELECT * INTO v_r FROM public.mailout_recipient WHERE id = p_recipient_id FOR UPDATE;
  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'recipient % not found', p_recipient_id USING ERRCODE = '42501';
  END IF;
  IF v_r.status IN ('sent', 'delivered', 'bounced', 'complained') AND v_r.conversation_event_id IS NOT NULL THEN
    RETURN v_r;
  END IF;
  IF v_r.status NOT IN ('sending', 'queued', 'sent') THEN
    RAISE EXCEPTION 'recipient % is not being sent', p_recipient_id USING ERRCODE = '22023';
  END IF;
  UPDATE public.mailout_recipient
  SET status = 'sent',
      provider_message_id = coalesce(nullif(btrim(p_provider_message_id), ''), provider_message_id),
      rfc_message_id = coalesce(nullif(btrim(p_rfc_message_id), ''), rfc_message_id),
      sent_at = coalesce(sent_at, now()),
      claimed_at = NULL,
      last_error = NULL
  WHERE id = v_r.id
  RETURNING * INTO v_r;
  UPDATE public.mailout_recipient
  SET conversation_event_id = private.mailout_record_conversation_event(v_r, p_body, p_subject)
  WHERE id = v_r.id
  RETURNING * INTO v_r;
  PERFORM private.mailout_maybe_finish(v_r.mailout_id);
  RETURN v_r;
END;
$$;

DO $$
DECLARE
  f text;
BEGIN
  EXECUTE 'ALTER FUNCTION private.mailout_compose_rows(uuid[]) OWNER TO postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION private.mailout_compose_rows(uuid[]) FROM PUBLIC, anon, authenticated, service_role';

  EXECUTE 'ALTER FUNCTION public.mailout_compose_preview(uuid) OWNER TO postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION public.mailout_compose_preview(uuid) FROM PUBLIC, anon, service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.mailout_compose_preview(uuid) TO authenticated';

  EXECUTE 'ALTER FUNCTION public.mailout_unsubscribe_info(text) OWNER TO postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION public.mailout_unsubscribe_info(text) FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.mailout_unsubscribe_info(text) TO anon, authenticated, service_role';

  FOREACH f IN ARRAY ARRAY[
    'private.mailout_record_conversation_event(public.mailout_recipient, text, text)',
    'private.mailout_record_conversation_event(public.mailout_recipient, text)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;

  -- De máquina: solo service_role (la frontera de ADR-110).
  FOREACH f IN ARRAY ARRAY[
    'public.mailout_send_context(uuid[])',
    'public.mailout_record_sent(uuid, text, text, text, text)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END;
$$;
