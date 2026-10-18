-- Rollback de 20261018100000_directory_privacy (ADR-124: el directorio pide
-- Converses y hereda la privacidad).
-- Desplegar antes el Worker anterior: el de ADR-124 llama a
-- conversation_access desde GET /api/conversations/access. No hay datos que
-- recuperar: dos políticas vuelven a la matriz del 2026-07-20 y se borran las
-- funciones nuevas.

BEGIN;

ALTER POLICY workspace_person_select ON public.workspace_person
  USING (deleted_at IS NULL AND public.is_workspace_internal_member(workspace_id));

ALTER POLICY workspace_organization_select ON public.workspace_organization
  USING (deleted_at IS NULL AND public.is_workspace_internal_member(workspace_id));

DROP FUNCTION IF EXISTS public.conversation_access();
DROP FUNCTION IF EXISTS private.workspace_organization_readable_by_caller(uuid, uuid);
DROP FUNCTION IF EXISTS private.workspace_person_readable_by_caller(uuid, uuid);
DROP FUNCTION IF EXISTS private.person_only_in_foreign_private(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS private.person_is_team(uuid, uuid);
DROP FUNCTION IF EXISTS private.reads_conversations_in(uuid, uuid);

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261018100000';
COMMIT;
