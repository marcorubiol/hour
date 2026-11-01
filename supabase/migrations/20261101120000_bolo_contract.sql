-- El contrato del bolo (ADR-163, _tasks.md § 66).
--
-- ADR-087 define el bolo como «1 sala + 1 contrato + 1 fee», y el contrato no
-- tenía dónde vivir. Dos fechas en `bolo`, en el mismo sitio que el caché y
-- con la misma puerta:
--
--   1. `bolo.contract_sent_at` y `bolo.contract_signed_at` (timestamptz,
--      NULL). Sin enviar = las dos NULL; enviado = sólo la primera; firmado =
--      las dos. Un CHECK impide «firmado sin enviar». `bolo` tiene SELECT de
--      tabla entera para `authenticated` (no por columnas) y `bolo_select` pide
--      `read:money`: las columnas nuevas se leen donde se lee el caché, y en
--      ningún otro sitio. No hay vista que ampliar.
--   2. `update_bolo_contract(p_bolo_id, p_sent_at, p_signed_at)`: la forma de
--      `update_bolo_fee` (misma puerta `edit:money` sobre el proyecto del
--      trato, mismo 42501 para «no existe» y «no es tuyo», RETURNS TABLE con
--      lo que quedó). Las dos fechas llegan siempre; NULL borra. Firmar sin
--      fecha de envío la toma de la firma; una firma anterior al envío, 22023.
--   3. `list_money_bolos` devuelve las dos fechas: Cuentas («Pide atención»)
--      y la ficha del bolo («Falta», `boloMissing`) leen de ahí. Cambia el
--      tipo de retorno, así que DROP + CREATE con el cuerpo de
--      `20261018170000` (la última que la define) y sus grants. La app vieja
--      ignora las dos columnas de más: aplicar antes de desplegar es seguro.
--
-- Aditiva. Sin datos: todo bolo existente queda «sin enviar».
-- Rollback: DROP FUNCTION update_bolo_contract; volver a aplicar
-- `list_money_bolos` de 20261018170000; ALTER TABLE bolo DROP COLUMN ×2.

-- ── 1 · las dos fechas ───────────────────────────────────────────────────────
ALTER TABLE public.bolo
  ADD COLUMN contract_sent_at timestamptz,
  ADD COLUMN contract_signed_at timestamptz,
  ADD CONSTRAINT bolo_contract_signed_after_sent CHECK (
    contract_signed_at IS NULL
    OR (contract_sent_at IS NOT NULL AND contract_signed_at >= contract_sent_at)
  );

COMMENT ON COLUMN public.bolo.contract_sent_at IS
  'ADR-163: when the contract went to the venue. NULL = not sent. Written by update_bolo_contract (edit:money).';
COMMENT ON COLUMN public.bolo.contract_signed_at IS
  'ADR-163: when the contract came back signed. Needs contract_sent_at. Written by update_bolo_contract (edit:money).';

-- ── 2 · update_bolo_contract ─────────────────────────────────────────────────
CREATE FUNCTION public.update_bolo_contract(
  p_bolo_id uuid,
  p_sent_at timestamptz,
  p_signed_at timestamptz
) RETURNS TABLE (
  id uuid,
  contract_sent_at timestamptz,
  contract_signed_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_project_id uuid;
  v_sent       timestamptz := coalesce(p_sent_at, p_signed_at);
BEGIN
  SELECT b.project_id INTO v_project_id
  FROM public.bolo b WHERE b.id = p_bolo_id AND b.deleted_at IS NULL;

  IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:money') THEN
    RAISE EXCEPTION 'bolo not found or edit:money required' USING ERRCODE = '42501';
  END IF;

  IF p_signed_at IS NOT NULL AND p_signed_at < v_sent THEN
    RAISE EXCEPTION 'a contract is signed after it is sent' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.bolo b
  SET contract_sent_at = v_sent,
      contract_signed_at = p_signed_at,
      updated_at = now()
  WHERE b.id = p_bolo_id AND b.deleted_at IS NULL
  RETURNING b.id, b.contract_sent_at, b.contract_signed_at;
END;
$$;

COMMENT ON FUNCTION public.update_bolo_contract(uuid, timestamptz, timestamptz) IS
  'ADR-163: set or clear when a bolo''s contract was sent and signed. edit:money on the bolo''s project (42501 otherwise, one message). Signing without a sent date takes the signature''s; a signature before the sending is 22023.';
REVOKE ALL ON FUNCTION public.update_bolo_contract(uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_bolo_contract(uuid, timestamptz, timestamptz)
  TO authenticated;

-- ── 3 · list_money_bolos, con el contrato ────────────────────────────────────
-- Cuerpo de 20261018170000; sólo se añaden las dos columnas al final.
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
  contract_signed_at timestamptz
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
         b.contract_signed_at
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
