-- ADR-050: invoice creation from a performance's fee. Sixth case of the
-- claim-bound INSERT pattern (invoice_insert requires
-- workspace_id = current_workspace_id()): the RPC is claim-independent
-- and gates on has_permission(project, 'edit:money') — the same gate the
-- policy intends for project invoices.
--
-- One performance → one draft invoice with one line. Amounts derive from
-- the fee at creation time (snapshot semantics: later fee edits do NOT
-- retro-edit the invoice). Spanish tax shape: total = subtotal + VAT − IRPF.
-- invoice_line.line_total is GENERATED (quantity * unit_amount) — never
-- inserted explicitly.
--
-- Companion: delete_invoice — draft-only discard via RPC (client-direct
-- soft-deletes are impossible by construction, ADR-048); anything that
-- left draft exits the lifecycle through `cancelled`, keeping the audit
-- trail.
--
-- Applied live 2026-07-02 via Supabase MCP (migrations `create_invoice_rpc`
-- + `fix_create_invoice_generated_line_total` + `delete_invoice_rpc`).

CREATE OR REPLACE FUNCTION public.create_invoice(
  p_performance_id uuid,
  p_vat_pct numeric DEFAULT NULL,
  p_irpf_pct numeric DEFAULT NULL,
  p_number text DEFAULT NULL,
  p_due_on date DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.invoice
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_perf public.performance;
  v_project_name text;
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

  SELECT * INTO v_perf FROM public.performance
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

  SELECT name INTO v_project_name FROM public.project WHERE id = v_perf.project_id;
  SELECT person_id INTO v_payer FROM public.engagement
  WHERE id = v_perf.engagement_id AND deleted_at IS NULL;

  v_subtotal := v_perf.fee_amount;
  v_vat := CASE WHEN p_vat_pct IS NULL THEN NULL ELSE round(v_subtotal * p_vat_pct / 100, 2) END;
  v_irpf := CASE WHEN p_irpf_pct IS NULL THEN NULL ELSE round(v_subtotal * p_irpf_pct / 100, 2) END;
  v_total := v_subtotal + coalesce(v_vat, 0) - coalesce(v_irpf, 0);

  v_desc := concat_ws(' — ',
    coalesce(v_project_name, 'Performance'),
    nullif(concat_ws(', ', v_perf.venue_name, v_perf.city), ''),
    to_char(v_perf.performed_at::date, 'YYYY-MM-DD')
  );

  INSERT INTO public.invoice (
    workspace_id, project_id, number, due_on, status,
    subtotal, vat_pct, vat_amount, irpf_pct, irpf_amount, total,
    currency, payer_person_id, notes, created_by
  ) VALUES (
    v_perf.workspace_id, v_perf.project_id, nullif(btrim(coalesce(p_number, '')), ''), p_due_on, 'draft',
    v_subtotal, p_vat_pct, v_vat, p_irpf_pct, v_irpf, v_total,
    coalesce(v_perf.fee_currency, 'EUR'), v_payer, nullif(btrim(coalesce(p_notes, '')), ''), v_caller
  )
  RETURNING * INTO v_invoice;

  INSERT INTO public.invoice_line (workspace_id, invoice_id, performance_id, description, quantity, unit_amount)
  VALUES (v_perf.workspace_id, v_invoice.id, v_perf.id, v_desc, 1, v_subtotal);

  RETURN v_invoice;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_invoice(uuid, numeric, numeric, text, date, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_invoice(uuid, numeric, numeric, text, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_invoice(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_inv public.invoice;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_inv FROM public.invoice
  WHERE id = p_invoice_id AND deleted_at IS NULL;
  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'invoice not found' USING ERRCODE = '42501';
  END IF;
  IF v_inv.project_id IS NOT NULL THEN
    IF NOT public.has_permission(v_inv.project_id, 'edit:money') THEN
      RAISE EXCEPTION 'edit:money required' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_membership m
      WHERE m.workspace_id = v_inv.workspace_id AND m.user_id = v_caller
        AND m.accepted_at IS NOT NULL AND m.role IN ('owner', 'admin')
    ) THEN
      RAISE EXCEPTION 'workspace owner/admin required' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'only draft invoices can be deleted — cancel it instead' USING ERRCODE = '22023';
  END IF;
  UPDATE public.invoice SET deleted_at = now() WHERE id = p_invoice_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_invoice(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_invoice(uuid) TO authenticated;
