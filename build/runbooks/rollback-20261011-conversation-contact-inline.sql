-- ROLLBACK for 20261011820000_conversation_contact_inline.sql (ADR-102,
-- fase 2: «Añadir como contacto» desde el alta)
--
-- Borra la RPC. Los contactos y dossiers que creó se quedan (son filas
-- normales). ANTES: el Worker que la llama (POST /api/conversations/:id/contacts
-- con `person` en línea) debe volver al deploy anterior, o esa llamada da 404.

BEGIN;

DROP FUNCTION IF EXISTS public.add_conversation_contact(uuid, text, text, text, text);

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261011820000';

COMMIT;
