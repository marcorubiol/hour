-- Money v3 (ADR-086 + ADR-087) — Phase 3: payment decoupled from the invoice,
-- anchored to the deal. The fee is the anchor and lives on the bolo; a payment
-- attaches to a bolo / line / project (or, as in v2, an invoice) and carries a
-- counterparty + category. "Collected" becomes a derived read against the bolo
-- fee (list_money_bolos) alongside v2's invoice-paid triggers, which stay intact.
-- Additive to money v2: its create_payment / create_expense calls, the
-- invoice-paid derivation and the money v2 UI keep working. The gig-level
-- expense re-anchors to the bolo (the deal) here too — the table move + read
-- helpers live in the bolo phase; this only swaps create_expense's anchor and
-- adds a counterparty.

-- ── payment: nullable invoice link + anchor + counterparty + category ────────
ALTER TABLE public.payment ALTER COLUMN invoice_id DROP NOT NULL;

-- Anchor FKs are NO ACTION (not SET NULL): a payment is money that must never
-- be silently stripped of its last attachment (that would abort against
-- payment_has_attachment). Deleting an anchor with live payments raises an
-- honest 23503, same class as delete_bolo's live-invoice guard.
ALTER TABLE public.payment
  ADD COLUMN bolo_id      uuid REFERENCES public.bolo(id),
  ADD COLUMN line_id      uuid REFERENCES public.line(id),
  ADD COLUMN project_id   uuid REFERENCES public.project(id),
  ADD COLUMN counterparty text,
  ADD COLUMN category     text;

-- Every payment attaches to at least one thing (an invoice or a scope anchor).
ALTER TABLE public.payment
  ADD CONSTRAINT payment_has_attachment CHECK (
    invoice_id IS NOT NULL
    OR bolo_id IS NOT NULL
    OR line_id IS NOT NULL
    OR project_id IS NOT NULL
  );

COMMENT ON COLUMN public.payment.invoice_id IS
  'Optional link to a document (ADR-086 D3). A payment usually anchors to a fee, not an invoice; the invoice link is metadata.';
COMMENT ON COLUMN public.payment.bolo_id IS
  'Fee anchor: the deal this payment is collected against (ADR-087). "Collected" derives from active payments anchored here.';
COMMENT ON COLUMN public.payment.counterparty IS 'Who paid (free text; a receiver identity is not required to record money).';
COMMENT ON COLUMN public.payment.category IS 'Optional payment category (caixet / bestreta / …); load-bearing only in size B.';

CREATE INDEX payment_bolo_id_idx    ON public.payment (bolo_id)    WHERE bolo_id IS NOT NULL;
CREATE INDEX payment_line_id_idx    ON public.payment (line_id)    WHERE line_id IS NOT NULL;
CREATE INDEX payment_project_id_idx ON public.payment (project_id) WHERE project_id IS NOT NULL;

-- ── expense: counterparty ───────────────────────────────────────────────────
ALTER TABLE public.expense ADD COLUMN counterparty text;
COMMENT ON COLUMN public.expense.counterparty IS 'Optional — who was paid (ADR-086 D4).';

-- ── payment RLS: cover both invoice-linked and anchor-based rows ─────────────
-- Reads require read:money on the payment's effective project (via invoice,
-- bolo, line or project) or workspace admin for a workspace-scoped invoice.
-- Writes require edit:money the same way. Direct writes still also require the
-- JWT's current workspace; the create_payment RPC (SECURITY DEFINER) is the
-- real path and applies its own gate.
DROP POLICY IF EXISTS payment_select ON public.payment;
DROP POLICY IF EXISTS payment_insert ON public.payment;
DROP POLICY IF EXISTS payment_update ON public.payment;

CREATE POLICY payment_select ON public.payment
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL AND (
      (invoice_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.invoice iv WHERE iv.id = payment.invoice_id AND (
          (iv.project_id IS NOT NULL AND public.has_permission(iv.project_id, 'read:money'))
          OR (iv.project_id IS NULL AND public.is_workspace_admin(iv.workspace_id))
        )
      ))
      OR (bolo_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.bolo b
        WHERE b.id = payment.bolo_id AND b.deleted_at IS NULL
          AND public.has_permission(b.project_id, 'read:money')
      ))
      OR (line_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.line l
        WHERE l.id = payment.line_id AND l.deleted_at IS NULL
          AND public.has_permission(l.project_id, 'read:money')
      ))
      OR (project_id IS NOT NULL AND public.has_permission(payment.project_id, 'read:money'))
    )
  );

-- Writes require edit:money on EVERY populated attachment (AND, not OR): a row
-- carrying both an anchor and a foreign invoice_id must not be authorized by the
-- anchor alone — otherwise a caller could smuggle a payment onto an invoice they
-- cannot edit and the (still-active) sync trigger would flip that invoice paid.
-- payment_has_attachment still guarantees ≥1 attachment, so ≥1 real edit:money.
CREATE POLICY payment_insert ON public.payment
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND (invoice_id IS NULL OR EXISTS (
      SELECT 1 FROM public.invoice iv
      WHERE iv.id = payment.invoice_id AND iv.workspace_id = payment.workspace_id
        AND ((iv.project_id IS NOT NULL AND public.has_permission(iv.project_id, 'edit:money'))
             OR (iv.project_id IS NULL AND public.is_workspace_admin(iv.workspace_id)))
    ))
    AND (bolo_id IS NULL OR EXISTS (
      SELECT 1 FROM public.bolo b
      WHERE b.id = payment.bolo_id AND b.deleted_at IS NULL
        AND public.has_permission(b.project_id, 'edit:money')
    ))
    AND (line_id IS NULL OR EXISTS (
      SELECT 1 FROM public.line l
      WHERE l.id = payment.line_id AND l.deleted_at IS NULL
        AND public.has_permission(l.project_id, 'edit:money')
    ))
    AND (project_id IS NULL OR public.has_permission(payment.project_id, 'edit:money'))
  );

CREATE POLICY payment_update ON public.payment
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND (invoice_id IS NULL OR EXISTS (
      SELECT 1 FROM public.invoice iv
      WHERE iv.id = payment.invoice_id AND iv.workspace_id = payment.workspace_id
        AND ((iv.project_id IS NOT NULL AND public.has_permission(iv.project_id, 'edit:money'))
             OR (iv.project_id IS NULL AND public.is_workspace_admin(iv.workspace_id)))
    ))
    AND (bolo_id IS NULL OR EXISTS (
      SELECT 1 FROM public.bolo b
      WHERE b.id = payment.bolo_id AND b.deleted_at IS NULL
        AND public.has_permission(b.project_id, 'edit:money')
    ))
    AND (line_id IS NULL OR EXISTS (
      SELECT 1 FROM public.line l
      WHERE l.id = payment.line_id AND l.deleted_at IS NULL
        AND public.has_permission(l.project_id, 'edit:money')
    ))
    AND (project_id IS NULL OR public.has_permission(payment.project_id, 'edit:money'))
  )
  WITH CHECK (
    (invoice_id IS NULL OR EXISTS (
      SELECT 1 FROM public.invoice iv
      WHERE iv.id = payment.invoice_id AND iv.workspace_id = payment.workspace_id
        AND ((iv.project_id IS NOT NULL AND public.has_permission(iv.project_id, 'edit:money'))
             OR (iv.project_id IS NULL AND public.is_workspace_admin(iv.workspace_id)))
    ))
    AND (bolo_id IS NULL OR EXISTS (
      SELECT 1 FROM public.bolo b
      WHERE b.id = payment.bolo_id AND b.deleted_at IS NULL
        AND public.has_permission(b.project_id, 'edit:money')
    ))
    AND (line_id IS NULL OR EXISTS (
      SELECT 1 FROM public.line l
      WHERE l.id = payment.line_id AND l.deleted_at IS NULL
        AND public.has_permission(l.project_id, 'edit:money')
    ))
    AND (project_id IS NULL OR public.has_permission(payment.project_id, 'edit:money'))
  );

-- ── create_payment v3: invoice path (v2, unchanged) OR anchor path ───────────
DROP FUNCTION public.create_payment(uuid, numeric, date, public.payment_method, text, text);

CREATE FUNCTION public.create_payment(
  p_invoice_id uuid DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_received_on date DEFAULT CURRENT_DATE,
  p_method public.payment_method DEFAULT 'transfer',
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_bolo_id uuid DEFAULT NULL,
  p_line_id uuid DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_counterparty text DEFAULT NULL,
  p_category text DEFAULT NULL
) RETURNS public.payment
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_invoice      public.invoice;
  v_workspace_id uuid;
  v_project_id   uuid;
  v_anchors      integer := num_nonnulls(p_bolo_id, p_line_id, p_project_id);
  v_payment      public.payment;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be greater than zero' USING ERRCODE = '22023';
  END IF;

  IF p_invoice_id IS NOT NULL THEN
    -- v2 path: against an invoice; the sync trigger derives invoice paid.
    -- A payment attaches to an invoice OR a scope anchor, never both: the
    -- invoice already ties to its bolo through invoice_line. Rejecting the
    -- combination is a hard boundary — this RPC is SECURITY DEFINER and bypasses
    -- the payment RLS, so an unchecked caller-supplied anchor here would smuggle
    -- a payment onto a bolo/line/project the caller cannot edit (and would also
    -- double-count in collected).
    IF v_anchors <> 0 THEN
      RAISE EXCEPTION 'a payment attaches to an invoice OR a scope anchor, not both'
        USING ERRCODE = '22023';
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
    v_workspace_id := v_invoice.workspace_id;
  ELSE
    -- v3 path: anchored to exactly one of bolo / line / project.
    IF v_anchors <> 1 THEN
      RAISE EXCEPTION 'a payment needs an invoice or exactly one anchor (bolo, line or project)'
        USING ERRCODE = '22023';
    END IF;
    IF p_bolo_id IS NOT NULL THEN
      SELECT workspace_id, project_id INTO v_workspace_id, v_project_id
      FROM public.bolo WHERE id = p_bolo_id AND deleted_at IS NULL;
    ELSIF p_line_id IS NOT NULL THEN
      SELECT workspace_id, project_id INTO v_workspace_id, v_project_id
      FROM public.line WHERE id = p_line_id AND deleted_at IS NULL;
    ELSE
      SELECT workspace_id, id INTO v_workspace_id, v_project_id
      FROM public.project WHERE id = p_project_id AND deleted_at IS NULL;
    END IF;
    IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:money') THEN
      RAISE EXCEPTION 'anchor not found or edit:money required' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.payment (
    workspace_id, invoice_id, amount, received_on, method, reference, notes,
    bolo_id, line_id, project_id, counterparty, category, created_by
  ) VALUES (
    v_workspace_id,
    p_invoice_id,
    round(p_amount, 2),
    coalesce(p_received_on, CURRENT_DATE),
    coalesce(p_method, 'transfer'),
    nullif(btrim(coalesce(p_reference, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_bolo_id,
    p_line_id,
    p_project_id,
    nullif(btrim(coalesce(p_counterparty, '')), ''),
    nullif(btrim(coalesce(p_category, '')), ''),
    v_caller
  ) RETURNING * INTO v_payment;

  RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.create_payment(
  uuid, numeric, date, public.payment_method, text, text, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_payment(
  uuid, numeric, date, public.payment_method, text, text, uuid, uuid, uuid, text, text
) TO authenticated;

-- delete_payment v3: authorise removal against whatever the payment attaches to
-- (invoice OR anchor), so anchor-only payments are reversible. Same signature as
-- v2 (grants carry over); soft-delete re-derives invoice-linked status via the
-- existing trigger and no-ops for anchor-only rows.
CREATE OR REPLACE FUNCTION public.delete_payment(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_payment public.payment;
  v_ok      boolean := false;
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

  IF v_payment.invoice_id IS NOT NULL THEN
    SELECT (
      (iv.project_id IS NOT NULL AND public.has_permission(iv.project_id, 'edit:money'))
      OR (iv.project_id IS NULL AND public.is_workspace_admin(iv.workspace_id))
    ) INTO v_ok
    FROM public.invoice iv WHERE iv.id = v_payment.invoice_id AND iv.deleted_at IS NULL;
  ELSIF v_payment.bolo_id IS NOT NULL THEN
    SELECT public.has_permission(b.project_id, 'edit:money') INTO v_ok
    FROM public.bolo b WHERE b.id = v_payment.bolo_id AND b.deleted_at IS NULL;
  ELSIF v_payment.line_id IS NOT NULL THEN
    SELECT public.has_permission(l.project_id, 'edit:money') INTO v_ok
    FROM public.line l WHERE l.id = v_payment.line_id AND l.deleted_at IS NULL;
  ELSIF v_payment.project_id IS NOT NULL THEN
    v_ok := public.has_permission(v_payment.project_id, 'edit:money');
  END IF;

  IF NOT coalesce(v_ok, false) THEN
    RAISE EXCEPTION 'payment not found or forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.payment SET deleted_at = now() WHERE id = v_payment.id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_payment(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_payment(uuid) TO authenticated;

-- ── create_expense v3: anchor to bolo | line, + counterparty ────────────────
-- The gig-level cost anchors to the deal now (ADR-087); line costs unchanged.
DROP FUNCTION public.create_expense(uuid, uuid, public.expense_category, text, numeric, text, date, text);

CREATE FUNCTION public.create_expense(
  p_bolo_id uuid DEFAULT NULL,
  p_line_id uuid DEFAULT NULL,
  p_category public.expense_category DEFAULT 'other',
  p_description text DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_currency text DEFAULT 'EUR',
  p_incurred_on date DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_counterparty text DEFAULT NULL
) RETURNS public.expense
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_project_id   uuid;
  v_description  text := nullif(btrim(coalesce(p_description, '')), '');
  v_currency     text := upper(nullif(btrim(coalesce(p_currency, '')), ''));
  v_expense      public.expense;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF num_nonnulls(p_bolo_id, p_line_id) <> 1 THEN
    RAISE EXCEPTION 'exactly one of bolo_id or line_id is required' USING ERRCODE = '22023';
  END IF;
  IF v_description IS NULL THEN
    RAISE EXCEPTION 'description cannot be empty' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be greater than zero' USING ERRCODE = '22023';
  END IF;
  IF v_currency IS NULL OR v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'currency must be a 3-letter code' USING ERRCODE = '22023';
  END IF;

  IF p_bolo_id IS NOT NULL THEN
    SELECT workspace_id, project_id INTO v_workspace_id, v_project_id
    FROM public.bolo WHERE id = p_bolo_id AND deleted_at IS NULL;
  ELSE
    SELECT workspace_id, project_id INTO v_workspace_id, v_project_id
    FROM public.line WHERE id = p_line_id AND deleted_at IS NULL;
  END IF;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'parent not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_permission(v_project_id, 'edit:money') THEN
    RAISE EXCEPTION 'edit:money required to record an expense' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.expense (
    workspace_id, bolo_id, line_id, category, description, amount,
    currency, incurred_on, notes, counterparty, created_by
  ) VALUES (
    v_workspace_id, p_bolo_id, p_line_id, p_category, v_description,
    round(p_amount, 2), v_currency,
    coalesce(p_incurred_on, CURRENT_DATE),
    nullif(btrim(coalesce(p_notes, '')), ''),
    nullif(btrim(coalesce(p_counterparty, '')), ''),
    v_caller
  ) RETURNING * INTO v_expense;

  RETURN v_expense;
END;
$$;

REVOKE ALL ON FUNCTION public.create_expense(
  uuid, uuid, public.expense_category, text, numeric, text, date, text, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_expense(
  uuid, uuid, public.expense_category, text, numeric, text, date, text, text
) TO authenticated;

-- ── list_money_bolos: one row per deal, with collected (ADR-087) ─────────────
-- The Money lens lists bolos (not functions). Collected = active payments
-- anchored directly to the bolo OR linked to an invoice whose lines reference
-- only this bolo (so a multi-bolo invoice's payment is not double-counted).
-- function_count / next_performed_at come from the bolo's functions for display.
-- Replaces list_money_performances (fee is on the bolo now, not the function).
DROP FUNCTION public.list_money_performances(uuid[], uuid[], uuid[], date, date, integer);

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
  next_performed_at date
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
    SELECT count(*) AS function_count, min(pf.performed_at) AS next_performed_at
    FROM public.performance pf
    WHERE pf.bolo_id = b.id AND pf.deleted_at IS NULL
  ) fx ON true
  WHERE b.deleted_at IS NULL
    AND public.has_permission(b.project_id, 'read:money')
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

REVOKE ALL ON FUNCTION public.list_money_bolos(
  uuid[], uuid[], uuid[], date, date, integer
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_money_bolos(
  uuid[], uuid[], uuid[], date, date, integer
) TO authenticated;
