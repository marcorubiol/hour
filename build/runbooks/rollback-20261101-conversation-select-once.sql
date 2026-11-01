-- Rollback de 20261101110000_conversation_select_once (ADR-160): el USING de
-- 20261011200000_mail_google, con has_permission por fila.
ALTER POLICY conversation_select ON public.conversation
  USING (
    deleted_at IS NULL
    AND has_permission(project_id, 'read:conversation'::text)
    AND (private_to IS NULL OR private_to = (SELECT auth.uid()))
  );
