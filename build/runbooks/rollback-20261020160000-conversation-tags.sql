-- Rollback de 20261020160000_conversation_tags (etiquetas de conversación, fase 1).
-- Borra las dos RPC, las cuatro tablas, las tres funciones de guarda y la
-- restricción única (id, workspace_id) de `conversation`. No toca ninguna fila
-- de `conversation` ni ninguna política existente.
-- Lo que se pierde: las asignaciones (incluido el relleno `sales`), las
-- etiquetas propias que haya creado un espacio, sus ajustes y las lecturas.
-- El backup previo al apply las tiene. Antes de aplicarlo, desplegar un Worker
-- que no lea estas tablas ni llame a las dos RPC.

BEGIN;

DROP FUNCTION IF EXISTS public.mark_conversation_read(uuid);
DROP FUNCTION IF EXISTS public.set_conversation_tags(uuid, uuid[]);

DROP TABLE IF EXISTS public.conversation_read;
DROP TABLE IF EXISTS public.conversation_tagging;
DROP TABLE IF EXISTS public.workspace_conversation_tag_setting;
DROP TABLE IF EXISTS public.conversation_tag;

DROP FUNCTION IF EXISTS public.guard_conversation_tagging();
DROP FUNCTION IF EXISTS public.guard_workspace_conversation_tag_setting();
DROP FUNCTION IF EXISTS public.guard_conversation_tag_key();

ALTER TABLE public.conversation DROP CONSTRAINT IF EXISTS conversation_id_workspace_key;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261020160000';

COMMIT;
