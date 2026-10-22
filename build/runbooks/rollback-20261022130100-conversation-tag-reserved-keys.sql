-- Rollback de 20261022130100_conversation_tag_reserved_keys.
-- Quita la restricción; no toca filas. La ruta de ajustes sigue rechazando
-- `all` y `team` (400 reserved).

BEGIN;

ALTER TABLE public.conversation_tag DROP CONSTRAINT IF EXISTS conversation_tag_key_not_reserved;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261022130100';

COMMIT;
