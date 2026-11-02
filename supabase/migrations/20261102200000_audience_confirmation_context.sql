-- Punto 98, fase 2 (plan 2026-11-01-audience § 3.3, ADR-175): el correo de
-- confirmación de un alta del público.
--
-- 1. audience_confirmation_context (nueva, máquina): a quién, en qué idioma,
--    de qué lista y por qué identidad sale. La identidad es el primer dominio
--    verificado del espacio con propósito `audience` (ADR-173 § 5). Sin ruta
--    de entrega (sin ese dominio, o un espacio solo-simulador y una dirección
--    fuera del simulador), `provider` NULL y el Worker no manda nada.
-- 2. audience_subscribe (redefinida, firma y cuerpo copiados de la base viva
--    con pg_get_functiondef el 2026-11-02): sin ruta de entrega no escribe
--    nada ni emite token. Así un espacio solo-simulador nunca manda una
--    confirmación a una dirección real (lo que queue_mailout ya cumple para
--    las invitaciones), y un alta que no puede salir no gasta el cupo de la
--    persona (24 horas, tres en total). La respuesta a la persona es la misma.
-- 3. audience_confirmation_failed (nueva, máquina): si el proveedor no acepta
--    el correo, el token se anula y el cupo vuelve.
-- 4. mailout_unsubscribe_everything (redefinida, firma y cuerpo de la base
--    viva): «no recibir nada más» ya no convierte una exclusión por rebote o
--    manual en `unsubscribe`, ni le pone el destinatario; así «volver a
--    apuntarme» (audience_resubscribe, que solo borra `unsubscribe` y
--    `complaint` nacidas de esa suscripción) no la borra.
--
-- Rollback: DROP FUNCTION de las dos nuevas; las dos redefinidas, con su
-- cuerpo de 20261102180100_audience.sql.

-- ── ¿Hay por dónde mandar la confirmación? ────────────────────────────────
CREATE FUNCTION private.audience_confirmation_route(p_workspace_id uuid, p_address text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT d.id
  FROM public.mail_domain d
  JOIN public.workspace w ON w.id = d.workspace_id
  WHERE d.workspace_id = p_workspace_id AND d.purpose = 'audience' AND d.verified_at IS NOT NULL
    AND (NOT w.mailout_simulator_only OR lower(p_address) LIKE '%@simulator.amazonses.com')
  ORDER BY d.created_at, d.id
  LIMIT 1;
$$;

COMMENT ON FUNCTION private.audience_confirmation_route(uuid, text) IS
  'ADR-175: the audience domain a confirmation email to this address goes out through, or NULL (no verified audience domain, or a simulator-only workspace and an address outside the SES simulator).';

-- ── 1. El contexto del correo ─────────────────────────────────────────────
CREATE FUNCTION public.audience_confirmation_context(p_subscription_id uuid)
RETURNS TABLE (
  address            text,
  name               text,
  language           text,
  audience_name      text,
  company_name       text,
  logo_url           text,
  form_key           text,
  provider           public.mail_sending_provider,
  from_address       text,
  from_name          text,
  tenant_name        text,
  configuration_set  text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT s.address::text, s.name, s.language, a.name, w.name, w.logo_url, a.form_key,
         d.provider, d.from_local_part || '@' || d.domain::text, coalesce(d.from_name, w.name),
         d.tenant_name, d.configuration_set
  FROM public.audience_subscription s
  JOIN public.audience a ON a.id = s.audience_id
  JOIN public.workspace w ON w.id = s.workspace_id
  LEFT JOIN public.mail_domain d ON d.id = private.audience_confirmation_route(s.workspace_id, s.address::text)
  WHERE s.id = p_subscription_id;
$$;

COMMENT ON FUNCTION public.audience_confirmation_context(uuid) IS
  'ADR-173 · ADR-175: who gets the confirmation email of a subscription, in which language, and through which audience identity (NULL provider = no route, send nothing). service_role only.';

-- ── 2. El alta, sin token si no hay por dónde mandarlo ────────────────────
CREATE OR REPLACE FUNCTION public.audience_subscribe(p_key text, p_address text, p_name text, p_language text, p_text_id uuid, p_age_confirmed boolean, p_ip inet, p_user_agent text, p_channel audience_consent_channel DEFAULT 'form'::audience_consent_channel, p_page_url text DEFAULT NULL::text)
 RETURNS TABLE(subscription_id uuid, token text, language text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_a       public.audience;
  v_address extensions.citext := lower(btrim(coalesce(p_address, '')));
  v_lang    text;
  v_text    public.audience_consent_text;
  v_id      uuid;
BEGIN
  IF coalesce(p_channel, 'form') NOT IN ('form', 'embed') THEN
    RAISE EXCEPTION 'channel must be form or embed' USING ERRCODE = '22023';
  END IF;
  IF v_address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_address) > 254 THEN
    RAISE EXCEPTION 'address is not valid' USING ERRCODE = '22023';
  END IF;
  IF p_age_confirmed IS NOT TRUE THEN
    RAISE EXCEPTION 'the age statement is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_a FROM public.audience WHERE form_key = btrim(coalesce(p_key, '')) AND status = 'open';
  -- Sin ruta de entrega (ADR-175), como una lista cerrada: nada escrito, sin token.
  IF v_a.id IS NULL OR private.audience_confirmation_route(v_a.workspace_id, v_address::text) IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;
  v_lang := CASE WHEN p_language = ANY (v_a.languages) THEN p_language ELSE v_a.default_language END;
  IF p_text_id IS NULL THEN
    v_text := private.audience_current_text(v_a, v_lang);
  ELSE
    SELECT * INTO v_text FROM public.audience_consent_text t WHERE t.id = p_text_id AND t.audience_id = v_a.id;
  END IF;
  IF v_text.id IS NULL THEN
    RAISE EXCEPTION 'consent text not found for this list' USING ERRCODE = '22023';
  END IF;
  v_id := private.audience_request(
    v_a, v_address, p_name, v_text.language, v_text.id, true, coalesce(p_channel, 'form')::text::public.audience_source,
    coalesce(p_channel, 'form'), p_ip, p_user_agent, p_page_url, NULL
  );
  RETURN QUERY SELECT v_id, CASE WHEN v_id IS NOT NULL THEN private.audience_issue_token(v_id) END, v_text.language;
END;
$function$;

-- ── 3. El proveedor no aceptó el correo: el cupo vuelve ───────────────────
CREATE FUNCTION public.audience_confirmation_failed(p_subscription_id uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  UPDATE public.audience_subscription
  SET confirm_token_hash = NULL,
      confirm_expires_at = NULL,
      confirm_sent_count = greatest(confirm_sent_count - 1, 0),
      confirm_last_sent_at = NULL
  WHERE id = p_subscription_id AND status <> 'confirmed' AND confirm_provider_message_id IS NULL
    AND confirm_token_hash IS NOT NULL;
$$;

COMMENT ON FUNCTION public.audience_confirmation_failed(uuid) IS
  'ADR-175: the provider did not accept the confirmation email; the token is voided and the sending quota (24 h, three in all) given back. service_role only.';

-- ── 4. «No recibir nada más» no degrada un rebote ni una exclusión manual ──
CREATE OR REPLACE FUNCTION public.mailout_unsubscribe_everything(p_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_r public.mailout_recipient;
BEGIN
  SELECT * INTO v_r FROM public.mailout_recipient
  WHERE unsubscribe_token = btrim(coalesce(p_token, '')) AND address IS NOT NULL;
  IF v_r.id IS NULL THEN
    RETURN;
  END IF;
  PERFORM public.mailout_unsubscribe(p_token);
  INSERT INTO public.mail_suppression (workspace_id, address, reason, mailout_recipient_id)
  VALUES (v_r.workspace_id, v_r.address, 'unsubscribe', v_r.id)
  ON CONFLICT (workspace_id, address) DO UPDATE
  SET reason = CASE WHEN mail_suppression.reason IN ('complaint', 'bounce', 'manual') THEN mail_suppression.reason
                    ELSE 'unsubscribe'::public.mail_suppression_reason END,
      mailout_recipient_id = CASE WHEN mail_suppression.reason IN ('complaint', 'bounce', 'manual')
                                  THEN mail_suppression.mailout_recipient_id
                                  ELSE coalesce(mail_suppression.mailout_recipient_id, EXCLUDED.mailout_recipient_id) END,
      created_by = CASE WHEN mail_suppression.reason = 'manual' THEN mail_suppression.created_by END;
END;
$function$;

-- ── Grants ────────────────────────────────────────────────────────────────
ALTER FUNCTION private.audience_confirmation_route(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.audience_confirmation_route(uuid, text) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.audience_confirmation_context(uuid)',
    'public.audience_confirmation_failed(uuid)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END;
$$;
