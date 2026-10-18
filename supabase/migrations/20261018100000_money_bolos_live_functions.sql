-- list_money_bolos: las funciones canceladas no cuentan (revisión de Cuentas, 2026-10-18, ADR-124).
-- Antes tomaba la primera función del bolo aunque estuviera cancelada, y esa fecha
-- decidía la temporada del bolo y si estaba «por facturar»; function_count las contaba.
-- Solo cambia el LATERAL fx. Misma firma: CREATE OR REPLACE conserva los grants.
-- Rollback: build/runbooks/rollback-20261018-money-bolos-live-functions.sql.

CREATE OR REPLACE FUNCTION public.list_money_bolos(
  p_project_ids uuid[] DEFAULT NULL,
  p_workspace_ids uuid[] DEFAULT NULL,
  p_line_ids uuid[] DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_limit integer DEFAULT 200
) RETURNS TABLE (
  id uuid,
  project_id uuid,
  line_id uuid,
  conversation_id uuid,
  venue_name text,
  city text,
  country character(2),
  fee_amount numeric,
  fee_currency character(3),
  status public.performance_status,
  project jsonb,
  collected numeric,
  function_count integer,
  next_performed_at date
)
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
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'limit must be between 1 and 500' USING ERRCODE = '22023';
  END IF;

  v_projects := public.accessible_project_ids('read:money');

  RETURN QUERY
  SELECT b.id,
         b.project_id,
         b.line_id,
         b.conversation_id,
         b.venue_name,
         b.city,
         b.country,
         b.fee_amount,
         b.fee_currency,
         b.status,
         jsonb_build_object(
           'id', p.id,
           'slug', p.slug,
           'name', p.name,
           'accent', p.accent,
           'workspace_id', p.workspace_id
         ) AS project,
         coalesce((
           SELECT sum(pay.amount)
           FROM public.payment pay
           WHERE pay.deleted_at IS NULL
             AND (
               pay.bolo_id = b.id
               -- Invoice-linked only when the payment carries NO direct anchor,
               -- so a payment is counted once (never via both anchor and invoice).
               OR (pay.bolo_id IS NULL AND pay.invoice_id IN (
                 SELECT il.invoice_id
                 FROM public.invoice_line il
                 JOIN public.invoice iv ON iv.id = il.invoice_id AND iv.deleted_at IS NULL
                 WHERE il.bolo_id IS NOT NULL
                 GROUP BY il.invoice_id
                 HAVING bool_and(il.bolo_id = b.id)
               ))
             )
         ), 0) AS collected,
         fx.function_count::integer,
         fx.next_performed_at
  FROM public.bolo b
  JOIN public.project p ON p.id = b.project_id AND p.deleted_at IS NULL
  LEFT JOIN LATERAL (
    -- A cancelled function is not the bolo's date: it neither decides the
    -- season nor makes the deal «por facturar». A bolo whose functions are
    -- ALL cancelled keeps its first date, so it still has a season.
    SELECT count(*) FILTER (WHERE pf.status <> 'cancelled') AS function_count,
           coalesce(
             min(pf.performed_at) FILTER (WHERE pf.status <> 'cancelled'),
             min(pf.performed_at)
           ) AS next_performed_at
    FROM public.performance pf
    WHERE pf.bolo_id = b.id AND pf.deleted_at IS NULL
  ) fx ON true
  WHERE b.deleted_at IS NULL
    AND b.project_id = ANY (v_projects)
    AND (
      (coalesce(cardinality(p_project_ids), 0) = 0 AND coalesce(cardinality(p_workspace_ids), 0) = 0)
      OR b.project_id = ANY (coalesce(p_project_ids, '{}'::uuid[]))
      OR b.workspace_id = ANY (coalesce(p_workspace_ids, '{}'::uuid[]))
    )
    AND (
      coalesce(cardinality(p_line_ids), 0) = 0
      OR b.line_id = ANY (p_line_ids)
    )
    AND (p_from IS NULL OR fx.next_performed_at >= p_from)
    AND (p_to IS NULL OR fx.next_performed_at <= p_to)
  ORDER BY fx.next_performed_at ASC NULLS LAST, b.created_at ASC
  LIMIT p_limit;
END;
$$;
