-- Rollback de 20261017100000_thread_feed (ADR-116, «de qué se habla»).
-- Desplegar antes el Worker anterior: el de la fase 4 llama a thread_feed
-- desde GET /api/threads. No hay datos que recuperar: solo una función de
-- lectura.

BEGIN;
DROP FUNCTION IF EXISTS public.thread_feed(uuid[], uuid[], int);
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261017100000';
COMMIT;
