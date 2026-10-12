-- ROLLBACK for 20261012200000_invoice_payer_organization.sql (ADR-102 fase 2b)
--
-- Devuelve create_invoice_from_bolo a su firma de 11 parámetros (cuerpo de
-- 20261011700000, con el filtro de private_to) y update_invoice al de
-- 20260724092000; borra list_money_payer_organizations,
-- set_organization_fiscal_identity, can_edit_workspace_money, el guard y las
-- dos columnas.
--
-- ANTES: desplegar un Worker anterior a la fase 2b. El de la fase 2b llama a
-- list_money_payer_organizations, set_organization_fiscal_identity y
-- can_edit_workspace_money, pide payer_organization_id y el embed
-- invoice_workspace_payer_organization_fkey: con esto fuera, Books falla.
--
-- DATA LOST: el pagador-organización de cada factura (payer_organization_id)
-- y el enlace organización → identidad fiscal. Las filas de fiscal_identity
-- creadas por set_organization_fiscal_identity se quedan (huérfanas, sin
-- borrar: alguna factura emitida puede apuntarlas en payer_fiscal_identity_id).

BEGIN;

DROP FUNCTION IF EXISTS public.list_money_payer_organizations(uuid[], uuid[], integer);
DROP FUNCTION IF EXISTS public.set_organization_fiscal_identity(uuid, jsonb);
DROP FUNCTION IF EXISTS public.can_edit_workspace_money(uuid);

DROP FUNCTION IF EXISTS public.create_invoice_from_bolo(uuid, jsonb, text, date, text, date, text, uuid, text, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.create_invoice_from_bolo(p_bolo_id uuid, p_tax_lines jsonb DEFAULT '[]'::jsonb, p_number text DEFAULT NULL::text, p_due_on date DEFAULT NULL::date, p_notes text DEFAULT NULL::text, p_expected_on date DEFAULT NULL::date, p_payment_condition text DEFAULT NULL::text, p_payer_person_id uuid DEFAULT NULL::uuid, p_doc_type text DEFAULT NULL::text, p_payer_fiscal_identity_id uuid DEFAULT NULL::uuid, p_country text DEFAULT NULL::text)
 RETURNS invoice
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_bolo public.bolo;
  v_ws public.workspace;
  v_project_name text;
  v_first_date date;
  v_inferred_payer uuid;
  v_payer uuid;
  v_doc_type text;
  v_country text;
  v_subtotal numeric;
  v_total numeric;
  v_desc text;
  v_invoice public.invoice;
  v_elem jsonb;
  v_label text;
  v_kind text;
  v_rate numeric;
  v_reason text;
  v_amount numeric;
  v_ordinal integer := 0;
  v_tax_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(coalesce(p_tax_lines, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'tax_lines must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF p_country IS NOT NULL AND upper(btrim(p_country)) !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'country must be an ISO alpha-2 code' USING ERRCODE = '22023';
  END IF;
  IF p_payment_condition IS NOT NULL AND length(p_payment_condition) > 2000 THEN
    RAISE EXCEPTION 'payment_condition is too long' USING ERRCODE = '22023';
  END IF;
  IF p_doc_type IS NOT NULL AND p_doc_type NOT IN ('factura', 'proforma') THEN
    RAISE EXCEPTION 'doc_type must be factura or proforma' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_bolo
  FROM public.bolo
  WHERE id = p_bolo_id AND deleted_at IS NULL;

  IF v_bolo.id IS NULL THEN
    RAISE EXCEPTION 'bolo not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_permission(v_bolo.project_id, 'edit:money') THEN
    RAISE EXCEPTION 'edit:money required' USING ERRCODE = '42501';
  END IF;
  IF v_bolo.fee_amount IS NULL THEN
    RAISE EXCEPTION 'bolo has no fee — set the fee first' USING ERRCODE = '22023';
  END IF;
  IF p_expected_on IS NOT NULL AND p_expected_on < CURRENT_DATE THEN
    RAISE EXCEPTION 'expected_on cannot precede issued_on' USING ERRCODE = '22023';
  END IF;

  IF p_payer_person_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.workspace_person wp
    WHERE wp.workspace_id = v_bolo.workspace_id
      AND wp.person_id = p_payer_person_id
      AND wp.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'payer is not in the bolo workspace' USING ERRCODE = '42501';
  END IF;

  IF p_payer_fiscal_identity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fiscal_identity fi
    WHERE fi.id = p_payer_fiscal_identity_id
      AND fi.workspace_id = v_bolo.workspace_id
      AND fi.kind = 'receiver'
      AND fi.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'receiver fiscal identity is not a workspace receiver' USING ERRCODE = '42501';
  END IF;

  -- doc_type: explicit param wins; else derive from the workspace invoicing_mode
  -- (interno → proforma, legal/off → factura).
  SELECT * INTO v_ws FROM public.workspace WHERE id = v_bolo.workspace_id;
  v_doc_type := coalesce(
    p_doc_type,
    CASE WHEN v_ws.settings->>'invoicing_mode' = 'interno' THEN 'proforma' ELSE 'factura' END
  );

  -- country: the tax regime this document is snapshotted under. The app passes
  -- the resolved regime; fall back to the bolo's, then the workspace's.
  v_country := upper(nullif(btrim(coalesce(p_country, v_bolo.country, v_ws.country, '')), ''));

  SELECT name INTO v_project_name FROM public.project WHERE id = v_bolo.project_id;

  -- The deal may span several functions; date the line by the earliest one.
  SELECT min(pf.performed_at) INTO v_first_date
  FROM public.performance pf
  WHERE pf.bolo_id = v_bolo.id AND pf.deleted_at IS NULL;

  -- ADR-099 §4: la persona de una conversación privada ajena no se infiere
  -- como pagador. El mismo criterio que la política conversation_select.
  SELECT person_id INTO v_inferred_payer
  FROM public.conversation
  WHERE id = v_bolo.conversation_id AND deleted_at IS NULL
    AND (private_to IS NULL OR private_to = v_caller);

  v_payer := coalesce(p_payer_person_id, v_inferred_payer);
  v_subtotal := v_bolo.fee_amount;
  v_total := v_subtotal;

  -- Validate + compute each generic tax line. The per-country preset (app layer)
  -- decided which lines apply; the core just signs each and sums the total.
  FOR v_elem IN SELECT value FROM jsonb_array_elements(coalesce(p_tax_lines, '[]'::jsonb))
  LOOP
    v_label  := btrim(coalesce(v_elem->>'label', ''));
    v_kind   := coalesce(v_elem->>'kind', '');
    v_rate   := coalesce((v_elem->>'rate_pct')::numeric, 0);
    v_reason := nullif(btrim(coalesce(v_elem->>'exempt_reason', '')), '');

    IF v_label = '' THEN
      RAISE EXCEPTION 'tax line label is required' USING ERRCODE = '22023';
    END IF;
    IF v_kind NOT IN ('add', 'withhold', 'exempt') THEN
      RAISE EXCEPTION 'tax line kind must be add, withhold or exempt' USING ERRCODE = '22023';
    END IF;
    IF v_rate < 0 OR v_rate > 100 THEN
      RAISE EXCEPTION 'tax line rate must be between 0 and 100' USING ERRCODE = '22023';
    END IF;
    IF v_kind = 'exempt' AND v_reason IS NULL THEN
      RAISE EXCEPTION 'an exempt tax line needs a reason' USING ERRCODE = '22023';
    END IF;

    v_amount := CASE v_kind
      WHEN 'add'      THEN round(v_subtotal * v_rate / 100, 2)
      WHEN 'withhold' THEN -round(v_subtotal * v_rate / 100, 2)
      ELSE 0
    END;
    v_total := v_total + v_amount;

    v_tax_rows := v_tax_rows || jsonb_build_object(
      'label', v_label, 'kind', v_kind, 'rate_pct', v_rate,
      'base_amount', v_subtotal, 'amount', v_amount,
      'exempt_reason', v_reason, 'ordinal', v_ordinal
    );
    v_ordinal := v_ordinal + 1;
  END LOOP;

  v_desc := concat_ws(
    ' — ',
    coalesce(v_project_name, 'Performance'),
    nullif(concat_ws(', ', v_bolo.venue_name, v_bolo.city), ''),
    to_char(v_first_date, 'YYYY-MM-DD')
  );

  INSERT INTO public.invoice (
    workspace_id, project_id, number, due_on, expected_on, payment_condition,
    status, doc_type, country, subtotal, total,
    currency, payer_person_id, payer_fiscal_identity_id, notes, created_by
  ) VALUES (
    v_bolo.workspace_id,
    v_bolo.project_id,
    nullif(btrim(coalesce(p_number, '')), ''),
    p_due_on,
    p_expected_on,
    nullif(btrim(coalesce(p_payment_condition, '')), ''),
    'draft',
    v_doc_type,
    v_country,
    v_subtotal,
    v_total,
    coalesce(v_bolo.fee_currency, 'EUR'),
    v_payer,
    p_payer_fiscal_identity_id,
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_caller
  ) RETURNING * INTO v_invoice;

  INSERT INTO public.invoice_line (
    workspace_id, invoice_id, bolo_id, description, quantity, unit_amount
  ) VALUES (
    v_bolo.workspace_id, v_invoice.id, v_bolo.id, v_desc, 1, v_subtotal
  );

  INSERT INTO public.invoice_tax_line (
    workspace_id, invoice_id, label, kind, rate_pct, base_amount, amount, exempt_reason, ordinal
  )
  SELECT
    v_bolo.workspace_id, v_invoice.id,
    e->>'label', e->>'kind', (e->>'rate_pct')::numeric,
    (e->>'base_amount')::numeric, (e->>'amount')::numeric,
    e->>'exempt_reason', (e->>'ordinal')::integer
  FROM jsonb_array_elements(v_tax_rows) AS e;

  RETURN v_invoice;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_invoice_from_bolo(
  uuid, jsonb, text, date, text, date, text, uuid, text, uuid, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_bolo(
  uuid, jsonb, text, date, text, date, text, uuid, text, uuid, text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_invoice(
  p_invoice_id uuid,
  p_patch jsonb
) RETURNS public.invoice
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_inv    public.invoice;
  v_status text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'empty patch' USING ERRCODE = '22023';
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

  IF p_patch ? 'number' THEN
    RAISE EXCEPTION 'invoice numbers are assigned by issue_invoice(), not by hand'
      USING ERRCODE = '42501';
  END IF;

  IF p_patch ? 'status' THEN
    v_status := p_patch->>'status';
    IF v_status = 'issued' THEN
      RAISE EXCEPTION 'issue an invoice through issue_invoice() so it gets a real correlative and frozen snapshots'
        USING ERRCODE = '42501';
    END IF;
    IF v_status = 'paid' THEN
      RAISE EXCEPTION 'paid is derived from payments, not set directly' USING ERRCODE = '42501';
    END IF;
    IF v_status NOT IN ('draft', 'cancelled') THEN
      RAISE EXCEPTION 'status must be draft or cancelled' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.invoice SET
    status = CASE WHEN p_patch ? 'status'
      THEN (p_patch->>'status')::public.invoice_status ELSE status END,
    due_on = CASE WHEN p_patch ? 'due_on'
      THEN nullif(p_patch->>'due_on', '')::date ELSE due_on END,
    expected_on = CASE WHEN p_patch ? 'expected_on'
      THEN nullif(p_patch->>'expected_on', '')::date ELSE expected_on END,
    payment_condition = CASE WHEN p_patch ? 'payment_condition'
      THEN nullif(btrim(coalesce(p_patch->>'payment_condition', '')), '') ELSE payment_condition END,
    payer_person_id = CASE WHEN p_patch ? 'payer_person_id'
      THEN nullif(p_patch->>'payer_person_id', '')::uuid ELSE payer_person_id END,
    notes = CASE WHEN p_patch ? 'notes'
      THEN nullif(btrim(coalesce(p_patch->>'notes', '')), '') ELSE notes END
  WHERE id = v_inv.id
  RETURNING * INTO v_inv;

  RETURN v_inv;
END;
$$;


DROP TRIGGER IF EXISTS workspace_organization_guard_fiscal_identity ON public.workspace_organization;
DROP FUNCTION IF EXISTS private.guard_organization_fiscal_identity();

ALTER TABLE public.workspace_organization DROP COLUMN IF EXISTS fiscal_identity_id;
ALTER TABLE public.invoice DROP COLUMN IF EXISTS payer_organization_id;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261012200000';

COMMIT;
