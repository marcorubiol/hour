-- Rollback de 20261018120000_mailout_select_readable (ADR-124 § 8).
-- La política vuelve a `read:conversation` en el proyecto. Sin datos.

BEGIN;
ALTER POLICY mailout_select ON public.mailout
  USING (public.has_permission(project_id, 'read:conversation'));
DROP FUNCTION IF EXISTS private.mailout_readable_by_caller(uuid, uuid);
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261018120000';
COMMIT;
