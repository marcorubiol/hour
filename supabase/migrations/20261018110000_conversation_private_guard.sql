-- ADR-123 § 2: solo quien creó una conversación compartida, o el admin, la
-- vuelve privada (`build/coordination/review-conversations/permisos.md`,
-- hallazgo 2).
--
-- Reescribe un guard; nada más. Rollback:
-- `build/runbooks/rollback-20261018-conversation-private-guard.sql`.
--
-- ADR-100: «cada persona cambia después las suyas». Antes bastaba con
-- `edit:conversation`, y un Coordinació podía hacer desaparecer para todos una
-- conversación de la compañía. Revivir una borrada (OLD.deleted_at) no es
-- volverla privada: estaba fuera para todos y renace con el valor del espacio.
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
    IF OLD.private_to IS NULL AND NEW.private_to IS NOT NULL AND OLD.deleted_at IS NULL
       AND OLD.created_by IS DISTINCT FROM v_caller
       AND NOT public.is_workspace_admin(OLD.workspace_id) THEN
      RAISE EXCEPTION 'only who created a shared conversation, or an admin, can make it private'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
