-- ROLLBACK for 20261011810000_conversation_slug_organization.sql (ADR-102,
-- añadido, punto 7: el slug de la conversación es el de su organización)
--
-- Devuelve a cada conversación viva el último slug de `previous_slugs` y lo
-- quita de la lista. Vale porque antes de la migración `previous_slugs` estaba
-- vacío en todas (producción, SELECT del 2026-10-11) y solo esta migración, y
-- el revivir de `create_conversation` desde 20261011800000, lo llenan.
-- Si el slug viejo lo ocupa ya otra conversación viva, esa fila se salta y se
-- lista en un NOTICE (queda con el slug de la organización; el viejo sigue
-- resolviendo por `previous_slugs`).
-- `updated_at` no se toca. El Worker no necesita volver atrás: con o sin esta
-- migración resuelve los dos slugs.

BEGIN;

ALTER TABLE public.conversation DISABLE TRIGGER conversation_set_updated_at;

DO $$
DECLARE
  r       record;
  v_old   text;
  v_n     integer := 0;
BEGIN
  FOR r IN
    SELECT id, workspace_id, slug, previous_slugs
    FROM public.conversation
    WHERE deleted_at IS NULL AND cardinality(previous_slugs) > 0
    ORDER BY created_at, id
  LOOP
    v_old := r.previous_slugs[cardinality(r.previous_slugs)];
    IF EXISTS (
      SELECT 1 FROM public.conversation
      WHERE workspace_id = r.workspace_id AND slug = v_old AND deleted_at IS NULL AND id <> r.id
    ) THEN
      RAISE NOTICE 'skipped %: % is taken', r.id, v_old;
      CONTINUE;
    END IF;
    UPDATE public.conversation
    SET slug = v_old,
        previous_slugs = r.previous_slugs[1:cardinality(r.previous_slugs) - 1]
    WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'conversation slugs restored: %', v_n;
END
$$;

ALTER TABLE public.conversation ENABLE TRIGGER conversation_set_updated_at;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261011810000';

COMMIT;
