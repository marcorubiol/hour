-- El bolo como historia (tarea 120, ADR-177, mesa § 8): «¿cuándo nos pagan?».
--
-- La ficha del bolo cuenta su vida en orden: se cerró el trato, contrato,
-- funciones, factura, vencimiento, cobros, con una raya de hoy. Todo eso ya
-- tiene fecha en la base salvo lo primero: cuándo se cerró el trato. `bolo`
-- guarda el estado, no cuándo llegó a él. Esta migración le da esa fecha:
--
--   1. `bolo.confirmed_at` (timestamptz, NULL): cuándo el bolo pasó a
--      contratado (confirmed, done, invoiced, paid; `isContracted` en
--      `$lib/money`). NULL = aún no, o no se sabe. Lo escribe un trigger, no
--      la app: cualquier camino que cambie el estado (create_bolo, el PATCH,
--      la sincronía con la función) lo deja bien.
--        - Entra en contratado desde fuera (propuesto, reserva, cancelado):
--          now().
--        - Vuelve a propuesto o reserva: NULL (el trato se deshizo).
--        - Se cancela: se queda (se cerró y luego se cayó; la historia lo
--          cuenta así).
--        - Se mueve dentro de contratado (confirmed → done): no cambia.
--   2. Relleno de los bolos que ya existen, desde `audit_log` (el trigger
--      `bolo_audit` guarda before/after de cada cambio): la ÚLTIMA vez que
--      entró en contratado; si nació contratado y nunca salió, su alta. Si el
--      bolo está hoy en propuesto o reserva, NULL. Sin rastro: NULL (la
--      ficha no inventa una fecha). Durante el relleno se apaga sólo
--      `bolo_set_updated_at`, para que los bolos no parezcan tocados hoy (48 contratados en producción, todos con rastro, a 2026-11-05); la
--      auditoría sigue encendida.
--   3. `list_money_bolos` devuelve `created_at` (cuándo se abrió el trato) y
--      `confirmed_at`. Cambia el tipo de retorno: DROP + CREATE con el cuerpo
--      VIVO (`pg_get_functiondef`, 2026-11-05, igual a 20261101120000) y sus
--      grants; sólo se añaden las dos columnas al final. La app vieja ignora
--      las columnas de más: aplicar antes de desplegar es seguro.
--
-- `bolo` tiene SELECT de tabla entera para `authenticated` y `bolo_select`
-- pide `read:money`: la columna nueva se lee donde se lee el caché, y en
-- ningún otro sitio.
--
-- Aditiva. Rollback: DROP TRIGGER bolo_confirmed_at ON bolo; DROP FUNCTION
-- private.bolo_confirmed_at(); volver a aplicar `list_money_bolos` de
-- 20261101120000; ALTER TABLE bolo DROP COLUMN confirmed_at.

-- ── 1 · la fecha ─────────────────────────────────────────────────────────────
ALTER TABLE public.bolo ADD COLUMN confirmed_at timestamptz;

COMMENT ON COLUMN public.bolo.confirmed_at IS
  'Tarea 120: when the deal became contracted (confirmed/done/invoiced/paid). NULL = not yet, or unknown. Written by the bolo_confirmed_at trigger only; kept on cancel, cleared when the deal goes back to proposed or hold.';

-- ── 2 · el relleno ───────────────────────────────────────────────────────────
ALTER TABLE public.bolo DISABLE TRIGGER bolo_set_updated_at;

WITH contracted(s) AS (
  VALUES ('confirmed'), ('done'), ('invoiced'), ('paid')
),
entered AS (
  -- Cada vez que un bolo entró en contratado: un alta ya contratada, o un
  -- cambio cuyo «antes» no lo era y cuyo «después» sí.
  SELECT a.entity_id AS bolo_id, max(a.created_at) AS at
  FROM public.audit_log a
  WHERE a.entity_type = 'bolo'
    AND (
      (a.action = 'insert' AND a.changes ->> 'status' IN (SELECT s FROM contracted))
      OR (
        a.action = 'update'
        AND a.changes -> 'after' ->> 'status' IN (SELECT s FROM contracted)
        AND coalesce(a.changes -> 'before' ->> 'status', '') NOT IN (SELECT s FROM contracted)
      )
    )
  GROUP BY a.entity_id
)
UPDATE public.bolo b
SET confirmed_at = e.at
FROM entered e
WHERE e.bolo_id = b.id
  AND b.status::text NOT IN ('proposed', 'hold', 'hold_1', 'hold_2', 'hold_3');

ALTER TABLE public.bolo ENABLE TRIGGER bolo_set_updated_at;

-- ── 3 · el trigger ───────────────────────────────────────────────────────────
CREATE FUNCTION private.bolo_confirmed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_now  boolean := NEW.status::text IN ('confirmed', 'done', 'invoiced', 'paid');
  v_was  boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.confirmed_at := CASE WHEN v_now THEN coalesce(NEW.confirmed_at, now()) END;
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    -- Nadie la escribe a mano: la fecha sólo la mueve un cambio de estado.
    NEW.confirmed_at := OLD.confirmed_at;
    RETURN NEW;
  END IF;

  v_was := OLD.status::text IN ('confirmed', 'done', 'invoiced', 'paid');
  IF v_now AND NOT v_was THEN
    NEW.confirmed_at := now();
  ELSIF v_now THEN
    NEW.confirmed_at := OLD.confirmed_at;
  ELSIF NEW.status::text = 'cancelled' THEN
    NEW.confirmed_at := OLD.confirmed_at;
  ELSE
    NEW.confirmed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.bolo_confirmed_at() IS
  'Tarea 120: keeps bolo.confirmed_at = when the deal last became contracted. Kept on cancel, cleared back in proposed/hold.';
REVOKE ALL ON FUNCTION private.bolo_confirmed_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER bolo_confirmed_at
  BEFORE INSERT OR UPDATE ON public.bolo
  FOR EACH ROW EXECUTE FUNCTION private.bolo_confirmed_at();

-- ── 4 · list_money_bolos, con las dos fechas ─────────────────────────────────
-- Cuerpo vivo (2026-11-05); sólo se añaden `created_at` y `confirmed_at` al final.
DROP FUNCTION public.list_money_bolos(uuid[], uuid[], uuid[], date, date, integer);

CREATE FUNCTION public.list_money_bolos(
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
  first_performed_at date,
  last_performed_at date,
  contract_sent_at timestamptz,
  contract_signed_at timestamptz,
  created_at timestamptz,
  confirmed_at timestamptz
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
         fx.first_performed_at,
         fx.last_performed_at,
         b.contract_sent_at,
         b.contract_signed_at,
         b.created_at,
         b.confirmed_at
  FROM public.bolo b
  JOIN public.project p ON p.id = b.project_id AND p.deleted_at IS NULL
  LEFT JOIN LATERAL (
    -- A cancelled function is not the bolo's date: it neither decides the
    -- season nor makes the deal «por facturar». The first live function
    -- decides the season; the last live one, when the deal is performed and
    -- can be invoiced. A bolo whose functions are ALL cancelled keeps its
    -- first and last dates, so it still has a season.
    SELECT count(*) FILTER (WHERE pf.status <> 'cancelled') AS function_count,
           coalesce(
             min(pf.performed_at) FILTER (WHERE pf.status <> 'cancelled'),
             min(pf.performed_at)
           ) AS first_performed_at,
           coalesce(
             max(pf.performed_at) FILTER (WHERE pf.status <> 'cancelled'),
             max(pf.performed_at)
           ) AS last_performed_at
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
    AND (p_from IS NULL OR fx.first_performed_at >= p_from)
    AND (p_to IS NULL OR fx.first_performed_at <= p_to)
  ORDER BY fx.first_performed_at ASC NULLS LAST, b.created_at ASC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.list_money_bolos(
  uuid[], uuid[], uuid[], date, date, integer
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_money_bolos(
  uuid[], uuid[], uuid[], date, date, integer
) TO authenticated;
