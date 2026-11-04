-- 123 · `record_conversation_event` dejaba a quien edita una conversación
-- escribir un evento `source = 'email'` con los metadatos que quisiera (buzón,
-- id de Gmail, Message-ID, `external_ref`). Un correo así parecía sincronizado
-- y, por la idempotencia de `(workspace_id, source, external_ref)`, podía
-- incluso ocupar el sitio de un mensaje real antes de que llegara.
--
-- Qué hace ahora: la función, que es la puerta de las personas (exige
-- `auth.uid()`), rechaza `source = 'email'` con 42501. Los eventos de correo
-- sólo los escriben `mail_ingest_message` (la sincronización, service role) y
-- `private.mailout_record_conversation_event` (los envíos), que insertan por
-- su cuenta y no pasan por aquí. Las demás fuentes no cambian; la interfaz
-- (`POST /api/conversations/[id]/events`) no manda `p_source` y queda en
-- `manual`.
--
-- La tabla no tiene otra puerta: `authenticated` sólo tiene SELECT sobre
-- `conversation_event` y la única política es de lectura (comprobado en la
-- base viva el 2026-11-04).
--
-- Firma y cuerpo copiados de la base viva (`pg_get_functiondef`, 2026-11-04);
-- sólo se añade la guarda. CREATE OR REPLACE conserva owner y grants.

CREATE OR REPLACE FUNCTION public.record_conversation_event(p_conversation_id uuid, p_kind conversation_event_kind, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_direction conversation_event_direction DEFAULT NULL::conversation_event_direction, p_body text DEFAULT NULL::text, p_source conversation_event_source DEFAULT 'manual'::conversation_event_source, p_participants jsonb DEFAULT '[]'::jsonb, p_provenance jsonb DEFAULT '{}'::jsonb, p_external_ref text DEFAULT NULL::text, p_original_url text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS conversation_event
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   uuid := auth.uid();
  v_conv     public.conversation;
  v_occurred timestamptz := coalesce(p_occurred_at, statement_timestamp());
  v_ref      text := nullif(btrim(coalesce(p_external_ref, '')), '');
  v_row      public.conversation_event;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- 123: un correo sólo lo escribe la sincronización (o un envío).
  IF p_source = 'email' THEN
    RAISE EXCEPTION 'email events are written only by the mail sync' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_conv
  FROM public.conversation
  WHERE id = p_conversation_id AND deleted_at IS NULL
    AND (private_to IS NULL OR private_to = v_caller)
  FOR UPDATE;

  IF v_conv.id IS NULL OR NOT public.has_permission(v_conv.project_id, 'edit:conversation') THEN
    RAISE EXCEPTION 'conversation % not found', p_conversation_id USING ERRCODE = '42501';
  END IF;

  IF p_kind IS NULL THEN
    RAISE EXCEPTION 'kind is required' USING ERRCODE = '22023';
  END IF;

  IF v_occurred > statement_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'occurred_at is in the future' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.conversation_event (
    workspace_id, conversation_id, occurred_at, kind, source, direction,
    body, participants, provenance, external_ref, original_url, metadata,
    created_by
  ) VALUES (
    v_conv.workspace_id, v_conv.id, v_occurred, p_kind,
    coalesce(p_source, 'manual'), p_direction,
    nullif(btrim(coalesce(p_body, '')), ''),
    coalesce(p_participants, '[]'::jsonb),
    coalesce(p_provenance, '{}'::jsonb),
    v_ref,
    nullif(btrim(coalesce(p_original_url, '')), ''),
    coalesce(p_metadata, '{}'::jsonb),
    v_caller
  )
  ON CONFLICT (workspace_id, source, external_ref) WHERE external_ref IS NOT NULL
  DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    SELECT * INTO v_row
    FROM public.conversation_event
    WHERE workspace_id = v_conv.workspace_id
      AND source = coalesce(p_source, 'manual')
      AND external_ref = v_ref;
    RETURN v_row;
  END IF;

  IF p_kind <> 'note' OR p_direction IS NOT NULL THEN
    UPDATE public.conversation
    SET last_contacted_at = greatest(coalesce(last_contacted_at, v_occurred), v_occurred),
        first_contacted_at = coalesce(first_contacted_at, v_occurred)
    WHERE id = v_conv.id;
  END IF;

  RETURN v_row;
END;
$function$;
