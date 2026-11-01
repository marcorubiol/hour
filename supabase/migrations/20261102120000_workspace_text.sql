-- 89 · Textos guardados del espacio: lo que se repite al escribir desde una
-- conversación (presentación de la compañía, condiciones, un párrafo de
-- gira) y se inserta en el correo (ADR-169 § 3, que dejó esta mitad para una
-- migración).
--
-- Quién (Marco, 2026-11-01): la escribe quien puede editar conversaciones en
-- ese espacio, no solo el admin; la leen los miembros.
--   · Escribir: `public.has_permission(<proyecto>, 'edit:conversation')` en
--     algún proyecto vivo del espacio. Es el permiso de la policy
--     `conversation_update`, por proyecto; un texto es del espacio, así que
--     basta con poder editar conversaciones en uno de sus proyectos. Sin
--     helper nuevo.
--   · Leer: `public.is_workspace_internal_member(workspace_id)` (owner, admin,
--     member, viewer). Un invitado de bolo (`guest`, ADR-142) no es de la
--     compañía y no lee los textos de la compañía.
--
-- Escritura por la API, con grants por columna: INSERT de `workspace_id`,
-- `title`, `body`; UPDATE de `title`, `body`. `created_by` sale de su DEFAULT
-- (`auth.uid()`) y el guard de siempre lo deja inmutable. Borrar es blando y va
-- por `delete_workspace_text` (SECURITY DEFINER), porque un UPDATE que esconde
-- la fila choca con la policy de lectura al devolverla (la trampa de la
-- representación de PostgREST).
--
-- Funciones existentes que se usan (producción, 2026-11-01):
-- `public.has_permission(uuid, text)`, `public.is_workspace_internal_member(uuid)`,
-- `public.uuid_generate_v7()`, `public.set_updated_at()`,
-- `public.guard_immutable_workspace_id()`, `public.guard_immutable_created_by()`.
--
-- ADITIVA según § 34: una tabla nueva y una función. Sin datos.
--
-- Rollback:
--   DROP FUNCTION public.delete_workspace_text(uuid);
--   DROP TABLE public.workspace_text;

CREATE TABLE public.workspace_text (
  id           uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id uuid NOT NULL REFERENCES public.workspace (id) ON DELETE CASCADE,
  title        text NOT NULL,
  body         text NOT NULL,
  created_by   uuid DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  CONSTRAINT workspace_text_title_length CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT workspace_text_body_length  CHECK (length(btrim(body)) BETWEEN 1 AND 20000)
);

COMMENT ON TABLE public.workspace_text IS
  '89: textos guardados del espacio para insertar en un correo. Escribe quien tiene edit:conversation en algún proyecto del espacio; leen los miembros internos. Borrado blando con delete_workspace_text.';

CREATE INDEX workspace_text_workspace_idx ON public.workspace_text (workspace_id, lower(title))
  WHERE deleted_at IS NULL;
CREATE INDEX workspace_text_created_by_idx ON public.workspace_text (created_by)
  WHERE created_by IS NOT NULL;

ALTER TABLE public.workspace_text ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.workspace_text FORCE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_text OWNER TO postgres;

CREATE TRIGGER workspace_text_set_updated_at BEFORE UPDATE ON public.workspace_text
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER workspace_text_guard_ws BEFORE UPDATE ON public.workspace_text
  FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_workspace_id();
CREATE TRIGGER workspace_text_guard_creator BEFORE UPDATE ON public.workspace_text
  FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_created_by();

REVOKE ALL ON TABLE public.workspace_text FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.workspace_text TO authenticated;
GRANT INSERT (workspace_id, title, body) ON TABLE public.workspace_text TO authenticated;
GRANT UPDATE (title, body) ON TABLE public.workspace_text TO authenticated;
GRANT ALL ON TABLE public.workspace_text TO service_role;

CREATE POLICY workspace_text_select ON public.workspace_text
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.is_workspace_internal_member(workspace_id));

CREATE POLICY workspace_text_insert ON public.workspace_text
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.project p
      WHERE p.workspace_id = workspace_text.workspace_id AND p.deleted_at IS NULL
        AND public.has_permission(p.id, 'edit:conversation')
    )
  );

CREATE POLICY workspace_text_update ON public.workspace_text
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.project p
      WHERE p.workspace_id = workspace_text.workspace_id AND p.deleted_at IS NULL
        AND public.has_permission(p.id, 'edit:conversation')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project p
      WHERE p.workspace_id = workspace_text.workspace_id AND p.deleted_at IS NULL
        AND public.has_permission(p.id, 'edit:conversation')
    )
  );

-- ── Borrar (blando) ──────────────────────────────────────────────────────
CREATE FUNCTION public.delete_workspace_text(p_text_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_workspace_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT t.workspace_id INTO v_workspace_id
  FROM public.workspace_text t
  WHERE t.id = p_text_id AND t.deleted_at IS NULL
  FOR UPDATE;

  IF v_workspace_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.project p
    WHERE p.workspace_id = v_workspace_id AND p.deleted_at IS NULL
      AND public.has_permission(p.id, 'edit:conversation')
  ) THEN
    RAISE EXCEPTION 'text not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.workspace_text SET deleted_at = now() WHERE id = p_text_id;
END;
$function$;

ALTER FUNCTION public.delete_workspace_text(uuid) OWNER TO postgres;
COMMENT ON FUNCTION public.delete_workspace_text(uuid) IS
  '89: borra (blando) un texto guardado. Quien puede editar conversaciones en algún proyecto del espacio; 42501 igual si no existe.';
REVOKE ALL ON FUNCTION public.delete_workspace_text(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_workspace_text(uuid) TO authenticated;
