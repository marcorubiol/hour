-- Rollback de 20261022130000_person_merge (fusión de dossiers, fase 1).
-- Borra las tres RPC, las dos funciones internas, las dos tablas y la columna
-- `workspace_person.previous_slugs`, y devuelve `guard_immutable_note_anchor`
-- a la versión viva de antes (copiada con `pg_get_functiondef` de producción
-- el 2026-10-22; misma firma, sin la excepción de la fusión).
-- Lo que NO deshace: las fusiones ya hechas. Sus filas se quedan en keep y el
-- dossier drop borrado. Deshacerlas antes con `undo_person_merge` (mientras
-- quepa el plazo de 30 días); después, el backup previo al apply.
-- Antes de aplicarlo, desplegar un Worker que no llame a las tres RPC ni lea
-- `person_merge` ni `previous_slugs`.

BEGIN;

DROP FUNCTION IF EXISTS public.undo_person_merge(uuid);
DROP FUNCTION IF EXISTS public.merge_workspace_person(uuid, uuid, uuid, jsonb, uuid);
DROP FUNCTION IF EXISTS public.preview_person_merge(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS private.person_merge_restore_dossier(jsonb);
DROP FUNCTION IF EXISTS private.person_merge_pair(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.guard_immutable_note_anchor()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.project_id     IS DISTINCT FROM OLD.project_id
  OR NEW.line_id        IS DISTINCT FROM OLD.line_id
  OR NEW.performance_id IS DISTINCT FROM OLD.performance_id
  OR NEW.date_id        IS DISTINCT FROM OLD.date_id
  OR NEW.person_id      IS DISTINCT FROM OLD.person_id THEN
    RAISE EXCEPTION 'note anchor is immutable — delete and rewrite'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TABLE IF EXISTS public.person_merge_row;
DROP TABLE IF EXISTS public.person_merge;

ALTER TABLE public.workspace_person DROP COLUMN IF EXISTS previous_slugs;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261022130000';

COMMIT;
