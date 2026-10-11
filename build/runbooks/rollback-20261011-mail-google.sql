-- ROLLBACK for 20261011200000_mail_google.sql (comms carril 1: buzón de Google)
--
-- Deshace: las RPC de correo, `mail_message`, `mail_account`, sus enums, el
-- índice de eventos por buzón, `conversation.private_to` con su guarda, y
-- devuelve las policies de `conversation` y las RPC `record_conversation_event`
-- y `delete_conversation` a su forma anterior (sin la condición de privada).
--
-- DATOS QUE SE PIERDEN: las conexiones de buzón (hay que volver a conectar, y
-- los refresh tokens cifrados se van con ellas; conviene revocarlos antes desde
-- Ajustes o en la cuenta de Google) y la marca de privada de cada conversación:
-- TODAS LAS CONVERSACIONES PRIVADAS VUELVEN A SER VISIBLES PARA EL EQUIPO. Si
-- eso importa, avisar antes de aplicar.
-- Lo que se queda: los correos ya registrados (`conversation_event` con
-- source = email) y los sellos de último contacto que movieron.
--
-- Worker: un Worker con esta rama llama a /api/mail/* y a la columna
-- private_to; tras el rollback esas rutas dan 500 y el cron falla (sin
-- efecto en datos). Volver atrás el Worker primero, o a la vez.

BEGIN;

DROP FUNCTION IF EXISTS public.mail_sync_finish(uuid, public.mail_account_status, text, boolean, integer, text);
DROP FUNCTION IF EXISTS public.mail_ingest_message(uuid, jsonb, uuid);
DROP FUNCTION IF EXISTS public.mail_known_messages(uuid, text[]);
DROP FUNCTION IF EXISTS public.mail_contact_addresses(uuid);
DROP FUNCTION IF EXISTS public.mail_account_secret(uuid);
DROP FUNCTION IF EXISTS public.mail_sync_claim(integer, interval, uuid);
DROP FUNCTION IF EXISTS public.mail_send_authorize(uuid, uuid);
DROP FUNCTION IF EXISTS public.disconnect_mail_account(uuid);
DROP FUNCTION IF EXISTS public.can_manage_mail_account(uuid);
DROP FUNCTION IF EXISTS public.connect_mail_account(uuid, public.mail_account_scope, public.mail_provider, text, text, smallint);
DROP FUNCTION IF EXISTS public.mail_account_eligible_conversation(public.mail_account, public.conversation);

DROP INDEX IF EXISTS public.conversation_event_mail_account_idx;
DROP TABLE IF EXISTS public.mail_message;
DROP TABLE IF EXISTS public.mail_account;
DROP TYPE IF EXISTS public.mail_account_status;
DROP TYPE IF EXISTS public.mail_account_scope;
DROP TYPE IF EXISTS public.mail_provider;

-- Policies de conversation, como estaban.
DROP POLICY IF EXISTS conversation_select ON public.conversation;
CREATE POLICY conversation_select ON public.conversation
  FOR SELECT TO authenticated
  USING ((deleted_at IS NULL) AND has_permission(project_id, 'read:conversation'::text));

DROP POLICY IF EXISTS conversation_update ON public.conversation;
CREATE POLICY conversation_update ON public.conversation
  FOR UPDATE TO authenticated
  USING ((deleted_at IS NULL) AND has_permission(project_id, 'edit:conversation'::text))
  WITH CHECK (has_permission(project_id, 'edit:conversation'::text));

-- record_conversation_event, como en 20261009100000.
CREATE OR REPLACE FUNCTION public.record_conversation_event(
  p_conversation_id uuid,
  p_kind            public.conversation_event_kind,
  p_occurred_at     timestamptz DEFAULT NULL,
  p_direction       public.conversation_event_direction DEFAULT NULL,
  p_body            text DEFAULT NULL,
  p_source          public.conversation_event_source DEFAULT 'manual',
  p_participants    jsonb DEFAULT '[]'::jsonb,
  p_provenance      jsonb DEFAULT '{}'::jsonb,
  p_external_ref    text DEFAULT NULL,
  p_original_url    text DEFAULT NULL,
  p_metadata        jsonb DEFAULT '{}'::jsonb
) RETURNS public.conversation_event
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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

  -- FOR UPDATE: dos capturas a la vez sobre la misma conversación se ponen
  -- en fila y el máximo del último contacto no se pierde entre ellas.
  SELECT * INTO v_conv
  FROM public.conversation
  WHERE id = p_conversation_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_conv.id IS NULL OR NOT public.has_permission(v_conv.project_id, 'edit:conversation') THEN
    RAISE EXCEPTION 'conversation % not found', p_conversation_id USING ERRCODE = '42501';
  END IF;

  IF p_kind IS NULL THEN
    RAISE EXCEPTION 'kind is required' USING ERRCODE = '22023';
  END IF;

  -- Lo que ocurrió no puede estar en el futuro. Cinco minutos de holgura
  -- para el reloj de un conector; la app deja la hora al servidor.
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
    -- Ya estaba: idempotente, sin segundo efecto sobre el contacto.
    SELECT * INTO v_row
    FROM public.conversation_event
    WHERE workspace_id = v_conv.workspace_id
      AND source = coalesce(p_source, 'manual')
      AND external_ref = v_ref;
    RETURN v_row;
  END IF;

  -- Regla de contacto del contrato: todo menos una nota sin dirección.
  IF p_kind <> 'note' OR p_direction IS NOT NULL THEN
    UPDATE public.conversation
    SET last_contacted_at = greatest(coalesce(last_contacted_at, v_occurred), v_occurred),
        first_contacted_at = coalesce(first_contacted_at, v_occurred)
    WHERE id = v_conv.id;
  END IF;

  RETURN v_row;
END;
$$;

-- delete_conversation, como estaba.
CREATE OR REPLACE FUNCTION public.delete_conversation(p_conversation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller     uuid := auth.uid();
  v_project_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT project_id INTO v_project_id
  FROM public.conversation
  WHERE id = p_conversation_id AND deleted_at IS NULL;

  -- Not-found and no-permission collapse: no existence oracle.
  IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:conversation') THEN
    RAISE EXCEPTION 'conversation % not found', p_conversation_id
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.performance
    WHERE conversation_id = p_conversation_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'conversation has performances — unlink or delete them first'
      USING ERRCODE = '23503';
  END IF;

  UPDATE public.conversation
  SET deleted_at = now()
  WHERE id = p_conversation_id;
END;
$function$;

DROP TRIGGER IF EXISTS conversation_private_guard ON public.conversation;
DROP FUNCTION IF EXISTS public.guard_conversation_private();
DROP INDEX IF EXISTS public.conversation_private_to_idx;
ALTER TABLE public.conversation DROP COLUMN IF EXISTS private_to;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261011200000';

COMMIT;
