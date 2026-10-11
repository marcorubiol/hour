-- Books: el pagador no sale de una conversación privada ajena (ADR-099 §4).
--
-- list_money_payers es SECURITY DEFINER y unía conversation sin la condición de
-- privacidad: enseñaba a otro editor de dinero la persona de una conversación
-- privada que no es suya. create_invoice_from_bolo tenía el mismo hueco al
-- inferir el pagador del bolo: lo copiaba en invoice.payer_person_id, que ven
-- todos los lectores de dinero. Las dos filtran ahora con el criterio de la
-- política conversation_select: private_to IS NULL o es quien llama.
--
-- Sin cambio de firma ni de grants (CREATE OR REPLACE los conserva). Los
-- cuerpos de partida son los de producción el 2026-10-11 (iguales a
-- 20260724093000 y 20260724092000 por md5). La fase 2b del plan
-- 2026-10-11-conversation-with-venue reescribe las dos con el pagador como
-- organización; esto solo adelanta el filtro.
--
-- Rollback: build/runbooks/rollback-20261011-money-payers-private.sql

CREATE OR REPLACE FUNCTION public.list_money_payers(p_project_ids uuid[] DEFAULT NULL::uuid[], p_workspace_ids uuid[] DEFAULT NULL::uuid[], p_limit integer DEFAULT 500)
 RETURNS TABLE(id uuid, workspace_id uuid, slug text, full_name text, organization_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_projects uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'limit must be between 1 and 500' USING ERRCODE = '22023';
  END IF;

  v_projects := public.accessible_project_ids('edit:money');

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
    AND c.project_id = ANY (v_projects)
    -- ADR-099 §4: una conversación privada solo la ve su dueño. El mismo
    -- criterio que la política conversation_select.
    AND (c.private_to IS NULL OR c.private_to = auth.uid())
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
$function$;

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
