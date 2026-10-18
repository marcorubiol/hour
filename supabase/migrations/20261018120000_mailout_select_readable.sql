-- ADR-124 § 8: un envío lo lee quien lo creó, o quien lee conversaciones del
-- proyecto si el envío no tiene destinatarios todavía o tiene al menos uno que
-- puede leer (`build/coordination/review-conversations/permisos.md`, hallazgo 3).
--
-- Antes bastaba `read:conversation` en el proyecto: un envío cuyos
-- destinatarios son todos conversaciones privadas ajenas (o borradas) se leía
-- entero, y su asunto y su cuerpo son texto libre que puede nombrar la sala de
-- una privada ajena. Un borrador vacío no nombra a nadie: sigue a la vista del
-- equipo, como antes.
--
-- Cambia una política y añade una función. Sin datos. Rollback:
-- `build/runbooks/rollback-20261018-mailout-select-readable.sql`.

-- SECURITY DEFINER: la política de `mailout_recipient` lee `mailout`, así que
-- preguntar desde aquí por los destinatarios con RLS daría recursión.
CREATE FUNCTION private.mailout_readable_by_caller(p_mailout_id uuid, p_created_by uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH me AS (SELECT auth.uid() AS uid)
  SELECT p_created_by = me.uid
    OR NOT EXISTS (SELECT 1 FROM public.mailout_recipient r WHERE r.mailout_id = p_mailout_id)
    OR EXISTS (
      SELECT 1
      FROM public.mailout_recipient r
      JOIN public.conversation c ON c.id = r.conversation_id
      WHERE r.mailout_id = p_mailout_id
        AND c.deleted_at IS NULL
        AND (c.private_to IS NULL OR c.private_to = me.uid)
        AND private.model_has_permission(c.project_id, 'read:conversation', me.uid)
    )
  FROM me;
$$;

REVOKE ALL ON FUNCTION private.mailout_readable_by_caller(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.mailout_readable_by_caller(uuid, uuid) TO authenticated;

ALTER POLICY mailout_select ON public.mailout
  USING (public.has_permission(project_id, 'read:conversation')
         AND private.mailout_readable_by_caller(id, created_by));
