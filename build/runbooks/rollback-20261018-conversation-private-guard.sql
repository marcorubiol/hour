-- Rollback de 20261018110000_conversation_private_guard (ADR-124 § 2).
-- El guard vuelve a su versión de 20261011200000: cualquiera que edita una
-- conversación compartida puede volverla privada para sí. Sin datos.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_conversation_private()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.private_to IS NOT NULL AND NEW.private_to <> v_caller THEN
      RAISE EXCEPTION 'a conversation can only be made private to yourself' USING ERRCODE = '42501';
    END IF;
    IF NEW.private_to IS NULL AND coalesce((
      SELECT w.new_conversations_private FROM public.workspace w WHERE w.id = NEW.workspace_id
    ), true) THEN
      NEW.private_to := v_caller;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.private_to IS DISTINCT FROM OLD.private_to THEN
    IF OLD.private_to IS NOT NULL AND OLD.private_to <> v_caller THEN
      RAISE EXCEPTION 'only who made it private can change it' USING ERRCODE = '42501';
    END IF;
    IF NEW.private_to IS NOT NULL AND NEW.private_to <> v_caller THEN
      RAISE EXCEPTION 'a conversation can only be made private to yourself' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261018110000';
COMMIT;
