-- Idempotent create_payment (hardening audit 2026-07-24).
--
-- A payment had no dedup key of any kind. Two "Record payment" clicks landing
-- before the button's disabled attribute flushed (or a retried/duplicated
-- request) inserted two payment rows; list_money_bolos derives `collected` as
-- sum(payment.amount), so a 1.000 € fee showed 2.000 € collected, `owed` fell
-- to zero and a still-unpaid deal read as paid. Money that silently doubles is
-- the worst class of bug in this surface.
--
-- The client now sends a UUID that is stable per intended payment (regenerated
-- each time the dialog opens). The partial unique index is the real guard — it
-- holds under concurrency, where a check-then-insert would not.

ALTER TABLE public.payment ADD COLUMN idempotency_key uuid;

COMMENT ON COLUMN public.payment.idempotency_key IS
  'Client-generated, stable per intended payment. Deduplicates double-submits and retries (hardening audit 2026-07-24). NULL for rows written before this column existed and for callers that omit it.';

CREATE UNIQUE INDEX payment_idempotency_key_uidx
  ON public.payment (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Signature change (new trailing parameter) → drop, don't overload: PostgREST
-- resolves RPCs by named arguments and two candidates would be ambiguous.
DROP FUNCTION public.create_payment(
  uuid, numeric, date, public.payment_method, text, text, uuid, uuid, uuid, text, text
);

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
  p_category text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
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

  -- Fast path for an obvious replay. The unique index below is what actually
  -- holds under concurrency; this only avoids re-running the permission work
  -- and returns the original row so a retry looks like a success to the client.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_payment
    FROM public.payment
    WHERE idempotency_key = p_idempotency_key;
    IF v_payment.id IS NOT NULL THEN
      RETURN v_payment;
    END IF;
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
    bolo_id, line_id, project_id, counterparty, category, idempotency_key, created_by
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
    p_idempotency_key,
    v_caller
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
  DO NOTHING
  RETURNING * INTO v_payment;

  -- Lost the concurrent race: the winning row IS this payment. Return it so
  -- both callers see one recorded payment instead of a spurious error.
  IF v_payment.id IS NULL AND p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_payment
    FROM public.payment
    WHERE idempotency_key = p_idempotency_key;
  END IF;

  IF v_payment.id IS NULL THEN
    RAISE EXCEPTION 'payment could not be recorded' USING ERRCODE = '22023';
  END IF;

  RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.create_payment(
  uuid, numeric, date, public.payment_method, text, text, uuid, uuid, uuid, text, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_payment(
  uuid, numeric, date, public.payment_method, text, text, uuid, uuid, uuid, text, text, uuid
) TO authenticated;
