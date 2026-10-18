-- ADR-126 § 1: «no pide respuesta». Una respuesta de ellos que no pide nada
-- («perfecto, quedamos así», un fuera de oficina) deja de ponerla en «Te toca»
-- sin inventar un correo nuestro: `reply_settled_at` guarda hasta cuándo lo de
-- fuera ya está atendido. El turno es nuestro solo si su último correo,
-- mensaje o llamada es posterior (`turnOf` en `$lib/conversation-overview.ts`).
-- Revisión de uso de Conversations del 2026-10-18, hallazgo 1.
--
-- Aditiva: una columna nula y su grant de escritura (el de lectura es de
-- tabla). La escritura la decide la política de UPDATE de siempre
-- (`edit:conversation` en el proyecto). Sin datos. Rollback:
-- `build/runbooks/rollback-20261018-conversation-reply-settled.sql`.

ALTER TABLE public.conversation ADD COLUMN reply_settled_at timestamptz;

COMMENT ON COLUMN public.conversation.reply_settled_at IS
  'ADR-126: what came in up to this instant needs no reply; the turn is ours only after a later inbound email, message or call. NULL = nothing settled.';

GRANT UPDATE (reply_settled_at) ON TABLE public.conversation TO authenticated;
