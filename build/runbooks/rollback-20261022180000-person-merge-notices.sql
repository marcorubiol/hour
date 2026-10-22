-- Rollback de 20261022180000_person_merge_notices (fusión de dossiers, fase 3).
-- Borra las dos lecturas nuevas. No hay datos que devolver: no escriben nada.
-- El Worker de la fase 3 aguanta que no existan (sin aviso de invitación sin
-- unir y sin reescribir pins `pe:`), así que no hace falta desplegar antes.

BEGIN;

DROP FUNCTION IF EXISTS public.resolve_merged_persons(uuid[]);
DROP FUNCTION IF EXISTS public.list_unmerged_invitations(uuid);

COMMIT;
