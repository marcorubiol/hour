-- ROLLBACK for 20261011400000_mail_signature_person.sql (la firma por persona y compañía)
--
-- Deshace: las RPC `my_mail_signature` y `set_my_mail_signature`, la columna
-- `workspace_membership.mail_signature` y las columnas `workspace.website`,
-- `workspace.phone` y `workspace.mail_signature`, y devuelve el comentario de
-- `mail_account.signature`.
--
-- Antes de borrar, copia de vuelta a los buzones lo que se editó en la firma
-- nueva (solo donde el buzón no tiene firma), para que el Worker anterior siga
-- firmando con algo parecido.
--
-- DATOS QUE SE PIERDEN: las firmas por persona y espacio de quien no tiene
-- buzón personal conectado, la web y el teléfono de cada compañía, y la firma
-- de la compañía si el espacio no tiene buzón común. Las propuestas no se
-- pierden: no se guardan, se montan al vuelo.
--
-- Worker: un Worker con esta rama llama a `my_mail_signature` al enviar y en
-- Ajustes; tras el rollback, enviar da 500. Volver atrás el Worker primero, o
-- a la vez.

BEGIN;

UPDATE public.mail_account a
SET signature = m.mail_signature
FROM public.workspace_membership m
WHERE a.scope = 'personal'
  AND a.signature IS NULL
  AND m.mail_signature IS NOT NULL
  AND m.workspace_id = a.workspace_id
  AND m.user_id = a.owner_user_id;

UPDATE public.mail_account a
SET signature = w.mail_signature
FROM public.workspace w
WHERE a.scope = 'workspace'
  AND a.signature IS NULL
  AND w.mail_signature IS NOT NULL
  AND w.id = a.workspace_id;

DROP FUNCTION IF EXISTS public.set_my_mail_signature(uuid, text);
DROP FUNCTION IF EXISTS public.my_mail_signature(uuid);

ALTER TABLE public.workspace_membership
  DROP CONSTRAINT IF EXISTS workspace_membership_mail_signature_length,
  DROP COLUMN IF EXISTS mail_signature;

ALTER TABLE public.workspace
  DROP CONSTRAINT IF EXISTS workspace_website_length,
  DROP CONSTRAINT IF EXISTS workspace_phone_length,
  DROP CONSTRAINT IF EXISTS workspace_mail_signature_length,
  DROP COLUMN IF EXISTS website,
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS mail_signature;

COMMENT ON COLUMN public.mail_account.signature IS NULL;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261011400000';

COMMIT;
