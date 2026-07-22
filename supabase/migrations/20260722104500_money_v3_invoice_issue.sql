-- Money v3 (ADR-086) — Phase 2b: the issue path. issue_invoice resolves the
-- issuer (workspace override ?? account default), freezes the issuer + payer
-- fiscal snapshots (ADR-050), and assigns the auto-correlative number from the
-- right series. create_invoice gains a doc_type + payer identity (trailing
-- optional params — the money v2 9-arg call still resolves and behaves exactly
-- as before, defaulting to a factura). Nothing v2 relies on changes: v2 still
-- issues by PATCHing status='issued' and its invoice-paid triggers are intact.

-- Snapshot builder: the printed subset of a fiscal identity, frozen on issue.
CREATE OR REPLACE FUNCTION public.fiscal_identity_snapshot(p_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'fiscal_identity_id', fi.id,
    'legal_name', fi.legal_name,
    'tax_id', fi.tax_id,
    'address_line_1', fi.address_line_1,
    'address_line_2', fi.address_line_2,
    'postal_code', fi.postal_code,
    'city', fi.city,
    'region', fi.region,
    'country', fi.country,
    'iban', fi.iban,
    'swift_bic', fi.swift_bic
  )
  FROM public.fiscal_identity fi
  WHERE fi.id = p_id AND fi.deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.fiscal_identity_snapshot(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Issue a draft: freeze snapshots, assign the series number, flip to issued.
CREATE OR REPLACE FUNCTION public.issue_invoice(p_invoice_id uuid)
RETURNS public.invoice
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller    uuid := auth.uid();
  v_inv       public.invoice;
  v_ws        public.workspace;
  v_issuer_id   uuid;
  v_payer_id    uuid;
  v_issuer_snap jsonb;
  v_payer_snap  jsonb;
  v_year        integer;
  v_number      text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM public.invoice
  WHERE id = p_invoice_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_inv.id IS NULL OR NOT (
    (v_inv.project_id IS NOT NULL AND public.has_permission(v_inv.project_id, 'edit:money'))
    OR (v_inv.project_id IS NULL AND public.is_workspace_admin(v_inv.workspace_id))
  ) THEN
    RAISE EXCEPTION 'invoice not found or edit:money required' USING ERRCODE = '42501';
  END IF;

  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft invoice can be issued' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ws FROM public.workspace WHERE id = v_inv.workspace_id;

  -- Issuer: per-workspace override wins, else the account default.
  v_issuer_id := coalesce(
    v_ws.fiscal_identity_id,
    (SELECT a.default_fiscal_identity_id FROM public.account a WHERE a.id = v_ws.account_id)
  );
  v_payer_id := v_inv.payer_fiscal_identity_id;

  -- Re-validate ownership at the snapshot boundary (defence-in-depth: the
  -- pointer columns are set through validated RPCs, but this holds the invariant
  -- however they were written). Issuer: a live issuer owned by this workspace or
  -- its account. Payer: a live receiver owned by this workspace. Anything else
  -- is dropped, so a factura fails cleanly rather than freezing foreign data.
  IF v_issuer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fiscal_identity fi
    WHERE fi.id = v_issuer_id AND fi.kind = 'issuer' AND fi.deleted_at IS NULL
      AND (fi.workspace_id = v_inv.workspace_id OR fi.account_id = v_ws.account_id)
  ) THEN
    v_issuer_id := NULL;
  END IF;
  IF v_payer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fiscal_identity fi
    WHERE fi.id = v_payer_id AND fi.kind = 'receiver' AND fi.deleted_at IS NULL
      AND fi.workspace_id = v_inv.workspace_id
  ) THEN
    v_payer_id := NULL;
  END IF;

  v_issuer_snap := CASE WHEN v_issuer_id IS NOT NULL
    THEN public.fiscal_identity_snapshot(v_issuer_id) ELSE NULL END;
  v_payer_snap := CASE WHEN v_payer_id IS NOT NULL
    THEN public.fiscal_identity_snapshot(v_payer_id) ELSE NULL END;

  IF v_inv.doc_type = 'factura' THEN
    IF v_issuer_snap IS NULL THEN
      RAISE EXCEPTION 'set a valid issuer fiscal identity before issuing a factura' USING ERRCODE = '22023';
    END IF;
    IF v_payer_snap IS NULL THEN
      RAISE EXCEPTION 'a factura requires a valid receiver fiscal identity' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Number is assigned only after every guard passes — no burnt correlatives.
  v_year := extract(year FROM v_inv.issued_on)::integer;
  v_number := public.next_invoice_number(v_inv.workspace_id, v_inv.doc_type, v_issuer_id, v_year);

  UPDATE public.invoice SET
    status                    = 'issued',
    number                    = v_number,
    issuer_fiscal_identity_id = v_issuer_id,
    issuer_snapshot           = v_issuer_snap,
    payer_snapshot            = v_payer_snap,
    updated_at                = now()
  WHERE id = v_inv.id
  RETURNING * INTO v_inv;

  RETURN v_inv;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_invoice(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.issue_invoice(uuid) TO authenticated;

-- create_invoice v3: add p_doc_type + p_payer_fiscal_identity_id as trailing
-- optional params. The v2 9-arg call resolves here unchanged (doc_type NULL →
-- factura; payer identity NULL). Body is the v2 body plus the two new fields.
DROP FUNCTION public.create_invoice(uuid, numeric, numeric, text, date, text, date, text, uuid);

CREATE FUNCTION public.create_invoice(
  p_performance_id uuid,
  p_vat_pct numeric DEFAULT NULL,
  p_irpf_pct numeric DEFAULT NULL,
  p_number text DEFAULT NULL,
  p_due_on date DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_expected_on date DEFAULT NULL,
  p_payment_condition text DEFAULT NULL,
  p_payer_person_id uuid DEFAULT NULL,
  p_doc_type text DEFAULT NULL,
  p_payer_fiscal_identity_id uuid DEFAULT NULL
) RETURNS public.invoice
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_perf public.performance;
  v_ws public.workspace;
  v_project_name text;
  v_inferred_payer uuid;
  v_payer uuid;
  v_doc_type text;
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
  IF p_doc_type IS NOT NULL AND p_doc_type NOT IN ('factura', 'proforma') THEN
    RAISE EXCEPTION 'doc_type must be factura or proforma' USING ERRCODE = '22023';
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

  IF p_payer_fiscal_identity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fiscal_identity fi
    WHERE fi.id = p_payer_fiscal_identity_id
      AND fi.workspace_id = v_perf.workspace_id
      AND fi.kind = 'receiver'
      AND fi.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'receiver fiscal identity is not a workspace receiver' USING ERRCODE = '42501';
  END IF;

  -- doc_type: explicit param wins; else derive from the workspace invoicing_mode
  -- (interno → proforma, legal/off → factura).
  SELECT * INTO v_ws FROM public.workspace WHERE id = v_perf.workspace_id;
  v_doc_type := coalesce(
    p_doc_type,
    CASE WHEN v_ws.settings->>'invoicing_mode' = 'interno' THEN 'proforma' ELSE 'factura' END
  );

  SELECT name INTO v_project_name FROM public.project WHERE id = v_perf.project_id;

  SELECT person_id INTO v_inferred_payer
  FROM public.conversation
  WHERE id = v_perf.conversation_id AND deleted_at IS NULL;

  v_payer := coalesce(p_payer_person_id, v_inferred_payer);
  v_subtotal := v_perf.fee_amount;
  v_vat := CASE WHEN p_vat_pct IS NULL THEN NULL ELSE round(v_subtotal * p_vat_pct / 100, 2) END;
  v_irpf := CASE WHEN p_irpf_pct IS NULL THEN NULL ELSE round(v_subtotal * p_irpf_pct / 100, 2) END;
  v_total := v_subtotal + coalesce(v_vat, 0) - coalesce(v_irpf, 0);
  v_desc := concat_ws(
    ' — ',
    coalesce(v_project_name, 'Performance'),
    nullif(concat_ws(', ', v_perf.venue_name, v_perf.city), ''),
    to_char(v_perf.performed_at::date, 'YYYY-MM-DD')
  );

  INSERT INTO public.invoice (
    workspace_id, project_id, number, due_on, expected_on, payment_condition,
    status, doc_type, subtotal, vat_pct, vat_amount, irpf_pct, irpf_amount, total,
    currency, payer_person_id, payer_fiscal_identity_id, notes, created_by
  ) VALUES (
    v_perf.workspace_id,
    v_perf.project_id,
    nullif(btrim(coalesce(p_number, '')), ''),
    p_due_on,
    p_expected_on,
    nullif(btrim(coalesce(p_payment_condition, '')), ''),
    'draft',
    v_doc_type,
    v_subtotal,
    p_vat_pct,
    v_vat,
    p_irpf_pct,
    v_irpf,
    v_total,
    coalesce(v_perf.fee_currency, 'EUR'),
    v_payer,
    p_payer_fiscal_identity_id,
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
  uuid, numeric, numeric, text, date, text, date, text, uuid, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_invoice(
  uuid, numeric, numeric, text, date, text, date, text, uuid, text, uuid
) TO authenticated;
