-- Rollback de 20261102180100_audience y 20261102180000_audience_enums
-- (ADR-173, el público, fase 1).
--
-- Antes: desplegar el Worker anterior si el nuevo ya llama a algo del público.
-- El Worker de hoy (fase 3 del envío) no lo necesita: las RPC que cambiaron
-- solo ganaron columnas o un parámetro con valor por defecto.
--
-- Se niega si hay datos del público (listas, invitaciones, dominios del
-- público): borrarlos es una decisión, no un efecto del rollback. Sin datos,
-- deja el esquema como 20261102170000 salvo los valores 'subscriber' de
-- `mailout_address_kind` y 'sector' de `mail_basis_kind` (ADR-174), que no se
-- pueden quitar de un enum. Una base `sector` ya apuntada en `mail_basis` se
-- queda, y la puerta del envío de antes la sigue aceptando (mira que haya base,
-- no cuál): quitarla es borrar esas filas a propósito.
-- Las funciones vuelven con su cuerpo vivo anterior (pg_get_functiondef de
-- la base reconstruida hasta 20261102170000, idéntica a producción el
-- 2026-11-02 por md5). Probado en local: aplicar, revertir y comparar el
-- pg_dump --schema-only de public y private con el de antes.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.audience)
     OR EXISTS (SELECT 1 FROM public.mailout WHERE kind = 'invitation')
     OR EXISTS (SELECT 1 FROM public.mail_domain WHERE purpose = 'audience') THEN
    RAISE EXCEPTION 'hay listas, invitaciones o dominios del público: exportar y borrar a propósito antes del rollback';
  END IF;
END;
$$;

-- ── Políticas, como antes ────────────────────────────────────────────────
ALTER POLICY mailout_select ON public.mailout
  USING (public.has_permission(project_id, 'read:conversation')
         AND private.mailout_readable_by_caller(id, created_by));

ALTER POLICY mailout_recipient_select ON public.mailout_recipient
  USING (
    EXISTS (SELECT 1 FROM public.mailout m WHERE m.id = mailout_recipient.mailout_id)
    AND EXISTS (SELECT 1 FROM public.conversation c WHERE c.id = mailout_recipient.conversation_id)
  );

-- ── Funciones nuevas fuera ────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.create_invitation(uuid, uuid, uuid[], uuid, uuid);
DROP FUNCTION IF EXISTS public.set_invitation_audience(uuid, uuid);
DROP FUNCTION IF EXISTS public.create_audience(uuid, text, text[], text);
DROP FUNCTION IF EXISTS public.update_audience(uuid, text, text, text[], text);
DROP FUNCTION IF EXISTS public.set_audience_consent_text(uuid, jsonb);
DROP FUNCTION IF EXISTS public.set_audience_status(uuid, public.audience_status);
DROP FUNCTION IF EXISTS public.regenerate_audience_form_key(uuid);
DROP FUNCTION IF EXISTS public.add_audience_subscription(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.import_audience(uuid, text, jsonb, public.mail_basis_kind, text, text);
DROP FUNCTION IF EXISTS public.unsubscribe_audience_subscription(uuid);
DROP FUNCTION IF EXISTS public.erase_audience_subscription(uuid);
DROP FUNCTION IF EXISTS public.audience_consent_proof(uuid);
DROP FUNCTION IF EXISTS public.audience_form_info(text, text);
DROP FUNCTION IF EXISTS public.audience_confirm_info(text);
DROP FUNCTION IF EXISTS public.mailout_unsubscribe_everything(text);
DROP FUNCTION IF EXISTS public.audience_subscribe(text, text, text, text, uuid, boolean, inet, text, public.audience_consent_channel, text);
DROP FUNCTION IF EXISTS public.audience_confirmation_token(uuid);
DROP FUNCTION IF EXISTS public.audience_confirm(text, inet, text);
DROP FUNCTION IF EXISTS public.audience_confirmation_sent(uuid, text);
DROP FUNCTION IF EXISTS public.audience_purge_pending();
DROP FUNCTION IF EXISTS public.audience_approve_import(uuid, uuid);
DROP FUNCTION IF EXISTS private.audience_request(public.audience, extensions.citext, text, text, uuid, boolean, public.audience_source, public.audience_consent_channel, inet, text, text, uuid);
DROP FUNCTION IF EXISTS private.audience_issue_token(uuid);
DROP FUNCTION IF EXISTS private.audience_basis_event(uuid);
DROP FUNCTION IF EXISTS private.audience_current_text(public.audience, text);
DROP FUNCTION IF EXISTS private.audience_for_caller(uuid, boolean);

-- Las que cambiaron de firma o de columnas de salida se rehacen enteras.
DROP FUNCTION IF EXISTS public.add_mail_domain(uuid, text, public.mail_sending_provider, text, text, public.mail_domain_purpose);
DROP FUNCTION IF EXISTS public.mailout_preview(uuid);
DROP FUNCTION IF EXISTS public.mailout_compose_preview(uuid);
DROP FUNCTION IF EXISTS public.mailout_send_context(uuid[]);
DROP FUNCTION IF EXISTS private.mailout_compose_rows(uuid[]);
DROP FUNCTION IF EXISTS public.mailout_unsubscribe_info(text);
DROP FUNCTION IF EXISTS public.mailout_claim(integer, uuid);

-- ── Funciones de antes, con su cuerpo vivo ────────────────────────────────
CREATE OR REPLACE FUNCTION private.mailout_compose_rows(p_recipient_ids uuid[])
 RETURNS TABLE(recipient_id uuid, mailout_id uuid, address_kind mailout_address_kind, basis_kind mail_basis_kind, contact_first_name text, contact_name text, organization_name text, city text, company_name text, company_city text, company_website text, company_phone text, company_signature text, privacy_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION private.mailout_for_caller(p_id uuid, p_edit boolean)
 RETURNS mailout
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.mailout;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT m.* INTO v_row FROM public.mailout m
  JOIN public.project p ON p.id = m.project_id AND p.deleted_at IS NULL
  WHERE m.id = p_id;
  IF v_row.id IS NULL
     OR NOT public.has_permission(v_row.project_id,
              CASE WHEN p_edit THEN 'edit:conversation' ELSE 'read:conversation' END) THEN
    RAISE EXCEPTION 'mailout % not found', p_id USING ERRCODE = '42501';
  END IF;
  RETURN v_row;
END;
$function$
;

CREATE OR REPLACE FUNCTION private.mailout_record_conversation_event(p_recipient mailout_recipient, p_body text, p_subject text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.add_mail_domain(p_workspace_id uuid, p_domain text, p_provider mail_sending_provider DEFAULT 'simulator'::mail_sending_provider, p_from_local_part text DEFAULT 'difusion'::text, p_from_name text DEFAULT NULL::text)
 RETURNS mail_domain
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_domain extensions.citext := lower(btrim(coalesce(p_domain, '')));
  v_row    public.mail_domain;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_workspace_admin(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace admin required' USING ERRCODE = '42501';
  END IF;
  IF v_domain !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' OR length(v_domain) > 253 THEN
    RAISE EXCEPTION 'domain is not valid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mail_domain d
             WHERE d.domain = v_domain
               AND (d.workspace_id = p_workspace_id OR (d.provider = 'ses' AND coalesce(p_provider, 'simulator') = 'ses'))) THEN
    RAISE EXCEPTION 'domain is not available' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.mail_domain (
    workspace_id, provider, domain, tenant_name, configuration_set, from_local_part, from_name, created_by
  )
  VALUES (p_workspace_id, coalesce(p_provider, 'simulator'), v_domain,
          'hour-' || p_workspace_id::text, 'hour-' || p_workspace_id::text,
          lower(coalesce(nullif(btrim(p_from_local_part), ''), 'difusion')),
          nullif(btrim(coalesce(p_from_name, '')), ''), auth.uid())
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mailout_approve_review(p_mailout_id uuid, p_reviewed_by uuid DEFAULT NULL::uuid)
 RETURNS mailout
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.mailout;
BEGIN
  UPDATE public.mailout
  SET status = 'queued', reviewed_at = now(), reviewed_by = p_reviewed_by
  WHERE id = p_mailout_id AND status = 'review'
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'mailout % is not waiting for review', p_mailout_id USING ERRCODE = '22023';
  END IF;
  UPDATE public.workspace
  SET mailout_reviewed_at = coalesce(mailout_reviewed_at, now()),
      mailout_reviewed_by = coalesce(mailout_reviewed_by, p_reviewed_by)
  WHERE id = v_row.workspace_id;
  RETURN v_row;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mailout_claim(p_limit integer DEFAULT 50, p_mailout_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(recipient_id uuid, mailout_id uuid, workspace_id uuid, conversation_id uuid, address text, display_name text, address_kind mailout_address_kind, basis_kind mail_basis_kind, unsubscribe_token text, attempts integer, provider mail_sending_provider, tenant_name text, configuration_set text, from_address text, from_name text, reply_to_address text, language text, subject text, body text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.mailout_compose_preview(p_id uuid)
 RETURNS TABLE(recipient_id uuid, mailout_id uuid, address_kind mailout_address_kind, basis_kind mail_basis_kind, contact_first_name text, contact_name text, organization_name text, city text, company_name text, company_city text, company_website text, company_phone text, company_signature text, privacy_url text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.mailout_preview(p_id uuid)
 RETURNS TABLE(recipient_id uuid, conversation_id uuid, address text, display_name text, address_kind mailout_address_kind, status mailout_recipient_status, skip_reason mailout_skip_reason, basis_kind mail_basis_kind, basis_withdrawn_at timestamp with time zone, suppressed_reason mail_suppression_reason, suppressed_at timestamp with time zone, ready boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

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
  v_r        public.mailout_recipient;
  v_new      uuid;
BEGIN
  IF v_event_id IS NULL OR v_type IS NULL THEN
    RAISE EXCEPTION 'provider_event_id and type are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_r FROM public.mailout_recipient
  WHERE (p_payload ? 'recipient_id' AND id = (p_payload ->> 'recipient_id')::uuid)
     OR (NOT p_payload ? 'recipient_id' AND provider_message_id = p_payload ->> 'provider_message_id')
  FOR UPDATE;
  IF v_r.id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.mailout_event (recipient_id, workspace_id, type, bounce_type, occurred_at, provider_event_id, detail)
  VALUES (v_r.id, v_r.workspace_id, v_type, v_bounce,
          least(coalesce((p_payload ->> 'occurred_at')::timestamptz, now()), now()),
          v_event_id, coalesce(p_payload -> 'detail', '{}'::jsonb))
  ON CONFLICT (provider_event_id) DO NOTHING
  RETURNING id INTO v_new;
  IF v_new IS NULL THEN
    RETURN false;
  END IF;

  IF v_type = 'send' AND v_r.status IN ('sending', 'queued') THEN
    -- mailout_record_sent no llegó: el correo salió igual.
    UPDATE public.mailout_recipient
    SET status = 'sent', sent_at = coalesce(sent_at, now()), claimed_at = NULL
    WHERE id = v_r.id RETURNING * INTO v_r;
    UPDATE public.mailout_recipient
    SET conversation_event_id = private.mailout_record_conversation_event(v_r, NULL)
    WHERE id = v_r.id;
  ELSIF v_type = 'delivery' AND v_r.status IN ('sending', 'sent') THEN
    UPDATE public.mailout_recipient SET status = 'delivered', sent_at = coalesce(sent_at, now())
    WHERE id = v_r.id;
  ELSIF v_type = 'bounce' AND v_bounce = 'Permanent' THEN
    UPDATE public.mailout_recipient SET status = 'bounced' WHERE id = v_r.id;
    INSERT INTO public.mail_suppression (workspace_id, address, reason, mailout_recipient_id)
    VALUES (v_r.workspace_id, v_r.address, 'bounce', v_r.id)
    ON CONFLICT (workspace_id, address) DO NOTHING;
  ELSIF v_type = 'complaint' THEN
    UPDATE public.mailout_recipient SET status = 'complained' WHERE id = v_r.id;
    INSERT INTO public.mail_suppression (workspace_id, address, reason, mailout_recipient_id)
    VALUES (v_r.workspace_id, v_r.address, 'complaint', v_r.id)
    ON CONFLICT (workspace_id, address) DO UPDATE
    SET reason = 'complaint', mailout_recipient_id = EXCLUDED.mailout_recipient_id, created_at = now(),
        created_by = NULL;
    UPDATE public.mail_basis SET withdrawn_at = now()
    WHERE workspace_id = v_r.workspace_id AND address = v_r.address AND withdrawn_at IS NULL;
    PERFORM private.mailout_record_note(v_r, 'complained');
  ELSIF v_type IN ('reject', 'rendering_failure') AND v_r.status IN ('sending', 'queued', 'sent') THEN
    UPDATE public.mailout_recipient
    SET status = 'failed', claimed_at = NULL, last_error = left(coalesce(p_payload -> 'detail' ->> 'message', v_type::text), 500)
    WHERE id = v_r.id;
  END IF;
  PERFORM private.mailout_maybe_finish(v_r.mailout_id);
  RETURN true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mailout_record_sent(p_recipient_id uuid, p_provider_message_id text, p_rfc_message_id text, p_body text, p_subject text DEFAULT NULL::text)
 RETURNS mailout_recipient
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.mailout_resubscribe(p_token text)
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
  DELETE FROM public.mail_suppression
  WHERE workspace_id = v_r.workspace_id AND address = v_r.address AND reason IN ('unsubscribe', 'complaint');
  IF NOT FOUND THEN
    RETURN;
  END IF;
  INSERT INTO public.mail_basis (workspace_id, address, kind, note)
  VALUES (v_r.workspace_id, v_r.address, 'consent', 'volvió a apuntarse desde la página de baja')
  ON CONFLICT (workspace_id, address) DO UPDATE
  SET kind = 'consent', note = EXCLUDED.note, evidence_event_id = NULL, recorded_by = NULL,
      recorded_at = now(), withdrawn_at = NULL;
  PERFORM private.mailout_record_note(v_r, 'resubscribed');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mailout_send_context(p_recipient_ids uuid[])
 RETURNS TABLE(recipient_id uuid, mailout_id uuid, address_kind mailout_address_kind, basis_kind mail_basis_kind, contact_first_name text, contact_name text, organization_name text, city text, company_name text, company_city text, company_website text, company_phone text, company_signature text, privacy_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT * FROM private.mailout_compose_rows(coalesce(p_recipient_ids, '{}'));
$function$
;

CREATE OR REPLACE FUNCTION public.mailout_unsubscribe(p_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_r    public.mailout_recipient;
  v_prev public.mail_suppression_reason;
BEGIN
  SELECT * INTO v_r FROM public.mailout_recipient
  WHERE unsubscribe_token = btrim(coalesce(p_token, '')) AND address IS NOT NULL;
  IF v_r.id IS NULL THEN
    RETURN;
  END IF;
  SELECT reason INTO v_prev FROM public.mail_suppression
  WHERE workspace_id = v_r.workspace_id AND address = v_r.address FOR UPDATE;
  IF v_prev IN ('unsubscribe', 'complaint') THEN
    RETURN;
  END IF;
  INSERT INTO public.mail_suppression (workspace_id, address, reason, mailout_recipient_id)
  VALUES (v_r.workspace_id, v_r.address, 'unsubscribe', v_r.id)
  ON CONFLICT (workspace_id, address) DO UPDATE
  SET reason = 'unsubscribe', mailout_recipient_id = EXCLUDED.mailout_recipient_id, created_at = now(),
      created_by = NULL;
  UPDATE public.mail_basis SET withdrawn_at = now()
  WHERE workspace_id = v_r.workspace_id AND address = v_r.address AND withdrawn_at IS NULL;
  PERFORM private.mailout_record_note(v_r, 'unsubscribed');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mailout_unsubscribe_info(p_token text)
 RETURNS TABLE(company_name text, language text, unsubscribed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT w.name, m.language,
         EXISTS (SELECT 1 FROM public.mail_suppression s
                 WHERE s.workspace_id = r.workspace_id AND s.address = r.address
                   AND s.reason IN ('unsubscribe', 'complaint'))
  FROM public.mailout_recipient r
  JOIN public.mailout m ON m.id = r.mailout_id
  JOIN public.workspace w ON w.id = r.workspace_id
  WHERE r.unsubscribe_token = btrim(coalesce(p_token, '')) AND r.address IS NOT NULL;
$function$
;

CREATE OR REPLACE FUNCTION public.queue_mailout(p_id uuid)
 RETURNS mailout
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.remove_mail_domain(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ws uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.mail_domain WHERE id = p_id FOR UPDATE;
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT public.is_workspace_admin(v_ws) THEN
    RAISE EXCEPTION 'mail domain % not found', p_id USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mailout m
             WHERE m.mail_domain_id = p_id AND m.status IN ('review', 'queued', 'sending', 'paused')) THEN
    RAISE EXCEPTION 'a mailout in progress uses this domain' USING ERRCODE = '23503';
  END IF;
  DELETE FROM public.mail_domain WHERE id = p_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_mail_domain_sender(p_id uuid, p_from_local_part text, p_from_name text DEFAULT NULL::text)
 RETURNS mail_domain
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ws  uuid;
  v_row public.mail_domain;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.mail_domain WHERE id = p_id;
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT public.is_workspace_admin(v_ws) THEN
    RAISE EXCEPTION 'mail domain % not found', p_id USING ERRCODE = '42501';
  END IF;
  UPDATE public.mail_domain
  SET from_local_part = lower(coalesce(nullif(btrim(p_from_local_part), ''), 'difusion')),
      from_name = nullif(btrim(coalesce(p_from_name, '')), '')
  WHERE id = p_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_mailout_recipients(p_id uuid, p_conversation_ids uuid[])
 RETURNS SETOF mailout_recipient
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_m     public.mailout := private.mailout_for_caller(p_id, true);
  v_ids   uuid[];
  v_found integer;
BEGIN
  IF v_m.status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft can change its recipients' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_ids FROM unnest(p_conversation_ids) x WHERE x IS NOT NULL;
  IF cardinality(v_ids) > 2000 THEN
    RAISE EXCEPTION 'at most 2000 recipients per mailout' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_found FROM public.conversation c
  WHERE c.id = ANY (v_ids) AND c.deleted_at IS NULL
    AND c.project_id = v_m.project_id
    AND (c.private_to IS NULL OR c.private_to = auth.uid());
  IF v_found <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'a conversation is not available for this mailout' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.mailout_recipient WHERE mailout_id = v_m.id;

  INSERT INTO public.mailout_recipient (
    mailout_id, workspace_id, conversation_id, person_id, address, display_name, address_kind,
    status, skip_reason
  )
  -- Un duplicado se queda sin dirección: sale una vez, por la primera.
  SELECT v_m.id, v_m.workspace_id, r.conversation_id, r.person_id,
         CASE WHEN r.dup = 1 THEN r.address END, r.display_name, CASE WHEN r.dup = 1 THEN r.kind END,
         CASE WHEN r.address IS NULL OR r.dup > 1 THEN 'skipped' ELSE 'pending' END::public.mailout_recipient_status,
         CASE WHEN r.address IS NULL THEN 'no_address'
              WHEN r.dup > 1 THEN 'duplicate' END::public.mailout_skip_reason
  FROM (
    SELECT a.*,
           -- La misma dirección en dos conversaciones: sale una vez.
           CASE WHEN a.address IS NULL THEN 1
                ELSE row_number() OVER (PARTITION BY a.address ORDER BY a.conversation_id) END AS dup
    FROM (
      SELECT c.id AS conversation_id,
             CASE WHEN wp.email IS NOT NULL THEN wp.person_id END AS person_id,
             coalesce(wp.email, o.email) AS address,
             left(CASE WHEN wp.email IS NOT NULL THEN wp.full_name ELSE o.name END, 200) AS display_name,
             CASE WHEN wp.email IS NOT NULL THEN 'contact'
                  WHEN o.email IS NOT NULL THEN 'organization' END::public.mailout_address_kind AS kind
      FROM public.conversation c
      LEFT JOIN public.conversation_contact cc ON cc.conversation_id = c.id AND cc.is_primary
      LEFT JOIN public.workspace_person wp
        ON wp.workspace_id = cc.workspace_id AND wp.person_id = cc.person_id AND wp.deleted_at IS NULL
      LEFT JOIN public.workspace_organization o
        ON o.workspace_id = c.workspace_id AND o.id = c.organization_id AND o.deleted_at IS NULL
      WHERE c.id = ANY (v_ids)
    ) a
  ) r;

  RETURN QUERY SELECT * FROM public.mailout_recipient WHERE mailout_id = v_m.id ORDER BY created_at, id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_membership_facet(p_membership_id uuid, p_facet_id uuid, p_verb access_verb DEFAULT NULL::access_verb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_m      public.membership;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_m FROM public.membership WHERE id = p_membership_id;
  IF v_m.id IS NULL OR NOT private.can_manage_membership(v_m.id, v_caller) THEN
    RAISE EXCEPTION 'membership not found' USING ERRCODE = '42501';
  END IF;
  IF v_m.level = 'workspace' THEN
    RAISE EXCEPTION 'workspace-level facets are not decided yet' USING ERRCODE = '0A000';
  END IF;

  IF p_verb IS NULL THEN
    DELETE FROM public.membership_facet
    WHERE membership_id = v_m.id AND facet_id = p_facet_id;
    RETURN;
  END IF;

  IF NOT private.model_has_facet_at(v_m.level, private.membership_container_id(v_m), p_facet_id, p_verb, v_caller) THEN
    RAISE EXCEPTION 'you can only grant what you hold' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.membership_facet (membership_id, facet_id, verb, source, granted_by)
  VALUES (v_m.id, p_facet_id, p_verb, 'override', v_caller)
  ON CONFLICT (membership_id, facet_id) DO UPDATE SET
    verb       = EXCLUDED.verb,
    source     = 'override',
    granted_by = EXCLUDED.granted_by;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_mailout(p_id uuid, p_subject text, p_body text, p_language text DEFAULT 'es'::text, p_from_local_part text DEFAULT 'difusion'::text, p_from_name text DEFAULT NULL::text, p_mail_domain_id uuid DEFAULT NULL::uuid, p_reply_to_mail_account_id uuid DEFAULT NULL::uuid)
 RETURNS mailout
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_m   public.mailout := private.mailout_for_caller(p_id, true);
  v_row public.mailout;
BEGIN
  IF v_m.status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft can be edited' USING ERRCODE = '22023';
  END IF;
  IF p_mail_domain_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.mail_domain d WHERE d.id = p_mail_domain_id AND d.workspace_id = v_m.workspace_id
  ) THEN
    RAISE EXCEPTION 'mail domain % not found', p_mail_domain_id USING ERRCODE = '22023';
  END IF;
  IF p_reply_to_mail_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.mail_account a
    WHERE a.id = p_reply_to_mail_account_id AND a.workspace_id = v_m.workspace_id
      AND (a.scope = 'workspace' OR a.owner_user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'mail account % not usable', p_reply_to_mail_account_id USING ERRCODE = '22023';
  END IF;
  UPDATE public.mailout
  SET subject = nullif(btrim(coalesce(p_subject, '')), ''),
      body = nullif(btrim(coalesce(p_body, '')), ''),
      language = coalesce(nullif(btrim(p_language), ''), 'es'),
      from_local_part = lower(coalesce(nullif(btrim(p_from_local_part), ''), 'difusion')),
      from_name = nullif(btrim(coalesce(p_from_name, '')), ''),
      mail_domain_id = p_mail_domain_id,
      reply_to_mail_account_id = p_reply_to_mail_account_id
  WHERE id = v_m.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$
;


DO $$
DECLARE
  f text;
BEGIN
  EXECUTE 'ALTER FUNCTION private.mailout_compose_rows(uuid[]) OWNER TO postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION private.mailout_compose_rows(uuid[]) FROM PUBLIC, anon, authenticated, service_role';
  FOREACH f IN ARRAY ARRAY[
    'public.add_mail_domain(uuid, text, public.mail_sending_provider, text, text)',
    'public.mailout_preview(uuid)',
    'public.mailout_compose_preview(uuid)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  EXECUTE 'ALTER FUNCTION public.mailout_unsubscribe_info(text) OWNER TO postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION public.mailout_unsubscribe_info(text) FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.mailout_unsubscribe_info(text) TO anon, authenticated, service_role';
  FOREACH f IN ARRAY ARRAY['public.mailout_send_context(uuid[])', 'public.mailout_claim(integer, uuid)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END;
$$;

-- ── Tablas y columnas ─────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS private.invitation_readable_by_caller(uuid, uuid, uuid);

ALTER TABLE public.mailout_recipient
  DROP CONSTRAINT IF EXISTS mailout_recipient_in_flight_has_domain,
  DROP CONSTRAINT IF EXISTS mailout_recipient_subscriber_kind,
  DROP CONSTRAINT IF EXISTS mailout_recipient_subscriber_basis,
  DROP CONSTRAINT IF EXISTS mailout_recipient_consent_event_is_subscriber,
  DROP CONSTRAINT IF EXISTS mailout_recipient_mailout_subscription_key,
  DROP CONSTRAINT IF EXISTS mailout_recipient_one_origin,
  DROP COLUMN IF EXISTS consent_event_id,
  DROP COLUMN IF EXISTS mail_domain_id,
  DROP COLUMN IF EXISTS audience_subscription_id,
  ALTER COLUMN conversation_id SET NOT NULL;

DROP TRIGGER IF EXISTS mailout_guard_kind ON public.mailout;
DROP FUNCTION IF EXISTS private.mailout_guard_kind();
ALTER TABLE public.mailout
  DROP CONSTRAINT IF EXISTS mailout_audience_domain_has_audience,
  DROP CONSTRAINT IF EXISTS mailout_performance_is_invitation,
  DROP CONSTRAINT IF EXISTS mailout_audience_is_invitation,
  DROP CONSTRAINT IF EXISTS mailout_outreach_has_project,
  DROP COLUMN IF EXISTS performance_id,
  DROP COLUMN IF EXISTS audience_mail_domain_id,
  DROP COLUMN IF EXISTS audience_id,
  DROP COLUMN IF EXISTS kind,
  ALTER COLUMN project_id SET NOT NULL;

DROP TABLE IF EXISTS public.audience_consent_event;
DROP TABLE IF EXISTS public.audience_subscription;
DROP TABLE IF EXISTS public.audience_import;
DROP TABLE IF EXISTS public.audience_consent_text;
DROP TABLE IF EXISTS public.audience;
DROP FUNCTION IF EXISTS private.audience_guard_open();
DROP FUNCTION IF EXISTS private.audience_guard_immutable();

ALTER TABLE public.mail_domain DROP COLUMN IF EXISTS purpose;

DROP INDEX IF EXISTS public.workspace_invitation_reviewed_by_idx;
ALTER TABLE public.workspace
  DROP CONSTRAINT IF EXISTS workspace_invitation_daily_cap_check,
  DROP COLUMN IF EXISTS invitation_reviewed_by,
  DROP COLUMN IF EXISTS invitation_reviewed_at,
  DROP COLUMN IF EXISTS invitation_daily_cap;

-- ── La faceta Público ─────────────────────────────────────────────────────
DELETE FROM public.membership_facet mf
USING public.facet f
WHERE f.id = mf.facet_id AND f.key = 'audience' AND f.workspace_id IS NULL;
DELETE FROM public.facet WHERE key = 'audience' AND workspace_id IS NULL;
DROP FUNCTION IF EXISTS private.audience_access(uuid, boolean);

DROP TYPE IF EXISTS public.audience_import_status;
DROP TYPE IF EXISTS public.audience_consent_channel;
DROP TYPE IF EXISTS public.audience_consent_event_kind;
DROP TYPE IF EXISTS public.audience_source;
DROP TYPE IF EXISTS public.audience_subscription_status;
DROP TYPE IF EXISTS public.audience_status;
DROP TYPE IF EXISTS public.mailout_kind;
DROP TYPE IF EXISTS public.mail_domain_purpose;

DELETE FROM supabase_migrations.schema_migrations WHERE version IN ('20261102180100', '20261102180000');

COMMIT;
