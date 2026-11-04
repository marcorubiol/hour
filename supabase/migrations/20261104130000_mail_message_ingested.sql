-- 111: abrir un correo entero, tal como llegó, trayéndolo del buzón al abrirlo.
--
-- Quién puede abrirlo lo decide la RLS de `conversation_event` con el JWT de
-- quien mira (si ve el correo en la conversación, puede ver su original). Pero
-- los metadatos de un evento no bastan para elegir qué mensaje del buzón se
-- baja: `record_conversation_event` deja a quien edita la conversación
-- escribir un evento con `source = 'email'` y metadatos a su gusto, y con un
-- `mail_account_id` y un `provider_message_id` inventados podría pedir al
-- Worker cualquier correo de un buzón ajeno.
--
-- La prueba la da `mail_message`, que sólo escribe la sincronización (o el
-- envío desde Hour) con la clave de servicio: ese mensaje de ese buzón entró
-- en el registro (`events_created > 0`) y con ese Message-ID. Sólo ids, como
-- el resto de `mail_message`; no guarda ni devuelve contenido.

CREATE FUNCTION public.mail_message_ingested(
  p_account_id          uuid,
  p_provider_message_id text,
  p_rfc_message_id      text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mail_message
    WHERE mail_account_id = p_account_id
      AND provider_message_id = p_provider_message_id
      AND events_created > 0
      AND rfc_message_id IS NOT DISTINCT FROM nullif(btrim(coalesce(p_rfc_message_id, '')), '')
  );
$$;

ALTER FUNCTION public.mail_message_ingested(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mail_message_ingested(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mail_message_ingested(uuid, text, text) TO service_role;
