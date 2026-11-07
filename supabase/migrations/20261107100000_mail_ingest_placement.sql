-- 127 · ADR-187: un correo entra donde toca, no en todas las conversaciones
-- donde la contraparte es contacto.
--
-- Hasta ahora `mail_ingest_message` creaba un evento en CADA conversación
-- elegible donde alguna contraparte era contacto (por fechas o por hilo), con
-- el cuerpo copiado en cada una: la misma persona, contacto de la misma sala
-- en dos proyectos, veía cada correo en las dos conversaciones.
--
-- Ahora, en este orden:
--   1. Hilo: si el correo sigue un hilo que ya está en una o más
--      conversaciones (mismo `provider_thread_id` en el mismo buzón, o un
--      In-Reply-To/References que nombra un correo suyo), entra solo en esas.
--   2. Un solo candidato: sin hilo, si la contraparte era contacto ese día de
--      una sola conversación, entra ahí.
--   3. Dos o más candidatos sin hilo: entra en la de actividad más reciente
--      (`last_contacted_at`, sin fecha al final; desempate por id), con
--      `metadata.placement = 'guess'` y `metadata.candidates` (los ids, en ese
--      orden). Es lo que «Por colocar» preguntará cuando exista.
-- Lo demás no cambia: elegibilidad del buzón, la espera de una respuesta que
-- llega antes que su hilo, el vínculo de 111, el recuento de lo visible.
--
-- Firma y cuerpo copiados de la base viva (`pg_get_functiondef`, 2026-11-07);
-- solo cambia cómo se eligen las conversaciones y dos claves de `metadata`.
-- CREATE OR REPLACE conserva owner y grants. Sin datos que migrar (en
-- producción, 1 correo sincronizado y ninguno en dos conversaciones).
-- Rollback: `build/runbooks/rollback-20261107-mail-ingest-placement.sql`.

CREATE OR REPLACE FUNCTION public.mail_ingest_message(p_account_id uuid, p_message jsonb, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_acc        public.mail_account;
  v_msg_id     text := nullif(btrim(coalesce(p_message ->> 'provider_message_id', '')), '');
  v_rfc        text := nullif(btrim(coalesce(p_message ->> 'rfc_message_id', '')), '');
  v_thread     text := nullif(btrim(coalesce(p_message ->> 'provider_thread_id', '')), '');
  v_direction  public.conversation_event_direction;
  v_occurred   timestamptz;
  v_day        date;
  v_counter    text[];
  v_refs       text[];
  v_ref_base   text;
  v_created    integer := 0;
  v_visible    integer := 0;
  v_wait       boolean;
  v_conv       public.conversation;
  v_event_id   uuid;
  v_by_thread  uuid[];
  v_by_date    uuid[];
  v_targets    uuid[];
  v_guess      boolean := false;
BEGIN
  SELECT * INTO v_acc FROM public.mail_account WHERE id = p_account_id;
  IF v_acc.id IS NULL THEN
    RAISE EXCEPTION 'mail account % not found', p_account_id USING ERRCODE = '42501';
  END IF;
  IF v_msg_id IS NULL THEN
    RAISE EXCEPTION 'provider_message_id is required' USING ERRCODE = '22023';
  END IF;
  v_direction := (p_message ->> 'direction')::public.conversation_event_direction;
  v_occurred := least(coalesce((p_message ->> 'occurred_at')::timestamptz, statement_timestamp()),
                      statement_timestamp());
  v_day := (v_occurred AT TIME ZONE coalesce(
    (SELECT w.timezone FROM public.workspace w WHERE w.id = v_acc.workspace_id), 'UTC'))::date;
  SELECT coalesce(array_agg(DISTINCT lower(btrim(x))), '{}')
  INTO v_counter
  FROM jsonb_array_elements_text(coalesce(p_message -> 'counterparts', '[]'::jsonb)) AS x
  WHERE btrim(x) <> '';
  -- Los Message-ID a los que responde: In-Reply-To más References (los 50
  -- últimos bastan para encontrar el hilo).
  SELECT coalesce(array_agg(DISTINCT r), '{}')
  INTO v_refs
  FROM (
    SELECT btrim(x) AS r
    FROM jsonb_array_elements_text(
      CASE jsonb_typeof(p_message -> 'references') WHEN 'array' THEN p_message -> 'references' ELSE '[]'::jsonb END
    ) AS x
    WHERE btrim(x) <> '' AND length(x) <= 998
    UNION
    SELECT btrim(p_message ->> 'in_reply_to')
    WHERE btrim(coalesce(p_message ->> 'in_reply_to', '')) <> '' AND length(p_message ->> 'in_reply_to') <= 998
  ) refs
  WHERE r IS NOT NULL;
  IF cardinality(v_refs) > 50 THEN
    v_refs := v_refs[1:50];
  END IF;

  -- Ya procesado en este buzón: nada que hacer, salvo que esperara su hilo
  -- (entonces se vuelve a intentar).
  INSERT INTO public.mail_message (mail_account_id, provider_message_id, provider_thread_id, rfc_message_id)
  VALUES (v_acc.id, v_msg_id, v_thread, v_rfc)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.mail_message
    WHERE mail_account_id = v_acc.id AND provider_message_id = v_msg_id AND deferred
  ) THEN
    RETURN 0;
  END IF;

  v_ref_base := 'mail:' || coalesce(v_rfc, v_acc.provider::text || ':' || v_acc.id::text || ':' || v_msg_id);

  -- ADR-187: los candidatos, por hilo y por fechas. Por hilo, de quien es o
  -- fue contacto; por fechas, de quien lo era ese día. Los de fechas, del más
  -- reciente al más antiguo.
  SELECT coalesce(array_agg(x.id ORDER BY x.id) FILTER (WHERE x.by_thread), '{}'),
         coalesce(array_agg(x.id ORDER BY x.last_contacted_at DESC NULLS LAST, x.id) FILTER (WHERE x.by_date), '{}')
  INTO v_by_thread, v_by_date
  FROM (
    SELECT c.id, c.last_contacted_at,
      EXISTS (
        SELECT 1
        FROM public.conversation_contact cc
        JOIN public.workspace_person wp
          ON wp.workspace_id = cc.workspace_id AND wp.person_id = cc.person_id
         AND wp.deleted_at IS NULL
        WHERE cc.conversation_id = c.id
          AND lower(wp.email::text) = ANY (v_counter)
      ) AND (
        EXISTS (
          SELECT 1 FROM public.conversation_event e
          WHERE e.conversation_id = c.id AND e.source = 'email'
            AND v_thread IS NOT NULL
            AND e.metadata ->> 'provider_thread_id' = v_thread
            AND e.metadata ->> 'mail_account_id' = v_acc.id::text
        )
        OR EXISTS (
          SELECT 1 FROM public.conversation_event e
          WHERE e.workspace_id = c.workspace_id AND e.source = 'email'
            AND e.external_ref IN (
              SELECT 'mail:' || r || '#' || c.id::text FROM unnest(v_refs) AS r
            )
        )
      ) AS by_thread,
      EXISTS (
        SELECT 1
        FROM public.conversation_contact cc
        JOIN public.workspace_person wp
          ON wp.workspace_id = cc.workspace_id AND wp.person_id = cc.person_id
         AND wp.deleted_at IS NULL
        WHERE cc.conversation_id = c.id
          AND lower(wp.email::text) = ANY (v_counter)
          AND (cc.since IS NULL OR v_day >= cc.since) AND (cc.until IS NULL OR v_day <= cc.until)
      ) AS by_date
    FROM public.conversation c
    WHERE c.workspace_id = v_acc.workspace_id
      AND public.mail_account_eligible_conversation(v_acc, c)
  ) x;

  IF cardinality(v_by_thread) > 0 THEN
    v_targets := v_by_thread;
  ELSIF cardinality(v_by_date) = 1 THEN
    v_targets := v_by_date;
  ELSIF cardinality(v_by_date) > 1 THEN
    v_targets := v_by_date[1:1];
    v_guess := true;
  ELSE
    v_targets := '{}';
  END IF;

  FOR v_conv IN
    SELECT c.* FROM public.conversation c
    WHERE c.id = ANY (v_targets)
    ORDER BY c.id
    FOR UPDATE OF c
  LOOP
    v_event_id := NULL;
    INSERT INTO public.conversation_event (
      workspace_id, conversation_id, occurred_at, kind, source, direction,
      body, participants, provenance, external_ref, metadata, created_by
    ) VALUES (
      v_conv.workspace_id, v_conv.id, v_occurred, 'email', 'email', v_direction,
      nullif(btrim(left(coalesce(p_message ->> 'body', ''), 20000)), ''),
      (SELECT coalesce(jsonb_agg(jsonb_build_object('address', a)), '[]'::jsonb) FROM unnest(v_counter) a),
      jsonb_build_object('connector', 'mail_sync', 'provider', v_acc.provider),
      v_ref_base || '#' || v_conv.id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'mail_account_id', v_acc.id,
        'mailbox_address', v_acc.address::text,
        'mailbox_scope', v_acc.scope,
        'provider', v_acc.provider,
        'provider_message_id', v_msg_id,
        'provider_thread_id', v_thread,
        'rfc_message_id', v_rfc,
        'subject', left(p_message ->> 'subject', 998),
        'from', left(p_message ->> 'from', 998),
        'to', p_message -> 'to',
        'cc', p_message -> 'cc',
        -- ADR-126 § 3: an automatic reply (Auto-Submitted, X-Autoreply…) is
        -- not an answer; the turn and «replies» skip it. Only when true.
        'auto', CASE WHEN (p_message ->> 'auto') = 'true' THEN true END,
        -- ADR-187: placed by guess among several candidates (most recent).
        'placement', CASE WHEN v_guess THEN 'guess' END,
        'candidates', CASE WHEN v_guess THEN to_jsonb(v_by_date) END
      )),
      p_created_by
    )
    ON CONFLICT (workspace_id, source, external_ref) WHERE external_ref IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_event_id;

    IF v_event_id IS NOT NULL THEN
      -- 111: el evento que creó este correo de este buzón (la prueba del original).
      INSERT INTO public.mail_message_event (mail_account_id, provider_message_id, conversation_event_id)
      VALUES (v_acc.id, v_msg_id, v_event_id)
      ON CONFLICT DO NOTHING;
      v_created := v_created + 1;
      IF v_conv.private_to IS NULL
         OR (v_acc.scope = 'personal' AND v_conv.private_to = v_acc.owner_user_id) THEN
        v_visible := v_visible + 1;
      END IF;
      UPDATE public.conversation
      SET last_contacted_at = greatest(coalesce(last_contacted_at, v_occurred), v_occurred),
          first_contacted_at = coalesce(first_contacted_at, v_occurred)
      WHERE id = v_conv.id;
    END IF;
  END LOOP;

  -- No entró en ninguna, pero es de alguien que es o fue contacto de una
  -- conversación elegible y sigue un hilo: espera a que su hilo llegue.
  v_wait := v_created = 0
    AND (v_thread IS NOT NULL OR cardinality(v_refs) > 0)
    AND EXISTS (
      SELECT 1
      FROM public.conversation c
      JOIN public.conversation_contact cc ON cc.conversation_id = c.id
      JOIN public.workspace_person wp
        ON wp.workspace_id = cc.workspace_id AND wp.person_id = cc.person_id
       AND wp.deleted_at IS NULL
      WHERE c.workspace_id = v_acc.workspace_id
        AND lower(wp.email::text) = ANY (v_counter)
        AND public.mail_account_eligible_conversation(v_acc, c)
    );

  UPDATE public.mail_message
  SET events_created = events_created + v_created,
      deferred = v_wait,
      refs = CASE WHEN v_wait THEN v_refs ELSE '{}' END
  WHERE mail_account_id = v_acc.id AND provider_message_id = v_msg_id;
  RETURN v_visible;
END;
$function$;
