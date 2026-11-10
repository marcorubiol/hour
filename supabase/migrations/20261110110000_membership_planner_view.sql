-- ADR-192 (129): la vista de entrada del Planificador por persona. Cada
-- membresía de espacio guarda el último dibujo que la persona eligió en la
-- barra del Planificador en ese espacio; entrar sin `?view=` abre ese.
--
-- Aditiva según § 34 (sin staging: una columna nula y una función nueva):
--   · `membership.planner_view`: 'overview' | 'agenda' | 'month' | 'board' | NULL.
--     Las palabras de la URL (`?view=`), las cuatro de la barra (ADR-155 § 1).
--     'day' no: el Día es una lupa, no una vista de entrada. NULL = el defecto
--     de siempre, la Temporada.
--   · Se lee con la fila propia, como `view_scope` (ADR-151): `authenticated`
--     tiene SELECT a tabla entera en `membership` y `GET /api/workspaces` pide
--     `select=*` de las propias. No hay grant por columnas que tocar.
--   · Se escribe solo con `set_my_planner_view`, la propia y en el nivel
--     espacio: `authenticated` no tiene UPDATE en `membership`. Copia de
--     `set_my_view_scope` tal como está en la base viva (2026-11-10).
--
-- Rollback:
--   DROP FUNCTION public.set_my_planner_view(uuid, text);
--   ALTER TABLE public.membership DROP COLUMN planner_view;

ALTER TABLE public.membership
  ADD COLUMN planner_view text,
  ADD CONSTRAINT membership_planner_view_check
    CHECK (planner_view IS NULL OR (level = 'workspace' AND planner_view IN ('overview', 'agenda', 'month', 'board')));

COMMENT ON COLUMN public.membership.planner_view IS
  'ADR-192: the Planner drawing this member opens in this workspace when the address names none: the last one they chose in the Planner bar (overview, agenda, month, board). NULL = the season overview. Workspace level only; written through set_my_planner_view.';

CREATE FUNCTION public.set_my_planner_view(p_workspace_id uuid, p_view text)
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
  IF p_view IS NOT NULL AND p_view NOT IN ('overview', 'agenda', 'month', 'board') THEN
    RAISE EXCEPTION 'planner view must be overview, agenda, month, board or null' USING ERRCODE = '22023';
  END IF;
  UPDATE public.membership
  SET planner_view = p_view
  WHERE level = 'workspace' AND workspace_id = p_workspace_id AND user_id = v_caller
    AND planner_view IS DISTINCT FROM p_view;
END;
$function$;

COMMENT ON FUNCTION public.set_my_planner_view(uuid, text) IS
  'ADR-192: the caller sets the Planner drawing they open in, on their own workspace membership. NULL returns to the season overview.';

REVOKE ALL ON FUNCTION public.set_my_planner_view(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_my_planner_view(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_my_planner_view(uuid, text) TO authenticated;
