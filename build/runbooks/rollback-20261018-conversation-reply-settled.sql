-- Rollback de 20261018140000_conversation_reply_settled (ADR-126 § 1).
-- Quita la columna y su grant. Se pierde qué respuestas se marcaron «no pide
-- respuesta»: vuelven a «Te toca». Desplegar antes el Worker que no la lee.

BEGIN;
REVOKE UPDATE (reply_settled_at) ON TABLE public.conversation FROM authenticated;
ALTER TABLE public.conversation DROP COLUMN reply_settled_at;
COMMIT;
