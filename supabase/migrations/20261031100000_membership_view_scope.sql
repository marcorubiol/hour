-- ADR-151: «Lo mío / Todo» por espacio. Cada membresía de espacio guarda qué
-- enseñan en ese espacio las superficies personales (Hoy, Ahora, el pulso) y el
-- Planificador: solo lo tuyo (reparto o tu «voy») o toda la compañía.
--
-- Aditiva según § 34 (sin staging: una columna nula y una función nueva):
--   · `membership.view_scope`: 'mine' | 'all' | NULL. NULL = lo que da el paquete
--     (Mínim, Equip → mine; Coordinació, Direcció, owner → all; sin paquete, por
--     rol: admin y member → all, viewer y guest → mine). La regla del valor por
--     defecto vive en la app (`$lib/view-scope`), no aquí: un paquete que cambia
--     cambia el defecto sin migrar nada.
--   · Se lee con la fila propia: `authenticated` tiene SELECT a tabla entera en
--     `membership` y la policy `membership_select` deja leer las propias. No hay
--     grant por columnas que tocar.
--   · Se escribe solo con `set_my_view_scope`, la propia y en el nivel espacio:
--     `authenticated` no tiene UPDATE en `membership`.
--
-- Rollback:
--   DROP FUNCTION public.set_my_view_scope(uuid, text);
--   ALTER TABLE public.membership DROP COLUMN view_scope;

ALTER TABLE public.membership
  ADD COLUMN view_scope text,
  ADD CONSTRAINT membership_view_scope_check
    CHECK (view_scope IS NULL OR (level = 'workspace' AND view_scope IN ('mine', 'all')));

COMMENT ON COLUMN public.membership.view_scope IS
  'ADR-151: what this member''s personal surfaces (Hoy, Ahora, the pulse) and the Planner show in this workspace: mine (rows they are on by roster or «voy») or all (the whole company). NULL = the default of their access package. Workspace level only; written through set_my_view_scope.';

CREATE FUNCTION public.set_my_view_scope(p_workspace_id uuid, p_scope text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL OR NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace % not found', p_workspace_id USING ERRCODE = '42501';
  END IF;
  IF p_scope IS NOT NULL AND p_scope NOT IN ('mine', 'all') THEN
    RAISE EXCEPTION 'view scope must be mine, all or null' USING ERRCODE = '22023';
  END IF;
  UPDATE public.membership
  SET view_scope = p_scope
  WHERE level = 'workspace' AND workspace_id = p_workspace_id AND user_id = v_caller
    AND view_scope IS DISTINCT FROM p_scope;
END;
$function$;

COMMENT ON FUNCTION public.set_my_view_scope(uuid, text) IS
  'ADR-151: the caller sets «lo mío / todo» on their own workspace membership. NULL returns to the package default.';

REVOKE ALL ON FUNCTION public.set_my_view_scope(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_my_view_scope(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_my_view_scope(uuid, text) TO authenticated;
