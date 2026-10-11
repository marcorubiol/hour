-- ADR-099 · Comms, carril 1: el buzón sincronizado (primero Google).
--
-- Aditiva según § 34:
--   · tres enums y tres tablas nuevas (`mail_account`, `mail_message`,
--     `mail_account_address`);
--   · una columna nueva en `conversation` (`private_to`), con su guarda, y una
--     en `workspace` (`new_conversations_private`): el admin decide si las
--     conversaciones nuevas nacen privadas (por defecto) o compartidas. No se
--     toca ninguna fila: las que ya existen siguen compartidas;
--   · el registro de auditoría de `conversation_event` deja de copiar el texto
--     de los correos (ADR-099, añadido del 2026-10-11);
--   · las policies de lectura y edición de `conversation` ganan la condición
--     de privada (ADR-099 punto 4), y las dos RPC que leen una conversación por
--     id con privilegios (`record_conversation_event`, `delete_conversation`)
--     la respetan también;
--   · RPCs de conexión (usuario) y de sincronización (solo service_role).
-- Rollback: build/runbooks/rollback-20261011-mail-google.sql.
--
-- Fronteras:
--   · El refresh token llega ya cifrado (AES-GCM, clave `MAIL_TOKEN_KEY` en el
--     Worker). La base nunca ve el token en claro, y `authenticated` no tiene
--     grant sobre la columna cifrada: ni siquiera el dueño la lee.
--   · Un correo es un `conversation_event` (source = email). La sincronización
--     solo lo escribe en conversaciones cuyo contacto tiene esa dirección
--     (ADR-099 punto 3). `mail_message` recuerda qué mensajes de cada buzón ya
--     se procesaron, para no volver a bajarlos; no guarda contenido.
--   · Una conversación privada solo la ve quien la marcó, y desaparece para los
--     demás también de los recuentos (todas las lecturas pasan por la policy).

-- ── Vocabulario ───────────────────────────────────────────────────────────
-- Microsoft (y un IMAP genérico) entran como otro valor del enum: ADD VALUE es
-- aditivo.
CREATE TYPE public.mail_provider AS ENUM ('google');
CREATE TYPE public.mail_account_scope AS ENUM ('personal', 'workspace');
CREATE TYPE public.mail_account_status AS ENUM ('active', 'revoked', 'error');

-- ── mail_account: un buzón conectado ──────────────────────────────────────
CREATE TABLE public.mail_account (
  id                        uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id              uuid NOT NULL REFERENCES public.workspace(id) ON DELETE CASCADE,
  scope                     public.mail_account_scope NOT NULL,
  -- El dueño de un buzón personal; NULL en el común del espacio.
  owner_user_id             uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  provider                  public.mail_provider NOT NULL,
  address                   extensions.citext NOT NULL,
  -- `v<n>.<iv>.<ciphertext>` en base64url; lo descifra solo el Worker.
  refresh_token_ciphertext  text NOT NULL,
  token_key_version         smallint NOT NULL DEFAULT 1,
  status                    public.mail_account_status NOT NULL DEFAULT 'active',
  -- Cursor incremental del proveedor (Gmail: historyId).
  sync_cursor               text,
  -- Desde cuándo se lee: la primera sincronización trae los últimos 12 meses.
  sync_from                 timestamptz NOT NULL DEFAULT (now() - interval '12 months'),
  -- Firma propia de Hour (no la de Gmail): la del personal es de su dueño; la
  -- del común, del espacio.
  signature                 text,
  sync_started_at           timestamptz,
  last_synced_at            timestamptz,
  last_error                text,
  messages_ingested         integer NOT NULL DEFAULT 0,
  connected_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mail_account_owner_matches_scope
    CHECK ((scope = 'personal') = (owner_user_id IS NOT NULL)),
  CONSTRAINT mail_account_address_format
    CHECK (address ~ '^[^@\s]+@[^@\s]+$' AND length(address) <= 254),
  CONSTRAINT mail_account_ciphertext_format
    CHECK (refresh_token_ciphertext ~ '^v[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  CONSTRAINT mail_account_last_error_length
    CHECK (last_error IS NULL OR length(last_error) <= 500),
  CONSTRAINT mail_account_signature_length
    CHECK (signature IS NULL OR length(signature) <= 2000)
);

COMMENT ON TABLE public.mail_account IS
  'ADR-099: a connected mailbox (personal, or the workspace''s shared one). The refresh token is stored encrypted by the Worker (AES-GCM, MAIL_TOKEN_KEY); authenticated has no grant on it. Written only through RPCs.';

CREATE UNIQUE INDEX mail_account_address_key
  ON public.mail_account (workspace_id, address);
-- Un buzón personal por persona y espacio.
CREATE UNIQUE INDEX mail_account_personal_key
  ON public.mail_account (workspace_id, owner_user_id) WHERE scope = 'personal';
CREATE INDEX mail_account_due_idx
  ON public.mail_account (last_synced_at NULLS FIRST) WHERE status = 'active';
CREATE INDEX mail_account_owner_idx
  ON public.mail_account (owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX mail_account_connected_by_idx
  ON public.mail_account (connected_by) WHERE connected_by IS NOT NULL;

ALTER TABLE public.mail_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_account FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mail_account OWNER TO postgres;

REVOKE ALL ON TABLE public.mail_account FROM PUBLIC, anon, authenticated;
-- Grant por columnas A PROPÓSITO: la cifrada, el cursor y el arriendo de
-- sincronización no existen para PostgREST.
GRANT SELECT (
  id, workspace_id, scope, owner_user_id, provider, address, status,
  sync_from, last_synced_at, last_error, messages_ingested, connected_by,
  signature, created_at, updated_at
) ON TABLE public.mail_account TO authenticated;
GRANT ALL ON TABLE public.mail_account TO service_role;

-- El personal lo ve solo su dueño; el común, cualquier miembro del espacio.
CREATE POLICY mail_account_select ON public.mail_account
  FOR SELECT TO authenticated
  USING (
    CASE scope
      WHEN 'personal' THEN owner_user_id = (SELECT auth.uid())
      ELSE public.is_workspace_member(workspace_id)
    END
  );

-- ── mail_message: lo ya procesado de cada buzón ───────────────────────────
-- Solo identificadores: qué mensaje del buzón ya se miró y en qué hilo está.
-- Ningún contenido. Solo service_role (sin grants ni policies para clientes).
CREATE TABLE public.mail_message (
  mail_account_id      uuid NOT NULL REFERENCES public.mail_account(id) ON DELETE CASCADE,
  provider_message_id  text NOT NULL,
  provider_thread_id   text,
  rfc_message_id       text,
  events_created       integer NOT NULL DEFAULT 0,
  processed_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mail_account_id, provider_message_id),
  CONSTRAINT mail_message_ids_length
    CHECK (length(provider_message_id) <= 200
       AND (provider_thread_id IS NULL OR length(provider_thread_id) <= 200)
       AND (rfc_message_id IS NULL OR length(rfc_message_id) <= 998))
);

COMMENT ON TABLE public.mail_message IS
  'ADR-099: which messages of a mailbox the sync already processed (ids only, no content). service_role only.';

ALTER TABLE public.mail_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_message FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mail_message OWNER TO postgres;
REVOKE ALL ON TABLE public.mail_message FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mail_message TO service_role;

-- ── mail_account_address: qué contactos ya trajeron su historia ───────────
-- Cuando un contacto entra en Hour después de conectar el buzón, la siguiente
-- pasada trae su correo de los últimos 12 meses (ADR-099, añadido). Esta tabla
-- recuerda a quién ya se le hizo. Solo service_role.
CREATE TABLE public.mail_account_address (
  mail_account_id  uuid NOT NULL REFERENCES public.mail_account(id) ON DELETE CASCADE,
  address          extensions.citext NOT NULL,
  backfilled_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mail_account_id, address)
);
ALTER TABLE public.mail_account_address ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_account_address FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mail_account_address OWNER TO postgres;
REVOKE ALL ON TABLE public.mail_account_address FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mail_account_address TO service_role;

-- Los eventos de correo de un buzón, para el recuento y el hilo de Gmail.
CREATE INDEX conversation_event_mail_account_idx
  ON public.conversation_event ((metadata ->> 'mail_account_id'))
  WHERE source = 'email';

-- ── Conversación privada (ADR-099 punto 4) ────────────────────────────────
-- Quien la marcó. NULL = la ve quien ve conversaciones. Sin clave foránea a
-- propósito: si quien la marcó sale del espacio o borra su cuenta, sigue
-- oculta para siempre (ADR-099, añadido: puede ser la conversación con una
-- amiga que nadie más debe ver).
ALTER TABLE public.conversation
  ADD COLUMN private_to uuid;

-- El admin decide cómo nacen las conversaciones nuevas del espacio. Por
-- defecto, privadas de quien las crea. Las que ya existen no cambian.
ALTER TABLE public.workspace
  ADD COLUMN new_conversations_private boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.workspace.new_conversations_private IS
  'ADR-099: new conversations are born private to their creator (true, default) or shared (false). Admins set it (workspace_update policy); each person changes their own conversations afterwards.';

COMMENT ON COLUMN public.conversation.private_to IS
  'ADR-099: the user who marked the conversation private. Only that user sees it (and its events); for everyone else it does not exist, counts included. No FK on purpose: it stays hidden forever.';

CREATE INDEX conversation_private_to_idx
  ON public.conversation (private_to) WHERE private_to IS NOT NULL;

-- `conversation` tiene UPDATE a tabla entera para `authenticated`, así que la
-- columna nueva es escribible por PATCH. La guarda pone la regla en la base:
-- solo te marcas a ti, y solo quien la marcó la desmarca. Al crear, si el
-- espacio dice que nacen privadas, la conversación nace privada de quien la
-- crea. service_role (sin auth.uid()) pasa.
CREATE FUNCTION public.guard_conversation_private()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.private_to IS NOT NULL AND NEW.private_to <> v_caller THEN
      RAISE EXCEPTION 'a conversation can only be made private to yourself' USING ERRCODE = '42501';
    END IF;
    IF NEW.private_to IS NULL AND coalesce((
      SELECT w.new_conversations_private FROM public.workspace w WHERE w.id = NEW.workspace_id
    ), true) THEN
      NEW.private_to := v_caller;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.private_to IS DISTINCT FROM OLD.private_to THEN
    IF OLD.private_to IS NOT NULL AND OLD.private_to <> v_caller THEN
      RAISE EXCEPTION 'only who made it private can change it' USING ERRCODE = '42501';
    END IF;
    IF NEW.private_to IS NOT NULL AND NEW.private_to <> v_caller THEN
      RAISE EXCEPTION 'a conversation can only be made private to yourself' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.guard_conversation_private() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_conversation_private() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER conversation_private_guard
BEFORE INSERT OR UPDATE OF private_to ON public.conversation
FOR EACH ROW EXECUTE FUNCTION public.guard_conversation_private();

-- Lectura y edición: la condición de privada se suma a la de siempre.
DROP POLICY conversation_select ON public.conversation;
CREATE POLICY conversation_select ON public.conversation
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND has_permission(project_id, 'read:conversation'::text)
    AND (private_to IS NULL OR private_to = (SELECT auth.uid()))
  );

DROP POLICY conversation_update ON public.conversation;
CREATE POLICY conversation_update ON public.conversation
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND has_permission(project_id, 'edit:conversation'::text)
    AND (private_to IS NULL OR private_to = (SELECT auth.uid()))
  )
  WITH CHECK (has_permission(project_id, 'edit:conversation'::text));

-- record_conversation_event: igual que en 20261009100000, más la condición de
-- privada (una conversación privada de otro es «no existe»).
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
$$;

-- delete_conversation: igual que antes, más la condición de privada.
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
  WHERE id = p_conversation_id AND deleted_at IS NULL
    AND (private_to IS NULL OR private_to = v_caller);

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

-- ── Elegibilidad: a qué conversaciones puede traer correo un buzón ────────
-- Común: cualquier conversación viva del espacio. Personal: solo las que su
-- dueño puede leer, y nunca una privada de otro (el correo personal de alguien
-- no aparece donde él mismo no llega).
CREATE FUNCTION public.mail_account_eligible_conversation(
  p_account public.mail_account,
  p_conversation public.conversation
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_conversation.deleted_at IS NULL
     AND p_conversation.workspace_id = p_account.workspace_id
     AND CASE p_account.scope
           WHEN 'workspace' THEN true
           ELSE (p_conversation.private_to IS NULL OR p_conversation.private_to = p_account.owner_user_id)
                AND public.has_permission_for_user(
                      p_conversation.project_id, 'read:conversation', p_account.owner_user_id)
         END;
$$;
ALTER FUNCTION public.mail_account_eligible_conversation(public.mail_account, public.conversation) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mail_account_eligible_conversation(public.mail_account, public.conversation)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mail_account_eligible_conversation(public.mail_account, public.conversation)
  TO service_role;

-- ── RPCs de usuario ───────────────────────────────────────────────────────

-- Conecta (o reconecta) un buzón. El personal, cualquier miembro aceptado;
-- el común, owner o admin del espacio. Reconectar la misma dirección renueva
-- el token y conserva el cursor; cambiar de dirección lo reinicia.
CREATE FUNCTION public.connect_mail_account(
  p_workspace_id              uuid,
  p_scope                     public.mail_account_scope,
  p_provider                  public.mail_provider,
  p_address                   text,
  p_refresh_token_ciphertext  text,
  p_token_key_version         smallint DEFAULT 1
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_address extensions.citext := lower(btrim(coalesce(p_address, '')));
  v_id      uuid;
  v_prev    public.mail_account;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_scope = 'workspace' THEN
    IF NOT public.is_workspace_admin(p_workspace_id) THEN
      RAISE EXCEPTION 'only an admin connects the shared mailbox' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'not a member of the workspace' USING ERRCODE = '42501';
  END IF;

  IF p_scope = 'personal' THEN
    SELECT * INTO v_prev FROM public.mail_account
    WHERE workspace_id = p_workspace_id AND scope = 'personal' AND owner_user_id = v_caller
    FOR UPDATE;
  ELSE
    SELECT * INTO v_prev FROM public.mail_account
    WHERE workspace_id = p_workspace_id AND scope = 'workspace' AND address = v_address
    FOR UPDATE;
  END IF;

  IF v_prev.id IS NOT NULL THEN
    UPDATE public.mail_account
    SET address = v_address,
        provider = p_provider,
        refresh_token_ciphertext = p_refresh_token_ciphertext,
        token_key_version = coalesce(p_token_key_version, 1),
        status = 'active',
        last_error = NULL,
        sync_started_at = NULL,
        sync_cursor = CASE WHEN v_prev.address = v_address THEN v_prev.sync_cursor END,
        connected_by = v_caller,
        updated_at = now()
    WHERE id = v_prev.id
    RETURNING id INTO v_id;
    IF v_prev.address <> v_address THEN
      DELETE FROM public.mail_message WHERE mail_account_id = v_id;
      DELETE FROM public.mail_account_address WHERE mail_account_id = v_id;
    END IF;
    RETURN v_id;
  END IF;

  INSERT INTO public.mail_account (
    workspace_id, scope, owner_user_id, provider, address,
    refresh_token_ciphertext, token_key_version, connected_by
  ) VALUES (
    p_workspace_id, p_scope,
    CASE WHEN p_scope = 'personal' THEN v_caller END,
    p_provider, v_address, p_refresh_token_ciphertext,
    coalesce(p_token_key_version, 1), v_caller
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Quién gestiona un buzón: el dueño del personal; owner o admin, el común.
-- Devuelve false también si no existe (sin oráculo).
CREATE FUNCTION public.can_manage_mail_account(p_account_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce((
    SELECT CASE a.scope
             WHEN 'personal' THEN a.owner_user_id = auth.uid()
             ELSE public.is_workspace_admin(a.workspace_id)
           END
    FROM public.mail_account a WHERE a.id = p_account_id
  ), false);
$$;

-- La firma de Hour de un buzón: la edita quien lo gestiona.
CREATE FUNCTION public.set_mail_signature(p_account_id uuid, p_signature text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_mail_account(p_account_id) THEN
    RAISE EXCEPTION 'mail account % not found', p_account_id USING ERRCODE = '42501';
  END IF;
  UPDATE public.mail_account
  SET signature = nullif(btrim(coalesce(p_signature, '')), ''), updated_at = now()
  WHERE id = p_account_id;
END;
$$;

-- Desconectar borra la conexión y lo procesado; los correos ya registrados
-- se quedan en el historial (son registro de la conversación).
CREATE FUNCTION public.disconnect_mail_account(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_mail_account(p_account_id) THEN
    RAISE EXCEPTION 'mail account % not found', p_account_id USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.mail_account WHERE id = p_account_id;
END;
$$;

-- Antes de enviar: ¿puede quien llama escribir a este contacto desde este
-- buzón? Edita la conversación (y la ve: privada incluida), el buzón es suyo
-- o es el común de ese espacio, y está activo. El destinatario no lo elige el
-- cliente: es la dirección del contacto de la conversación.
CREATE FUNCTION public.mail_send_authorize(p_conversation_id uuid, p_account_id uuid)
RETURNS TABLE (recipient_address text, recipient_name text, account_address text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_conv   public.conversation;
  v_acc    public.mail_account;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_conv FROM public.conversation
  WHERE id = p_conversation_id AND deleted_at IS NULL
    AND (private_to IS NULL OR private_to = v_caller);
  IF v_conv.id IS NULL OR NOT public.has_permission(v_conv.project_id, 'edit:conversation') THEN
    RAISE EXCEPTION 'conversation % not found', p_conversation_id USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_acc FROM public.mail_account
  WHERE id = p_account_id AND workspace_id = v_conv.workspace_id AND status = 'active'
    AND (scope = 'workspace' OR owner_user_id = v_caller);
  IF v_acc.id IS NULL THEN
    RAISE EXCEPTION 'mail account % not usable', p_account_id USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT wp.email::text, wp.full_name, v_acc.address::text
  FROM public.workspace_person wp
  WHERE wp.workspace_id = v_conv.workspace_id AND wp.person_id = v_conv.person_id
    AND wp.deleted_at IS NULL AND wp.email IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the contact has no email address' USING ERRCODE = '22023';
  END IF;
END;
$$;

-- ── RPCs de sincronización (solo service_role) ────────────────────────────

-- Toma hasta p_limit buzones activos que tocan (más viejos primero) y les pone
-- un arriendo de 15 minutos, para que dos pasadas no lean el mismo a la vez.
CREATE FUNCTION public.mail_sync_claim(
  p_limit integer DEFAULT 10,
  p_min_interval interval DEFAULT interval '5 minutes',
  p_account_id uuid DEFAULT NULL
) RETURNS SETOF public.mail_account
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  UPDATE public.mail_account a
  SET sync_started_at = now()
  WHERE a.id IN (
    SELECT id FROM public.mail_account
    WHERE status = 'active'
      AND (p_account_id IS NULL OR id = p_account_id)
      AND (sync_started_at IS NULL OR sync_started_at < now() - interval '15 minutes')
      AND (p_account_id IS NOT NULL OR last_synced_at IS NULL
           OR last_synced_at < now() - p_min_interval)
    ORDER BY last_synced_at NULLS FIRST
    LIMIT greatest(1, least(coalesce(p_limit, 10), 50))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING a.*;
$$;

-- El buzón con su token cifrado, para enviar o revocar.
CREATE FUNCTION public.mail_account_secret(p_account_id uuid)
RETURNS SETOF public.mail_account
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT * FROM public.mail_account WHERE id = p_account_id;
$$;

-- Las direcciones de contacto que este buzón busca: las de los contactos con
-- una conversación elegible. Es lo único que la sincronización pregunta al
-- proveedor; lo demás del buzón no se lista.
CREATE FUNCTION public.mail_contact_addresses(p_account_id uuid)
RETURNS TABLE (address text, backfilled boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT DISTINCT lower(wp.email::text),
         EXISTS (SELECT 1 FROM public.mail_account_address m
                 WHERE m.mail_account_id = a.id AND m.address = lower(wp.email::text))
  FROM public.mail_account a
  JOIN public.conversation c ON c.workspace_id = a.workspace_id AND c.deleted_at IS NULL
  JOIN public.workspace_person wp
    ON wp.workspace_id = c.workspace_id AND wp.person_id = c.person_id
   AND wp.deleted_at IS NULL AND wp.email IS NOT NULL
  WHERE a.id = p_account_id
    AND lower(wp.email::text) <> lower(a.address::text)
    AND public.mail_account_eligible_conversation(a, c);
$$;

-- Estas direcciones ya trajeron sus últimos 12 meses.
CREATE FUNCTION public.mail_mark_backfilled(p_account_id uuid, p_addresses text[])
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  INSERT INTO public.mail_account_address (mail_account_id, address)
  SELECT p_account_id, lower(btrim(a)) FROM unnest(p_addresses) a WHERE btrim(a) <> ''
  ON CONFLICT DO NOTHING;
$$;

-- De estos ids del proveedor, cuáles ya se procesaron.
CREATE FUNCTION public.mail_known_messages(p_account_id uuid, p_ids text[])
RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT provider_message_id FROM public.mail_message
  WHERE mail_account_id = p_account_id AND provider_message_id = ANY (p_ids);
$$;

-- Registra un correo en las conversaciones de sus contactos. Idempotente dos
-- veces: por buzón (`mail_message`) y por conversación (`external_ref` con el
-- Message-ID RFC, que es el mismo en el buzón personal y en el común).
-- p_message: { provider_message_id, provider_thread_id?, rfc_message_id?,
--   occurred_at, direction, subject?, from, to[], cc[], counterparts[], body? }
-- Devuelve cuántos eventos nuevos creó.
CREATE FUNCTION public.mail_ingest_message(
  p_account_id uuid,
  p_message    jsonb,
  p_created_by uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_acc        public.mail_account;
  v_msg_id     text := nullif(btrim(coalesce(p_message ->> 'provider_message_id', '')), '');
  v_rfc        text := nullif(btrim(coalesce(p_message ->> 'rfc_message_id', '')), '');
  v_direction  public.conversation_event_direction;
  v_occurred   timestamptz;
  v_counter    text[];
  v_ref_base   text;
  v_created    integer := 0;
  v_conv       public.conversation;
  v_event_id   uuid;
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
  SELECT coalesce(array_agg(DISTINCT lower(btrim(x))), '{}')
  INTO v_counter
  FROM jsonb_array_elements_text(coalesce(p_message -> 'counterparts', '[]'::jsonb)) AS x
  WHERE btrim(x) <> '';

  -- Ya procesado en este buzón: nada que hacer.
  INSERT INTO public.mail_message (mail_account_id, provider_message_id, provider_thread_id, rfc_message_id)
  VALUES (v_acc.id, v_msg_id, nullif(p_message ->> 'provider_thread_id', ''), v_rfc)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_ref_base := 'mail:' || coalesce(v_rfc, v_acc.provider::text || ':' || v_acc.id::text || ':' || v_msg_id);

  FOR v_conv IN
    SELECT c.* FROM public.conversation c
    JOIN public.workspace_person wp
      ON wp.workspace_id = c.workspace_id AND wp.person_id = c.person_id
     AND wp.deleted_at IS NULL
    WHERE c.workspace_id = v_acc.workspace_id
      AND lower(wp.email::text) = ANY (v_counter)
      AND public.mail_account_eligible_conversation(v_acc, c)
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
        'provider_thread_id', nullif(p_message ->> 'provider_thread_id', ''),
        'rfc_message_id', v_rfc,
        'subject', left(p_message ->> 'subject', 998),
        'from', left(p_message ->> 'from', 998),
        'to', p_message -> 'to',
        'cc', p_message -> 'cc'
      )),
      p_created_by
    )
    ON CONFLICT (workspace_id, source, external_ref) WHERE external_ref IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_event_id;

    IF v_event_id IS NOT NULL THEN
      v_created := v_created + 1;
      UPDATE public.conversation
      SET last_contacted_at = greatest(coalesce(last_contacted_at, v_occurred), v_occurred),
          first_contacted_at = coalesce(first_contacted_at, v_occurred)
      WHERE id = v_conv.id;
    END IF;
  END LOOP;

  UPDATE public.mail_message SET events_created = v_created
  WHERE mail_account_id = v_acc.id AND provider_message_id = v_msg_id;
  RETURN v_created;
END;
$$;

-- Cierra una pasada: cursor (solo si la pasada terminó), estado y error.
CREATE FUNCTION public.mail_sync_finish(
  p_account_id uuid,
  p_status     public.mail_account_status,
  p_cursor     text DEFAULT NULL,
  p_complete   boolean DEFAULT false,
  p_ingested   integer DEFAULT 0,
  p_error      text DEFAULT NULL
) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  UPDATE public.mail_account
  SET status = p_status,
      sync_cursor = CASE WHEN p_complete AND p_cursor IS NOT NULL THEN p_cursor ELSE sync_cursor END,
      last_synced_at = CASE WHEN p_complete THEN now() ELSE last_synced_at END,
      messages_ingested = messages_ingested + greatest(coalesce(p_ingested, 0), 0),
      last_error = left(p_error, 500),
      sync_started_at = NULL,
      updated_at = now()
  WHERE id = p_account_id;
$$;

-- ── Auditoría de conversation_event sin el texto de los correos ───────────
-- Igual que write_audit, pero de un evento de correo (source = email) no copia
-- ni el cuerpo ni el asunto: queda que hubo un correo, no lo que decía.
CREATE FUNCTION public.write_audit_conversation_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row     public.conversation_event := COALESCE(NEW, OLD);
  v_ws      uuid := v_row.workspace_id;
  v_new     jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_old     jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_changes jsonb;
BEGIN
  IF v_row.source = 'email' THEN
    v_new := CASE WHEN v_new IS NOT NULL THEN (v_new - 'body') #- '{metadata,subject}' END;
    v_old := CASE WHEN v_old IS NOT NULL THEN (v_old - 'body') #- '{metadata,subject}' END;
  END IF;
  IF v_ws IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.workspace WHERE id = v_ws) THEN
    v_ws := NULL;
  END IF;
  v_changes := CASE TG_OP
    WHEN 'INSERT' THEN v_new
    WHEN 'UPDATE' THEN jsonb_build_object('before', v_old, 'after', v_new)
    ELSE v_old
  END;
  INSERT INTO audit_log (workspace_id, actor_id, entity_type, entity_id, action, changes)
  VALUES (v_ws, auth.uid(), TG_TABLE_NAME, v_row.id, lower(TG_OP), v_changes);
  RETURN COALESCE(NEW, OLD);
END;
$$;
ALTER FUNCTION public.write_audit_conversation_event() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.write_audit_conversation_event() FROM PUBLIC, anon, authenticated;

DROP TRIGGER conversation_event_audit ON public.conversation_event;
CREATE TRIGGER conversation_event_audit
AFTER INSERT OR DELETE OR UPDATE ON public.conversation_event
FOR EACH ROW EXECUTE FUNCTION public.write_audit_conversation_event();

-- ── Propiedad y grants ────────────────────────────────────────────────────
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.connect_mail_account(uuid, public.mail_account_scope, public.mail_provider, text, text, smallint)',
    'public.can_manage_mail_account(uuid)',
    'public.set_mail_signature(uuid, text)',
    'public.mail_mark_backfilled(uuid, text[])',
    'public.disconnect_mail_account(uuid)',
    'public.mail_send_authorize(uuid, uuid)',
    'public.mail_sync_claim(integer, interval, uuid)',
    'public.mail_account_secret(uuid)',
    'public.mail_contact_addresses(uuid)',
    'public.mail_known_messages(uuid, text[])',
    'public.mail_ingest_message(uuid, jsonb, uuid)',
    'public.mail_sync_finish(uuid, public.mail_account_status, text, boolean, integer, text)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.connect_mail_account(uuid, public.mail_account_scope, public.mail_provider, text, text, smallint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_mail_account(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.disconnect_mail_account(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_mail_signature(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mail_send_authorize(uuid, uuid) TO authenticated;
