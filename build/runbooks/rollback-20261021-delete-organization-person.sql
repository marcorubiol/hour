-- Rollback de 20261021200000_delete_organization_person.
-- Borra las dos RPC. No devuelve lo borrado: para eso, `deleted_at = null` en
-- las filas que interese. Antes de aplicarlo, desplegar un Worker sin
-- `DELETE /api/organizations/:id` ni `DELETE /api/persons/:key`.

BEGIN;

DROP FUNCTION IF EXISTS public.delete_workspace_person(uuid, uuid);
DROP FUNCTION IF EXISTS public.delete_workspace_organization(uuid);

COMMIT;
