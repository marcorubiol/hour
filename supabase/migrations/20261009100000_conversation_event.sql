-- ADR-098 · `conversation_event`: el historial de una conversación (§ 40).
--
-- Materializa el contrato congelado (`build/conversation-event-contract.md`).
-- Aditiva: una tabla, tres enums y una RPC. No toca ninguna columna ni grant
-- de `conversation`, y el trigger `conversation_contact_timestamps` se queda
-- como está.
--
-- Cómo convive con ese trigger (ADR-098):
--   · Un evento de contacto mueve `last_contacted_at` en la misma transacción,
--     al MÁXIMO entre el sello actual y `occurred_at`: apuntar hoy algo de la
--     semana pasada no hace retroceder el último contacto.
--   · `first_contacted_at` se rellena solo si estaba vacío; el trigger ya lo
--     protege una vez puesto, así que la RPC no necesita repetir esa regla.
--   · Un cambio de estado sigue sellando el último contacto sin crear evento:
--     el estado no es una interacción con un canal, y su historia ya vive en
--     `audit_log`.
--
-- Append-only para clientes: `authenticated` solo tiene SELECT, y escribe por
-- `record_conversation_event`. No hay UPDATE ni DELETE: una corrección es otro
-- evento. La redacción por privacidad del contrato es un camino administrativo
-- (service_role) que este bloque no construye.

-- ── Vocabulario ───────────────────────────────────────────────────────────
CREATE TYPE public.conversation_event_kind AS ENUM
  ('note', 'call', 'email', 'meeting', 'message');
CREATE TYPE public.conversation_event_source AS ENUM
  ('manual', 'email', 'whatsapp', 'import', 'integration');
CREATE TYPE public.conversation_event_direction AS ENUM
  ('inbound', 'outbound');

-- ── La tabla ──────────────────────────────────────────────────────────────
CREATE TABLE public.conversation_event (
  id              uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  -- Derivado de la conversación por la RPC; nunca lo manda el cliente.
  workspace_id    uuid NOT NULL REFERENCES public.workspace(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversation(id) ON DELETE CASCADE,
  occurred_at     timestamptz NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  kind            public.conversation_event_kind NOT NULL,
  source          public.conversation_event_source NOT NULL DEFAULT 'manual',
  direction       public.conversation_event_direction,
  body            text,
  participants    jsonb NOT NULL DEFAULT '[]'::jsonb,
  provenance      jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_ref    text,
  original_url    text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT conversation_event_body_length
    CHECK (body IS NULL OR length(body) <= 20000),
  CONSTRAINT conversation_event_participants_array
    CHECK (jsonb_typeof(participants) = 'array'),
  CONSTRAINT conversation_event_provenance_object
    CHECK (jsonb_typeof(provenance) = 'object'),
  CONSTRAINT conversation_event_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT conversation_event_external_ref_nonempty
    CHECK (external_ref IS NULL OR length(btrim(external_ref)) > 0),
  -- Un enlace al original, nunca un token: solo http(s).
  CONSTRAINT conversation_event_original_url_http
    CHECK (original_url IS NULL OR original_url ~* '^https?://')
);

COMMENT ON TABLE public.conversation_event IS
  'ADR-098: the history of a conversation (contract: build/conversation-event-contract.md). Append-only for clients; written only through record_conversation_event. Contact kinds move conversation.last_contacted_at in the same transaction.';
COMMENT ON COLUMN public.conversation_event.occurred_at IS
  'When the interaction happened. recorded_at is when it reached Hour; neither replaces the other.';
COMMENT ON COLUMN public.conversation_event.direction IS
  'inbound | outbound | null (not applicable). A note marks contact only when it carries a direction.';

-- La lectura de la ficha: los eventos de una conversación, del más reciente.
CREATE INDEX conversation_event_conversation_idx
  ON public.conversation_event (conversation_id, occurred_at DESC, recorded_at DESC);
CREATE INDEX conversation_event_workspace_idx
  ON public.conversation_event (workspace_id);
CREATE INDEX conversation_event_created_by_idx
  ON public.conversation_event (created_by) WHERE created_by IS NOT NULL;
-- Procedencia externa idempotente (contrato).
CREATE UNIQUE INDEX conversation_event_external_ref_key
  ON public.conversation_event (workspace_id, source, external_ref)
  WHERE external_ref IS NOT NULL;

ALTER TABLE public.conversation_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_event FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_event OWNER TO postgres;

REVOKE ALL ON TABLE public.conversation_event FROM PUBLIC, anon;
-- Solo lectura, y a TABLA entera: sin grant por columnas no hay columna que
-- se quede fuera de un `select` (la rotura de `performance` del 2026-08-29).
GRANT SELECT ON TABLE public.conversation_event TO authenticated;
GRANT ALL ON TABLE public.conversation_event TO service_role;

-- Hereda la frontera de la conversación literalmente: la subconsulta corre
-- con la RLS de `conversation` del invocador (`read:conversation`, y la
-- conversación viva). Un evento no se ve si su conversación no se ve.
CREATE POLICY conversation_event_select ON public.conversation_event
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation c
      WHERE c.id = conversation_event.conversation_id
    )
  );

CREATE TRIGGER conversation_event_audit
AFTER INSERT OR DELETE OR UPDATE ON public.conversation_event
FOR EACH ROW EXECUTE FUNCTION public.write_audit();

-- ── record_conversation_event: la única puerta de escritura ───────────────
-- «No existe» y «no es tuyo» dan el mismo 42501: no es un oráculo de
-- existencia. Con `external_ref`, una segunda captura del mismo original
-- devuelve el evento ya guardado y no vuelve a tocar el último contacto.
CREATE FUNCTION public.record_conversation_event(
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

ALTER FUNCTION public.record_conversation_event(
  uuid, public.conversation_event_kind, timestamptz,
  public.conversation_event_direction, text, public.conversation_event_source,
  jsonb, jsonb, text, text, jsonb) OWNER TO postgres;

COMMENT ON FUNCTION public.record_conversation_event(
  uuid, public.conversation_event_kind, timestamptz,
  public.conversation_event_direction, text, public.conversation_event_source,
  jsonb, jsonb, text, text, jsonb) IS
  'ADR-098: the only write path for conversation_event. Gate: edit:conversation on the conversation''s project. Contact kinds move last_contacted_at (max) and fill first_contacted_at once, in the same transaction. Idempotent on (workspace_id, source, external_ref).';

REVOKE ALL ON FUNCTION public.record_conversation_event(
  uuid, public.conversation_event_kind, timestamptz,
  public.conversation_event_direction, text, public.conversation_event_source,
  jsonb, jsonb, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_conversation_event(
  uuid, public.conversation_event_kind, timestamptz,
  public.conversation_event_direction, text, public.conversation_event_source,
  jsonb, jsonb, text, text, jsonb) TO authenticated;
