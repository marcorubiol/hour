-- Money v2 (ADR-074): realistic collection dates, observed payments and
-- scope-aware expenses. Payment status is derived from active payment rows;
-- the API RPCs lock the invoice so concurrent advances cannot lose the final
-- issued -> paid transition.

ALTER TABLE public.invoice
  ADD COLUMN expected_on date,
  ADD COLUMN payment_condition text;

COMMENT ON COLUMN public.invoice.expected_on IS
  'Realistic collection date, distinct from contractual due_on. Aging is measured against this date.';
COMMENT ON COLUMN public.invoice.payment_condition IS
  'What the user knows about a cascade condition, for example: pays when the town hall pays them — says October.';

ALTER TABLE public.invoice
  ADD CONSTRAINT invoice_expected_on_range
    CHECK (expected_on IS NULL OR expected_on >= issued_on),
  ADD CONSTRAINT invoice_payment_condition_length
    CHECK (payment_condition IS NULL OR length(payment_condition) <= 2000);

DROP FUNCTION public.create_invoice(uuid, numeric, numeric, text, date, text);

CREATE FUNCTION public.create_invoice(
  p_performance_id uuid,
  p_vat_pct numeric DEFAULT NULL,
  p_irpf_pct numeric DEFAULT NULL,
  p_number text DEFAULT NULL,
  p_due_on date DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_expected_on date DEFAULT NULL,
  p_payment_condition text DEFAULT NULL,
  p_payer_person_id uuid DEFAULT NULL
) RETURNS public.invoice
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_perf public.performance;
  v_project_name text;
  v_inferred_payer uuid;
  v_payer uuid;
  v_subtotal numeric;
  v_vat numeric;
  v_irpf numeric;
  v_total numeric;
  v_desc text;
  v_invoice public.invoice;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_vat_pct IS NOT NULL AND (p_vat_pct < 0 OR p_vat_pct > 100) THEN
    RAISE EXCEPTION 'vat_pct must be between 0 and 100' USING ERRCODE = '22023';
  END IF;
  IF p_irpf_pct IS NOT NULL AND (p_irpf_pct < 0 OR p_irpf_pct > 100) THEN
    RAISE EXCEPTION 'irpf_pct must be between 0 and 100' USING ERRCODE = '22023';
  END IF;
  IF p_payment_condition IS NOT NULL AND length(p_payment_condition) > 2000 THEN
    RAISE EXCEPTION 'payment_condition is too long' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_perf
  FROM public.performance
  WHERE id = p_performance_id AND deleted_at IS NULL;

  IF v_perf.id IS NULL THEN
    RAISE EXCEPTION 'performance not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_permission(v_perf.project_id, 'edit:money') THEN
    RAISE EXCEPTION 'edit:money required' USING ERRCODE = '42501';
  END IF;
  IF v_perf.fee_amount IS NULL THEN
    RAISE EXCEPTION 'performance has no fee — set the fee first' USING ERRCODE = '22023';
  END IF;
  IF p_expected_on IS NOT NULL AND p_expected_on < CURRENT_DATE THEN
    RAISE EXCEPTION 'expected_on cannot precede issued_on' USING ERRCODE = '22023';
  END IF;

  IF p_payer_person_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.workspace_person wp
    WHERE wp.workspace_id = v_perf.workspace_id
      AND wp.person_id = p_payer_person_id
      AND wp.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'payer is not in the performance workspace' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_project_name
  FROM public.project
  WHERE id = v_perf.project_id;

  SELECT person_id INTO v_inferred_payer
  FROM public.conversation
  WHERE id = v_perf.conversation_id AND deleted_at IS NULL;

  v_payer := coalesce(p_payer_person_id, v_inferred_payer);
  v_subtotal := v_perf.fee_amount;
  v_vat := CASE
    WHEN p_vat_pct IS NULL THEN NULL
    ELSE round(v_subtotal * p_vat_pct / 100, 2)
  END;
  v_irpf := CASE
    WHEN p_irpf_pct IS NULL THEN NULL
    ELSE round(v_subtotal * p_irpf_pct / 100, 2)
  END;
  v_total := v_subtotal + coalesce(v_vat, 0) - coalesce(v_irpf, 0);
  v_desc := concat_ws(
    ' — ',
    coalesce(v_project_name, 'Performance'),
    nullif(concat_ws(', ', v_perf.venue_name, v_perf.city), ''),
    to_char(v_perf.performed_at::date, 'YYYY-MM-DD')
  );

  INSERT INTO public.invoice (
    workspace_id, project_id, number, due_on, expected_on, payment_condition,
    status, subtotal, vat_pct, vat_amount, irpf_pct, irpf_amount, total,
    currency, payer_person_id, notes, created_by
  ) VALUES (
    v_perf.workspace_id,
    v_perf.project_id,
    nullif(btrim(coalesce(p_number, '')), ''),
    p_due_on,
    p_expected_on,
    nullif(btrim(coalesce(p_payment_condition, '')), ''),
    'draft',
    v_subtotal,
    p_vat_pct,
    v_vat,
    p_irpf_pct,
    v_irpf,
    v_total,
    coalesce(v_perf.fee_currency, 'EUR'),
    v_payer,
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_caller
  ) RETURNING * INTO v_invoice;

  INSERT INTO public.invoice_line (
    workspace_id, invoice_id, performance_id, description, quantity, unit_amount
  ) VALUES (
    v_perf.workspace_id, v_invoice.id, v_perf.id, v_desc, 1, v_subtotal
  );

  RETURN v_invoice;
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice(
  uuid, numeric, numeric, text, date, text, date, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_invoice(
  uuid, numeric, numeric, text, date, text, date, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_invoice_payment_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_invoice_id uuid := coalesce(NEW.invoice_id, OLD.invoice_id);
  v_invoice public.invoice;
  v_paid numeric;
BEGIN
  SELECT * INTO v_invoice
  FROM public.invoice
  WHERE id = v_invoice_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_invoice.id IS NULL THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  SELECT coalesce(sum(amount), 0) INTO v_paid
  FROM public.payment
  WHERE invoice_id = v_invoice_id AND deleted_at IS NULL;

  IF v_invoice.status = 'issued' AND v_paid >= v_invoice.total THEN
    UPDATE public.invoice SET status = 'paid' WHERE id = v_invoice_id;
  ELSIF v_invoice.status = 'paid' AND v_paid < v_invoice.total THEN
    UPDATE public.invoice SET status = 'issued' WHERE id = v_invoice_id;
  END IF;

  RETURN coalesce(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_invoice_payment_status()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_derived_invoice_paid_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_paid numeric;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(sum(amount), 0) INTO v_paid
  FROM public.payment
  WHERE invoice_id = NEW.id AND deleted_at IS NULL;

  IF NEW.status = 'paid' AND v_paid < NEW.total THEN
    RAISE EXCEPTION 'paid status derives from active payments' USING ERRCODE = '22023';
  END IF;
  IF OLD.status = 'paid'
     AND NEW.status NOT IN ('paid', 'cancelled')
     AND v_paid >= NEW.total THEN
    RAISE EXCEPTION 'paid status derives from active payments' USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_derived_invoice_paid_status()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS invoice_guard_derived_paid ON public.invoice;
CREATE TRIGGER invoice_guard_derived_paid
BEFORE UPDATE OF status ON public.invoice
FOR EACH ROW EXECUTE FUNCTION public.guard_derived_invoice_paid_status();

DROP TRIGGER IF EXISTS payment_sync_invoice_status ON public.payment;
CREATE TRIGGER payment_sync_invoice_status
AFTER INSERT OR UPDATE OF amount, deleted_at OR DELETE ON public.payment
FOR EACH ROW EXECUTE FUNCTION public.sync_invoice_payment_status();

CREATE OR REPLACE FUNCTION public.create_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_received_on date DEFAULT CURRENT_DATE,
  p_method public.payment_method DEFAULT 'transfer',
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS public.payment
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_invoice public.invoice;
  v_payment public.payment;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be greater than zero' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoice
  WHERE id = p_invoice_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_invoice.id IS NULL OR NOT (
    (v_invoice.project_id IS NOT NULL AND public.has_permission(v_invoice.project_id, 'edit:money'))
    OR (v_invoice.project_id IS NULL AND public.is_workspace_admin(v_invoice.workspace_id))
  ) THEN
    RAISE EXCEPTION 'invoice not found or edit:money required' USING ERRCODE = '42501';
  END IF;
  IF v_invoice.status NOT IN ('issued', 'paid') THEN
    RAISE EXCEPTION 'payments require an issued invoice' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payment (
    workspace_id, invoice_id, amount, received_on, method,
    reference, notes, created_by
  ) VALUES (
    v_invoice.workspace_id,
    v_invoice.id,
    round(p_amount, 2),
    coalesce(p_received_on, CURRENT_DATE),
    coalesce(p_method, 'transfer'),
    nullif(btrim(coalesce(p_reference, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_caller
  ) RETURNING * INTO v_payment;

  RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.create_payment(
  uuid, numeric, date, public.payment_method, text, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_payment(
  uuid, numeric, date, public.payment_method, text, text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_payment(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_payment public.payment;
  v_invoice public.invoice;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_payment
  FROM public.payment
  WHERE id = p_payment_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_payment.id IS NULL THEN
    RAISE EXCEPTION 'payment not found or forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoice
  WHERE id = v_payment.invoice_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_invoice.id IS NULL OR NOT (
    (v_invoice.project_id IS NOT NULL AND public.has_permission(v_invoice.project_id, 'edit:money'))
    OR (v_invoice.project_id IS NULL AND public.is_workspace_admin(v_invoice.workspace_id))
  ) THEN
    RAISE EXCEPTION 'payment not found or forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.payment
  SET deleted_at = now()
  WHERE id = v_payment.id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_payment(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_payment(uuid) TO authenticated;

-- Payments are removed through delete_payment so financial history is never
-- physically destroyed by an authenticated client.
DROP POLICY IF EXISTS payment_delete ON public.payment;

CREATE OR REPLACE FUNCTION public.list_expenses_for_scope(
  p_project_ids uuid[] DEFAULT NULL,
  p_workspace_ids uuid[] DEFAULT NULL,
  p_line_ids uuid[] DEFAULT NULL,
  p_performance_ids uuid[] DEFAULT NULL,
  p_category public.expense_category DEFAULT NULL,
  p_limit integer DEFAULT 200
) RETURNS SETOF public.expense
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'limit must be between 1 and 500' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT e.*
  FROM public.expense e
  WHERE e.deleted_at IS NULL
    AND (p_category IS NULL OR e.category = p_category)
    AND (
      EXISTS (
        SELECT 1
        FROM public.line l
        WHERE l.id = e.line_id
          AND l.deleted_at IS NULL
          AND public.has_permission(l.project_id, 'read:money')
      )
      OR EXISTS (
        SELECT 1
        FROM public.performance pf
        WHERE pf.id = e.performance_id
          AND pf.deleted_at IS NULL
          AND public.has_permission(pf.project_id, 'read:money')
      )
    )
    AND (
      (
        coalesce(cardinality(p_project_ids), 0) = 0
        AND coalesce(cardinality(p_workspace_ids), 0) = 0
        AND coalesce(cardinality(p_line_ids), 0) = 0
        AND coalesce(cardinality(p_performance_ids), 0) = 0
      )
      OR e.workspace_id = ANY (coalesce(p_workspace_ids, '{}'::uuid[]))
      OR e.line_id = ANY (coalesce(p_line_ids, '{}'::uuid[]))
      OR e.performance_id = ANY (coalesce(p_performance_ids, '{}'::uuid[]))
      OR EXISTS (
        SELECT 1 FROM public.line l
        WHERE l.id = e.line_id
          AND l.project_id = ANY (coalesce(p_project_ids, '{}'::uuid[]))
      )
      OR EXISTS (
        SELECT 1 FROM public.performance pf
        WHERE pf.id = e.performance_id
          AND pf.project_id = ANY (coalesce(p_project_ids, '{}'::uuid[]))
      )
    )
  ORDER BY e.incurred_on DESC, e.created_at DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.list_expenses_for_scope(
  uuid[], uuid[], uuid[], uuid[], public.expense_category, integer
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_expenses_for_scope(
  uuid[], uuid[], uuid[], uuid[], public.expense_category, integer
) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_money_payers(
  p_project_ids uuid[] DEFAULT NULL,
  p_workspace_ids uuid[] DEFAULT NULL,
  p_limit integer DEFAULT 500
) RETURNS TABLE (
  id uuid,
  workspace_id uuid,
  slug text,
  full_name text,
  organization_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'limit must be between 1 and 500' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (wp.workspace_id, wp.person_id)
    wp.person_id,
    wp.workspace_id,
    wp.slug,
    wp.full_name,
    org.name
  FROM public.conversation c
  JOIN public.workspace_person wp
    ON wp.workspace_id = c.workspace_id
   AND wp.person_id = c.person_id
   AND wp.deleted_at IS NULL
  LEFT JOIN public.workspace_organization org
    ON org.workspace_id = wp.workspace_id
   AND org.id = wp.organization_id
   AND org.deleted_at IS NULL
  WHERE c.deleted_at IS NULL
    AND public.has_permission(c.project_id, 'edit:money')
    AND (
      (
        coalesce(cardinality(p_project_ids), 0) = 0
        AND coalesce(cardinality(p_workspace_ids), 0) = 0
      )
      OR c.project_id = ANY (coalesce(p_project_ids, '{}'::uuid[]))
      OR c.workspace_id = ANY (coalesce(p_workspace_ids, '{}'::uuid[]))
    )
  ORDER BY wp.workspace_id, wp.person_id, wp.full_name
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.list_money_payers(uuid[], uuid[], integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_money_payers(uuid[], uuid[], integer)
  TO authenticated;
