-- Rollback de 20261016100000_mailout_send (ADR-115, envío en bloque fase 3).
-- Solo funciones: no hay datos que recuperar. El Worker de la fase 3 deja de
-- poder montar correos (la cola falla cada pasada con 404 de PostgREST) y la
-- página de baja enseña el texto genérico; desplegar antes el Worker anterior.

BEGIN;
DROP FUNCTION IF EXISTS public.mailout_unsubscribe_info(text);
DROP FUNCTION IF EXISTS public.mailout_compose_preview(uuid);
DROP FUNCTION IF EXISTS public.mailout_send_context(uuid[]);
DROP FUNCTION IF EXISTS private.mailout_compose_rows(uuid[]);
COMMIT;
