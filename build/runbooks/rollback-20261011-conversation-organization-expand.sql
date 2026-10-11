-- ROLLBACK for 20261011600000_conversation_organization_expand.sql (ADR-102,
-- fase 1: la conversación es con la sala)
--
-- Deshace: los dos triggers de doble escritura, las tres funciones de
-- contactos, la tabla `conversation_contact` y la columna
-- `conversation.organization_id` con su FK e índice.
--
-- DATOS QUE SE PIERDEN: los contactos que no sean el principal (añadidos por
-- `set_conversation_contact`; sin UI en la fase 1, así que ninguno salvo a
-- mano), los papeles y fechas puestos por RPC, y la organización de cada
-- conversación (se vuelve a derivar del dossier). `conversation.person_id` y
-- `role` no se tocan: siguen siendo la verdad del modelo viejo.
-- Worker: el código de la fase 1 no lee nada de esto, así que no hace falta
-- volver atrás ningún deploy. Si ya está desplegada la fase 2, primero ese
-- rollback.

BEGIN;

DROP TRIGGER IF EXISTS conversation_sync_primary_contact ON public.conversation;
DROP TRIGGER IF EXISTS conversation_fill_organization ON public.conversation;
DROP FUNCTION IF EXISTS public.conversation_sync_primary_contact();
DROP FUNCTION IF EXISTS public.conversation_fill_organization();

DROP FUNCTION IF EXISTS public.set_conversation_contact(uuid, uuid, text, date, boolean);
DROP FUNCTION IF EXISTS public.end_conversation_contact(uuid, uuid, date);
DROP FUNCTION IF EXISTS public.conversation_for_contact_write(uuid);

DROP TABLE IF EXISTS public.conversation_contact;

DROP INDEX IF EXISTS public.conversation_workspace_organization_idx;
ALTER TABLE public.conversation DROP CONSTRAINT IF EXISTS conversation_workspace_organization_fkey;
ALTER TABLE public.conversation DROP COLUMN IF EXISTS organization_id;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261011600000';

COMMIT;
