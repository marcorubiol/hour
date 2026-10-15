-- Rollback de 20261016100000_mailout_send (ADR-115, envío en bloque fase 3).
-- Desplegar antes el Worker anterior: el de la fase 3 llama a
-- mailout_send_context, mailout_compose_preview y mailout_record_sent con
-- p_subject. No hay datos que recuperar: solo funciones. Los eventos de
-- conversación ya escritos se quedan (append-only).

BEGIN;
DROP FUNCTION IF EXISTS public.mailout_unsubscribe_info(text);
DROP FUNCTION IF EXISTS public.mailout_compose_preview(uuid);
DROP FUNCTION IF EXISTS public.mailout_send_context(uuid[]);
DROP FUNCTION IF EXISTS private.mailout_compose_rows(uuid[]);

-- mailout_record_sent y el evento en la conversación, como en 20261015100000.
DROP FUNCTION IF EXISTS public.mailout_record_sent(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.mailout_record_sent(uuid, text, text, text);
CREATE OR REPLACE FUNCTION private.mailout_record_conversation_event(
  p_recipient public.mailout_recipient,
  p_body text
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
      'subject', v_m.subject,
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

DROP FUNCTION IF EXISTS private.mailout_record_conversation_event(public.mailout_recipient, text, text);
CREATE FUNCTION public.mailout_record_sent(
  p_recipient_id        uuid,
  p_provider_message_id text,
  p_rfc_message_id      text,
  p_body                text
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
  SET conversation_event_id = private.mailout_record_conversation_event(v_r, p_body)
  WHERE id = v_r.id
  RETURNING * INTO v_r;
  PERFORM private.mailout_maybe_finish(v_r.mailout_id);
  RETURN v_r;
END;
$$;

ALTER FUNCTION private.mailout_record_conversation_event(public.mailout_recipient, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.mailout_record_conversation_event(public.mailout_recipient, text) FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.mailout_record_sent(uuid, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mailout_record_sent(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mailout_record_sent(uuid, text, text, text) TO service_role;
COMMIT;
