-- 100 · `mailout_record_event` fallaba con 23514 cuando llegaba un rebote
-- permanente o una queja de un destinatario `skipped` (o `pending`).
--
-- Por qué: la función ponía `status = 'bounced'` o `'complained'` sin mirar el
-- estado. En una fila `skipped`, `mailout_recipient_skip_reason_matches` exige
-- que `skip_reason` sea null fuera de `skipped`; y una fila sin base (o sin
-- dirección) choca además con `mailout_recipient_sendable_has_address`, que
-- solo admite `address` o `basis_kind` null en `pending` y `skipped`.
--
-- Qué hace ahora: un destinatario que nunca salió (`pending`, `skipped`)
-- conserva su estado y su `skip_reason`; el evento se guarda igual en
-- `mailout_event` (la auditoría no pierde nada) y lo que el evento dice de la
-- dirección se sigue aplicando: un rebote permanente la excluye, una queja la
-- excluye, retira la base o da de baja la suscripción y deja la nota. Un
-- destinatario sin dirección (`no_address`) no escribe exclusión, que no
-- admite dirección null.
--
-- Firma y cuerpo copiados de la base viva (`pg_get_functiondef`, 2026-11-04);
-- solo cambian las tres guardas. CREATE OR REPLACE conserva los grants.

CREATE OR REPLACE FUNCTION public.mailout_record_event(p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_event_id text := nullif(btrim(coalesce(p_payload ->> 'provider_event_id', '')), '');
  v_type     public.mailout_event_type := (p_payload ->> 'type')::public.mailout_event_type;
  v_bounce   text := nullif(p_payload ->> 'bounce_type', '');
  v_at       timestamptz := least(coalesce((p_payload ->> 'occurred_at')::timestamptz, now()), now());
  v_r        public.mailout_recipient;
  v_s        public.audience_subscription;
  v_new      uuid;
  v_out      boolean;
BEGIN
  IF v_event_id IS NULL OR v_type IS NULL THEN
    RAISE EXCEPTION 'provider_event_id and type are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_r FROM public.mailout_recipient
  WHERE (p_payload ? 'recipient_id' AND id = (p_payload ->> 'recipient_id')::uuid)
     OR (NOT p_payload ? 'recipient_id' AND provider_message_id = p_payload ->> 'provider_message_id')
  FOR UPDATE;
  IF v_r.id IS NULL THEN
    IF p_payload ? 'recipient_id' OR nullif(p_payload ->> 'provider_message_id', '') IS NULL THEN
      RETURN false;
    END IF;
    SELECT * INTO v_s FROM public.audience_subscription
    WHERE confirm_provider_message_id = p_payload ->> 'provider_message_id'
    FOR UPDATE;
    IF v_s.id IS NULL THEN
      RETURN false;
    END IF;
    IF v_type = 'bounce' AND v_bounce = 'Permanent' THEN
      INSERT INTO public.mail_suppression (workspace_id, address, reason)
      VALUES (v_s.workspace_id, v_s.address, 'bounce')
      ON CONFLICT (workspace_id, address) DO NOTHING;
      RETURN FOUND;
    ELSIF v_type = 'complaint' THEN
      INSERT INTO public.audience_consent_event (workspace_id, subscription_id, kind, occurred_at, provider_event_id)
      VALUES (v_s.workspace_id, v_s.id, 'complained', v_at, v_event_id)
      ON CONFLICT (provider_event_id) WHERE provider_event_id IS NOT NULL DO NOTHING
      RETURNING id INTO v_new;
      IF v_new IS NULL THEN
        RETURN false;
      END IF;
      INSERT INTO public.mail_suppression (workspace_id, address, reason)
      VALUES (v_s.workspace_id, v_s.address, 'complaint')
      ON CONFLICT (workspace_id, address) DO UPDATE
      SET reason = 'complaint', created_at = now(), created_by = NULL;
      RETURN true;
    END IF;
    RETURN false;
  END IF;

  INSERT INTO public.mailout_event (recipient_id, workspace_id, type, bounce_type, occurred_at, provider_event_id, detail)
  VALUES (v_r.id, v_r.workspace_id, v_type, v_bounce, v_at,
          v_event_id, coalesce(p_payload -> 'detail', '{}'::jsonb))
  ON CONFLICT (provider_event_id) DO NOTHING
  RETURNING id INTO v_new;
  IF v_new IS NULL THEN
    RETURN false;
  END IF;

  -- 100: un destinatario que nunca salió conserva su estado (y su skip_reason).
  v_out := v_r.status NOT IN ('pending', 'skipped');

  IF v_type = 'send' AND v_r.status IN ('sending', 'queued') THEN
    -- mailout_record_sent no llegó: el correo salió igual.
    UPDATE public.mailout_recipient
    SET status = 'sent', sent_at = coalesce(sent_at, now()), claimed_at = NULL
    WHERE id = v_r.id RETURNING * INTO v_r;
    IF v_r.conversation_id IS NOT NULL THEN
      UPDATE public.mailout_recipient
      SET conversation_event_id = private.mailout_record_conversation_event(v_r, NULL)
      WHERE id = v_r.id;
    END IF;
  ELSIF v_type = 'delivery' AND v_r.status IN ('sending', 'sent') THEN
    UPDATE public.mailout_recipient SET status = 'delivered', sent_at = coalesce(sent_at, now())
    WHERE id = v_r.id;
  ELSIF v_type = 'bounce' AND v_bounce = 'Permanent' THEN
    IF v_out THEN
      UPDATE public.mailout_recipient SET status = 'bounced' WHERE id = v_r.id;
    END IF;
    IF v_r.address IS NOT NULL THEN
      INSERT INTO public.mail_suppression (workspace_id, address, reason, mailout_recipient_id)
      VALUES (v_r.workspace_id, v_r.address, 'bounce', v_r.id)
      ON CONFLICT (workspace_id, address) DO NOTHING;
    END IF;
  ELSIF v_type = 'complaint' THEN
    IF v_out THEN
      UPDATE public.mailout_recipient SET status = 'complained' WHERE id = v_r.id;
    END IF;
    IF v_r.address IS NOT NULL THEN
      INSERT INTO public.mail_suppression (workspace_id, address, reason, mailout_recipient_id)
      VALUES (v_r.workspace_id, v_r.address, 'complaint', v_r.id)
      ON CONFLICT (workspace_id, address) DO UPDATE
      SET reason = 'complaint', mailout_recipient_id = EXCLUDED.mailout_recipient_id, created_at = now(),
          created_by = NULL;
    END IF;
    IF v_r.audience_subscription_id IS NOT NULL THEN
      UPDATE public.audience_subscription
      SET status = 'unsubscribed', unsubscribed_at = coalesce(unsubscribed_at, now())
      WHERE id = v_r.audience_subscription_id;
      INSERT INTO public.audience_consent_event (workspace_id, subscription_id, kind, occurred_at, provider_event_id)
      VALUES (v_r.workspace_id, v_r.audience_subscription_id, 'complained', v_at, v_event_id)
      ON CONFLICT (provider_event_id) WHERE provider_event_id IS NOT NULL DO NOTHING;
    ELSE
      UPDATE public.mail_basis SET withdrawn_at = now()
      WHERE workspace_id = v_r.workspace_id AND address = v_r.address AND withdrawn_at IS NULL;
      PERFORM private.mailout_record_note(v_r, 'complained');
    END IF;
  ELSIF v_type IN ('reject', 'rendering_failure') AND v_r.status IN ('sending', 'queued', 'sent') THEN
    UPDATE public.mailout_recipient
    SET status = 'failed', claimed_at = NULL, last_error = left(coalesce(p_payload -> 'detail' ->> 'message', v_type::text), 500)
    WHERE id = v_r.id;
  END IF;
  PERFORM private.mailout_maybe_finish(v_r.mailout_id);
  RETURN true;
END;
$function$;
