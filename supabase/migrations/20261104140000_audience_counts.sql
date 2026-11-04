-- 106 · Los recuentos de las listas del público en una sola llamada.
--
-- GET /api/audience contaba con PostgREST una lista y un estado cada vez
-- (`select=id` con `count=exact`): 3 subpeticiones por lista, y Workers Free
-- da 50 por petición, así que la vista se caía hacia las 16 listas. Ahora
-- una sola RPC devuelve, para todas las listas de los espacios pedidos, cuántas
-- personas hay en cada estado.
--
-- Permisos: SECURITY INVOKER. La función lee `audience_subscription` como
-- quien llama, así que la RLS de siempre (`audience_subscription_select`:
-- `private.audience_access(workspace_id, false)`, owner, admin o la faceta
-- Público) decide qué filas cuenta; un espacio que no lee no sale, ni con
-- ceros. Solo toca columnas que `authenticated` ya lee por su grant de
-- columnas (`audience_id`, `status`, `workspace_id`). Una lista sin nadie no
-- sale: la ruta pone ceros.
--
-- Nueva, sin sobrecarga posible (no había ninguna `audience_counts` en la base
-- viva el 2026-11-04). Sin datos que tocar; sin backup más allá del de rutina.
--
-- Orden en producción: esta migración ANTES del Worker que la llama (el de
-- ahora no la usa).
--
-- Rollback: `DROP FUNCTION public.audience_counts(uuid[]);` después de volver
-- al Worker de antes.

CREATE FUNCTION public.audience_counts(p_workspace_ids uuid[])
RETURNS TABLE (audience_id uuid, confirmed bigint, pending bigint, unsubscribed bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT s.audience_id,
         count(*) FILTER (WHERE s.status = 'confirmed'),
         count(*) FILTER (WHERE s.status = 'pending'),
         count(*) FILTER (WHERE s.status = 'unsubscribed')
  FROM public.audience_subscription s
  WHERE s.workspace_id = ANY (p_workspace_ids)
  GROUP BY s.audience_id;
$$;

COMMENT ON FUNCTION public.audience_counts(uuid[]) IS
  'Por lista del público de esos espacios, cuántas personas hay en cada estado (106). SECURITY INVOKER: cuenta lo que la RLS deja leer a quien llama.';

REVOKE ALL ON FUNCTION public.audience_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audience_counts(uuid[]) TO authenticated;
