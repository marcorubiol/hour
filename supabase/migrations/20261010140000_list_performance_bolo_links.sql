-- ADR-087 · `_tasks.md § 36`: leer de qué bolo cuelga una función.
--
-- Escribir el enlace se puede desde agosto (PATCH, `edit:performance`) y desde
-- § 37 también al crear. LEERLO no se podía de ninguna manera: `bolo_id` está
-- fuera del SELECT por columnas de `performance` a propósito
-- (20260720172431), porque saber de qué trato cuelga una fecha es dinero. Sin
-- lectura, la ficha de una función no puede ofrecer cambiar su bolo: el
-- selector no sabría qué valor tiene, y guardarlo lo borraría.
--
-- LA PUERTA ES LA DE LEER DINERO, y la misma que `list_money_bolos`:
-- `accessible_project_ids('read:money')`. Quien no lee dinero en el proyecto
-- de la función no recibe la fila, ni con `bolo_id` NULL; así no distingue
-- «sin bolo» de «no te toca», igual que el resto del dinero. Quien sí lee
-- recibe una fila por función viva, con `bolo_id` NULL cuando no tiene trato.
--
-- NO SE ABRE LA COLUMNA. Concederla en el grant por columnas la daría a todo
-- `authenticated` con solo `read:performance`; una RPC con la puerta de
-- dinero es la forma que ya tiene la casa (money v3 lee todo por RPC).
--
-- Solo lectura y aditiva: el Worker desplegado no la llama, así que puede
-- entrar antes que el código. Rollback:
-- `build/runbooks/rollback-20261010-list-performance-bolo-links.sql`.

CREATE FUNCTION public.list_performance_bolo_links(p_performance_ids uuid[])
RETURNS TABLE(performance_id uuid, bolo_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_projects uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(p_performance_ids), 0) > 500 THEN
    RAISE EXCEPTION 'at most 500 performance ids' USING ERRCODE = '22023';
  END IF;

  v_projects := public.accessible_project_ids('read:money');

  RETURN QUERY
  SELECT pf.id, pf.bolo_id
  FROM public.performance pf
  WHERE pf.id = ANY (coalesce(p_performance_ids, '{}'::uuid[]))
    AND pf.deleted_at IS NULL
    AND pf.project_id = ANY (v_projects);
END;
$$;

COMMENT ON FUNCTION public.list_performance_bolo_links(uuid[]) IS
  'ADR-087 § 36: de qué bolo cuelga cada función, solo para quien tiene read:money en su proyecto. bolo_id queda fuera del SELECT por columnas de performance a propósito.';

REVOKE ALL ON FUNCTION public.list_performance_bolo_links(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_performance_bolo_links(uuid[]) TO authenticated;
